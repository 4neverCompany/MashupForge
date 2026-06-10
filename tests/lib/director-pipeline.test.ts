/**
 * V1.6: requestDirectorPrompt — the opt-in agentic Director pipeline's
 * network call + graceful fallback. Tests the contract that the pipeline
 * relies on: a usable prompt on success, and a never-throwing
 * `{ ok:false, reason }` on every failure so the caller can fall back to
 * the verbatim concept.
 */
import { describe, it, expect, vi } from 'vitest';
import { requestDirectorPrompt } from '@/lib/director-pipeline';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

const base = {
  ideaConcept: 'Darth Vader in an Iron Man suit',
  niches: ['Multiverse Crossovers'],
  genres: ['Noir & Gritty'],
};

describe('requestDirectorPrompt', () => {
  it('returns the Director prompt on success and posts mode:director', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ prompt: 'A long, cinematic crossover prompt…', cost: 0.0123, truncatedBy: 'natural' }),
    );
    const out = await requestDirectorPrompt(base, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.prompt).toContain('cinematic crossover');
      expect(out.cost).toBe(0.0123);
      expect(out.truncatedBy).toBe('natural');
    }
    // Verify the request shape the Director route expects.
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.mode).toBe('director');
    expect(body.niches).toEqual(['Multiverse Crossovers']);
    expect(url).toBe('/api/ai/prompt');
  });

  it('falls back (ok:false) with no content pillars — never calls the route', async () => {
    const fetchImpl = vi.fn();
    const out = await requestDirectorPrompt({ ...base, niches: [] }, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/content pillar/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('falls back on a too-short concept without calling the route', async () => {
    const fetchImpl = vi.fn();
    const out = await requestDirectorPrompt({ ...base, ideaConcept: 'hi' }, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('falls back with the route error message on a 503 (no provider configured)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'No AI provider configured.' }, false, 503));
    const out = await requestDirectorPrompt(base, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/no ai provider/i);
  });

  it('falls back on an empty prompt', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ prompt: '   ' }));
    const out = await requestDirectorPrompt(base, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/empty/i);
  });

  it('falls back (never throws) on a network error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('Failed to fetch');
    });
    const out = await requestDirectorPrompt(base, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/failed to fetch/i);
  });

  it('caps niches to 6 and genres to 10', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ prompt: 'A valid long prompt for the test case here.' }));
    await requestDirectorPrompt(
      {
        ideaConcept: 'concept long enough',
        niches: Array.from({ length: 9 }, (_, i) => `n${i}`),
        genres: Array.from({ length: 14 }, (_, i) => `g${i}`),
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.niches).toHaveLength(6);
    expect(body.genres).toHaveLength(10);
  });
});
