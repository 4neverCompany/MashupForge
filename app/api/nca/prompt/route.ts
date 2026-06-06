// NCA-PROMPT-ROUTE: nca counterpart to /api/pi/prompt and the legacy
// /api/mmx/prompt. Same POST contract, same SSE response shape, same
// MODE_DIRECTIVES + memory + trending enrichment — only the underlying
// generator is ncaClient.prompt() instead of pi/mmx. Lets the
// client-side streamAI router (lib/aiClient.ts) flip providers based
// on settings.activeAiAgent without per-callsite branching.
//
// MODE_DIRECTIVES + the trending/focus enrichment are intentionally
// kept consistent with /api/pi/prompt — `buildFocusBlock`,
// `buildTrendingQuery`, `pickFromPool`, and `dedupeByUrl` are imported
// from the pi route directly so they can't drift between routes. The
// remaining duplicated literals (FRESHNESS_POOL, TRENDING_FALLBACK_POOL,
// MODE_DIRECTIVES, the recent-URL cache, the numeric caps) mirror the
// mmx route 1:1 — TODO: extract to lib/ai-prompt-shared.ts when either
// route grows a third caller.

import { prompt as ncaPrompt, isAvailable, isAuthenticated } from '@/lib/nca-client';
import { getErrorMessage } from '@/lib/errors';
import { coerceMemory, formatMemoryForPrompt } from '@/lib/pipeline-memory';
import { webSearch, extractTrendingTags, type WebSearchResult } from '@/lib/web-search';
// CAMOFOX-CAMOUFOX-1.1.0 (2026-06-06): camofox sidecar for the
// trending-enrichment loop. nca is @deprecated 2026-06-02 (low
// priority) but kept consistent with the pi/mmx pattern. Dynamic
// import — see pi/route.ts for the rationale.
import { withCamofoxHealth } from '@/lib/camofox';
import {
  buildFocusBlock,
  buildTrendingQuery,
  pickFromPool,
  dedupeByUrl,
  type PiMode as PromptMode,
} from '@/app/api/pi/prompt/route';

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

// Per-route URL memory: kept separate from the pi/mmx caches so a switch
// between providers doesn't immediately serve stale URLs the previous
// provider already showed. Fine because the providers' result streams
// diverge anyway once they start generating.
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

  const { message, mode, systemPrompt, memory, niches, genres, model } = body || {};
  if (typeof message !== 'string' || !message.trim()) {
    return new Response(JSON.stringify({ error: 'message is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Pre-flight: surface nca unavailability or missing auth as a clean
  // 503 instead of a mid-stream error frame, so the client can retry
  // (or fall back to pi) deterministically. Same strategy as the mmx
  // route used.
  if (!(await isAvailable())) {
    return new Response(
      JSON.stringify({
        error:
          'nca CLI not available. Install the nca binary at /usr/local/bin/nca (or set NCA_BIN to its path) — see https://github.com/madebyaris/native-cli-ai.',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }
  if (!isAuthenticated()) {
    return new Response(
      JSON.stringify({
        error:
          'nca not authenticated. Set MINIMAX_API_KEY (or OPENAI_API_KEY / ANTHROPIC_API_KEY / OPENROUTER_API_KEY) in the environment for the provider you want.',
      }),
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
        // CAMOFOX-CAMOUFOX-1.1.0: same as the pi/mmx pattern. nca is
        // @deprecated, so this is a defensive consistency change
        // rather than a real improvement. Trending still falls back
        // to webSearch() on any camofox failure.
        const sessionKey = `nca-trending-${bucket}-${queries.indexOf(q)}`;
        const results = await withCamofoxHealth(
          () =>
            import('@/lib/camofox').then((m) =>
              m.camofoxSearch({
                userId: 'nca-route',
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

  const ncaModel = typeof model === 'string' && model.trim() ? model.trim() : undefined;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const delta of ncaPrompt(message, { systemPrompt: composedSystem, model: ncaModel })) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ text: delta })}\n\n`),
          );
        }
      } catch (e: unknown) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: getErrorMessage(e) || 'nca stream error' })}\n\n`,
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
