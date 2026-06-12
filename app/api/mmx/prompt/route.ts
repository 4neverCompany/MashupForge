// MMX-PROMPT-ROUTE (Story 2 of MMX-PROMPT-INTEGRATION): the mmx
// counterpart to /api/pi/prompt. Same POST contract, same SSE response
// shape, same mode directives + memory + trending enrichment — only
// the underlying generator is mmxClient.prompt() instead of piPrompt().
// Lets the client-side streamAI router (Story 3) flip providers based
// on settings.activeAiAgent without per-callsite branching.
//
// MODE_DIRECTIVES + the trending/focus enrichment are intentionally
// kept consistent with /api/pi/prompt. Several helpers that route
// already exports (buildFocusBlock / buildTrendingQuery / pickFromPool
// / dedupeByUrl) are imported directly so they can't drift between the
// two routes. The remaining duplicated literals (FRESHNESS_POOL,
// TRENDING_FALLBACK_POOL, MODE_DIRECTIVES, the recent-URL cache, the
// numeric caps) are kept in lockstep manually — TODO: extract to
// lib/ai-prompt-shared.ts when either route grows a third caller.

import { prompt as mmxPrompt, isAvailable, isAuthenticated } from '@/lib/mmx-client';
import { getErrorMessage } from '@/lib/errors';
import { coerceMemory, formatMemoryForPrompt } from '@/lib/pipeline-memory';
import { webSearch, extractTrendingTags, type WebSearchResult } from '@/lib/web-search';
// CAMOFOX-CAMOUFOX-1.1.0 (2026-06-06): camofox sidecar for the
// trending-enrichment loop. Mirrors the pi route's Day 2 wiring.
// Dynamic-imported so SSR environments that can't load the
// camofox module get a clean fallback to webSearch().
import { withCamofoxHealth } from '@/lib/camofox';
import {
  buildFocusBlock,
  buildTrendingQuery,
  pickFromPool,
  dedupeByUrl,
  type PiMode as PromptMode,
} from '@/lib/ai-prompt-helpers';

// Kept in sync with /api/pi/prompt. See module-level comment.
const TRENDING_PER_QUERY_COUNT = 2;
const TRENDING_MAX_RESULTS = 6;
const TRENDING_MAX_CHARS = 900;
const TRENDING_SNIPPET_CHARS = 220;
const TRENDING_TAG_LIMIT = 10;

const FRESHNESS_POOL = [
  'trending 2026',
  'trending this week',
  'new this month',
  'latest 2026',
  'recent buzz',
  'viral this year',
];

const TRENDING_FALLBACK_POOL = [
  'popular crossover fan art new characters 2026',
  'viral mashup character concepts fandom 2026',
  'best crossover art reddit twitter recent',
  'trending fandom crossover illustrations this month',
  'new fan-made character mashups buzz',
];

// Per-route URL memory: kept separate from the pi route's cache so a
// switch from pi to mmx doesn't immediately serve stale URLs the other
// provider already showed. Fine because the two providers' result
// streams diverge anyway once they start generating.
const RECENT_URLS_CAPACITY = 150;
const recentTrendingUrls: string[] = [];
const recentTrendingUrlSet = new Set<string>();

function rememberTrendingUrls(urls: string[]): void {
  for (const u of urls) {
    if (!u || recentTrendingUrlSet.has(u)) continue;
    recentTrendingUrlSet.add(u);
    recentTrendingUrls.push(u);
    while (recentTrendingUrls.length > RECENT_URLS_CAPACITY) {
      const evicted = recentTrendingUrls.shift();
      if (evicted) recentTrendingUrlSet.delete(evicted);
    }
  }
}

function currentRotationBucket(): number {
  return Math.floor(Date.now() / (1000 * 60 * 15));
}

function sanitizeStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map((s) => s.trim());
}

const MODE_DIRECTIVES: Record<PromptMode, string> = {
  chat:
    'You are an elite creative AI assistant. Be vivid, direct, and spectacular. No hedging.',
  generate:
    'You are a world-class prompt engineer. Every prompt you write must be visually breathtaking. Follow the output format exactly. No preamble.',
  idea:
    'You are a creative genius generating crossover concepts that break the internet. Marvel, DC, Star Wars, Warhammer 40k, anime, games — the wildest, most visually spectacular mashups imaginable. Avoid overused characters. Return ONLY the requested format.',
  enhance:
    'You are an elite prompt enhancer. Transform the input into the most visually stunning, cinematic prompt possible. Maximize drama, detail, and visual impact. Return ONLY the enhanced prompt.',
  caption:
    'You are a viral social-media copywriter. Captions that stop thumbs and drive engagement. Return ONLY valid JSON.',
  tag:
    'You are a hashtag and tag strategist for maximum reach. Return ONLY a JSON array of tag strings.',
  'negative-prompt':
    'Generate the most effective negative prompt to eliminate visual artifacts and low-quality output. Return ONLY the negative prompt text.',
  'collection-info':
    'Generate rich collection metadata. Return ONLY valid JSON.',
};

function directiveFor(mode: unknown): string | null {
  if (typeof mode !== 'string') return null;
  return (MODE_DIRECTIVES as Record<string, string>)[mode] || null;
}

function formatTrendingContext(results: WebSearchResult[]): string {
  if (!results || results.length === 0) return '';
  const lines = [
    '[TRENDING CONTEXT — OPTIONAL INSPIRATION ONLY]',
    'These are what people are talking about online. Use them as flavor or ignore them entirely.',
    'YOUR PRIMARY DIRECTIVE: generate ideas that match the active niches/genres above.',
    "Do NOT default to the trending topic's universe — the niches are your creative constraint.",
    'If trending mentions cyberpunk, that does NOT mean every idea should be cyberpunk-themed.',
  ];
  for (const r of results) {
    const title = r.title.trim();
    const snippet = r.snippet.trim().slice(0, TRENDING_SNIPPET_CHARS);
    if (!title) continue;
    lines.push(snippet ? `- ${title} — ${snippet}` : `- ${title}`);
  }
  const tags = extractTrendingTags(results).slice(0, TRENDING_TAG_LIMIT);
  if (tags.length > 0) {
    lines.push(`Tags observed: ${tags.join(', ')}`);
  }
  const joined = lines.join('\n');
  return joined.length > TRENDING_MAX_CHARS ? joined.slice(0, TRENDING_MAX_CHARS) + '…' : joined;
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { message, mode, systemPrompt, memory, niches, genres } = body || {};
  if (typeof message !== 'string' || !message.trim()) {
    return new Response(JSON.stringify({ error: 'message is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Pre-flight: surface mmx unavailability or missing auth as a clean
  // 503 instead of a mid-stream error frame, so the client can retry
  // (or fall back to pi) deterministically.
  if (!(await isAvailable())) {
    return new Response(
      JSON.stringify({ error: 'mmx CLI not available. Install the MiniMax mmx binary and put it on PATH (or set MMX_BIN).' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }
  if (!isAuthenticated()) {
    return new Response(
      JSON.stringify({ error: 'mmx not authenticated. Set MMX_API_KEY (or MINIMAX_API_KEY) in the environment.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const directive = directiveFor(mode);

  const preBlocks: string[] = [];
  const postBlocks: string[] = [];

  const focusNiches = sanitizeStringArray(niches);
  const focusGenres = sanitizeStringArray(genres);
  const focusBlock = buildFocusBlock(focusNiches, focusGenres);

  if (mode === 'idea' || mode === 'generate') {
    const memBlock = formatMemoryForPrompt(coerceMemory(memory));
    if (memBlock) preBlocks.push(memBlock);
  }

  if (mode === 'idea') {
    const braveKey = (process.env.BRAVE_API_KEY ?? '').trim();
    const searchOpts = braveKey ? { provider: 'brave' as const, braveApiKey: braveKey } : undefined;

    const bucket = currentRotationBucket();
    const freshA = pickFromPool(FRESHNESS_POOL, 0, bucket);
    const freshB = pickFromPool(FRESHNESS_POOL, 3, bucket);
    const fallback = pickFromPool(TRENDING_FALLBACK_POOL, 1, bucket);
    const queries = [
      buildTrendingQuery(focusNiches, focusGenres, Math.random, freshA, bucket),
      buildTrendingQuery(focusNiches, focusGenres, Math.random, freshB, bucket + 1),
      fallback,
    ];

    const allResults: WebSearchResult[] = [];
    for (const q of queries) {
      try {
        // CAMOFOX-CAMOUFOX-1.1.0: route trending through the camofox
        // sidecar first; fall back to webSearch() on any camofox
        // failure. sessionKey includes the query index so concurrent
        // in-flight calls don't share tabs.
        const sessionKey = `mmx-trending-${bucket}-${queries.indexOf(q)}`;
        const results = await withCamofoxHealth(
          () =>
            import('@/lib/camofox').then((m) =>
              m.camofoxSearch({
                userId: 'mmx-route',
                sessionKey,
                macro: '@google_search',
                query: q,
                count: TRENDING_PER_QUERY_COUNT,
              }),
            ),
          () => webSearch(q, TRENDING_PER_QUERY_COUNT, undefined, searchOpts),
        );
        allResults.push(...results);
      } catch {
        /* trending is optional enrichment */
      }
    }

    const filtered = allResults.filter((r) => !recentTrendingUrlSet.has(r.url));
    const pool = filtered.length > 0 ? filtered : allResults;
    const unique = dedupeByUrl(pool).slice(0, TRENDING_MAX_RESULTS);
    rememberTrendingUrls(unique.map((r) => r.url));
    const trending = formatTrendingContext(unique);
    if (trending) postBlocks.push(trending);
  }

  const composedSystem =
    [...preBlocks, directive, systemPrompt, focusBlock, ...postBlocks].filter(Boolean).join('\n\n') ||
    undefined;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const delta of mmxPrompt(message, { systemPrompt: composedSystem })) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ text: delta })}\n\n`),
          );
        }
      } catch (e: unknown) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: getErrorMessage(e) || 'mmx stream error' })}\n\n`,
          ),
        );
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
