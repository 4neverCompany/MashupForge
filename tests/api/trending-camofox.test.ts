// V1.1.1-PIPELINE-TRENDING: regression test for the camofox fan-out
// in /api/trending. Pre-v1.1.1 the route's only web source was a
// self-hosted SearXNG instance on localhost:34567; when that wasn't
// running (the typical user case — it's a dev-only meta-search), the
// route silently returned zero results and the pipeline-mode trend
// step logged "No trending data found — proceeding without".
//
// The fix adds camofox as a tertiary fan-out alongside SearXNG and
// Reddit. This test pins the contract:
//   1. When camofox is healthy, its results are folded into the
//      response alongside the other sources.
//   2. When camofox is unavailable, the route degrades to the
//      original SearXNG+Reddit behavior (zero results from
//      camofox doesn't break the request).
//   3. Dedup-by-headline-prefix collapses overlap between camofox
//      and the other sources.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as trendingPost } from '@/app/api/trending/route';

// Mocks are wired per-test in beforeEach so test failures can be
// attributed to a specific case. The `global.fetch` stub handles
// SearXNG + Reddit JSON. The camofox mock is a separate module
// mock (vi.mock) because the route imports withCamofoxHealth
// directly.
const fetchMock = vi.fn();
const withCamofoxHealthMock = vi.fn();

vi.mock('@/lib/camofox', () => ({
  withCamofoxHealth: (...args: unknown[]) => withCamofoxHealthMock(...args),
}));

beforeEach(() => {
  fetchMock.mockReset();
  withCamofoxHealthMock.mockReset();
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

  // Default: SearXNG is down (returns 0 results via the route's own
  // try/catch) and Reddit returns an empty page. Tests that need a
  // different SearXNG/Reddit response override per-call.
  fetchMock.mockImplementation(async () => {
    return new Response(JSON.stringify({ results: [], data: { children: [] } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function makePost(body: unknown): NextRequest {
  return new NextRequest('http://x/api/trending', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/trending — V1.1.1 camofox fan-out', () => {
  it('folds camofox results into the response when camofox is healthy', async () => {
    withCamofoxHealthMock.mockImplementation(
      async (
        primary: () => Promise<unknown>,
        _fallback: () => Promise<unknown>,
      ) => {
        // Pretend camofox is healthy — call the primary closure.
        const r = await primary();
        return r;
      },
    );
    // The route calls `import('@/lib/camofox').then((m) => m.camofoxSearch(...))`
    // inside the primary closure. We need to mock that module too.
    vi.doMock('@/lib/camofox', () => ({
      withCamofoxHealth: withCamofoxHealthMock,
      camofoxSearch: async () => [
        { title: 'Marvel Phase 6 announcement', url: 'https://marvel.com/news/1', snippet: '' },
        { title: 'Star Wars: New Republic show announced', url: 'https://starwars.com/news/2', snippet: '' },
      ],
    }));
    // The route does a dynamic import inside the closure; vi.doMock
    // does NOT intercept that on already-imported modules. We re-import
    // the route fresh.
    vi.resetModules();
    const { POST: freshPost } = await import('@/app/api/trending/route');

    const res = await freshPost(
      makePost({
        tags: ['Marvel', 'Star Wars'],
        niches: ['Marvel', 'Star Wars'],
        genres: ['crossover'],
        ideaConcept: 'X-Men meet the Mandalorians',
      }),
    );
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    // The two camofox results must surface in the response.
    const camofoxHits = data.results.filter(
      (r: { source: string }) => r.source === 'camofox',
    );
    expect(camofoxHits.length).toBe(2);
    expect(camofoxHits[0].headline).toContain('Marvel Phase 6');
    expect(camofoxHits[1].headline).toContain('Star Wars');

    vi.doUnmock('@/lib/camofox');
  });

  it('degrades to SearXNG+Reddit-only when camofox is unavailable', async () => {
    // withCamofoxHealth falls back to [] when camofox is down (this
    // is what the real implementation does; we reproduce the
    // contract here by calling the fallback closure).
    withCamofoxHealthMock.mockImplementation(
      async (
        _primary: () => Promise<unknown>,
        fallback: () => Promise<unknown>,
      ) => {
        return await fallback();
      },
    );
    // Reddit returns a hit. SearXNG is empty.
    fetchMock.mockImplementation(async (url: string | URL | Request) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('reddit.com')) {
        return new Response(
          JSON.stringify({
            data: {
              children: [
                {
                  data: {
                    title: 'Mandalorian S4 confirmed',
                    score: 42,
                    subreddit: 'StarWars',
                    permalink: '/r/StarWars/comments/abc',
                  },
                },
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    });

    const res = await trendingPost(
      makePost({ tags: ['Star Wars'], niches: ['Star Wars'], genres: [] }),
    );
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    // Reddit hit shows up; camofox contributes nothing.
    const camofoxHits = data.results.filter(
      (r: { source: string }) => r.source === 'camofox',
    );
    expect(camofoxHits.length).toBe(0);
    const redditHits = data.results.filter((r: { source: string }) => r.source.startsWith('r/'));
    expect(redditHits.length).toBeGreaterThan(0);
  });

  it('dedup by headline prefix collapses overlap between camofox and SearXNG', async () => {
    // Both SearXNG and camofox return the same headline. The dedup
    // step should keep just one.
    const sharedHeadline = 'Marvel Cinematic Universe Phase 6 reveal';
    fetchMock.mockImplementation(async (url: string | URL | Request) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('localhost:34567') || u.includes('searx')) {
        return new Response(
          JSON.stringify({
            results: [
              { title: sharedHeadline, url: 'https://marvel.com/p6', publishedDate: '2026-05-30' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ data: { children: [] } }), { status: 200 });
    });
    withCamofoxHealthMock.mockImplementation(
      async (primary: () => Promise<unknown>, _fallback: () => Promise<unknown>) => {
        return await primary();
      },
    );
    vi.doMock('@/lib/camofox', () => ({
      withCamofoxHealth: withCamofoxHealthMock,
      camofoxSearch: async () => [
        { title: sharedHeadline, url: 'https://other.example/p6', snippet: '' },
      ],
    }));
    vi.resetModules();
    const { POST: freshPost } = await import('@/app/api/trending/route');

    const res = await freshPost(
      makePost({ tags: ['Marvel'], niches: ['Marvel'], genres: [] }),
    );
    const data = await res.json();
    expect(res.status).toBe(200);

    // Find the dedup'd headline — should appear exactly once.
    const matches = data.results.filter(
      (r: { headline: string }) => r.headline === sharedHeadline,
    );
    expect(matches.length).toBe(1);

    vi.doUnmock('@/lib/camofox');
  });

  it('does not invoke camofox when no web terms are present (empty tags/niches)', async () => {
    withCamofoxHealthMock.mockReset();
    const res = await trendingPost(makePost({ tags: [], niches: [], genres: [] }));
    expect(res.status).toBe(200);
    // Empty request still gets a 200, just with no results.
    expect(withCamofoxHealthMock).not.toHaveBeenCalled();
  });
});
