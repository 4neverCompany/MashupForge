import { prompt as piPrompt, start as piStart, isRunning } from '@/lib/pi-client';
import { getErrorMessage } from '@/lib/errors';
import { coerceMemory, formatMemoryForPrompt } from '@/lib/pipeline-memory';
import { webSearch, extractTrendingTags, type WebSearchResult } from '@/lib/web-search';
// CAMOFOX-CAMOUFOX-1.1.0 (2026-06-06): camofox sidecar integration
// (Day 2 of v1.1.0). The `withCamofoxHealth` wrapper tries camofox
// first (anti-bot stealth browser) and falls back to `webSearch()`
// (DDG + Brave) if camofox is down. Trending is optional enrichment
// so a camofox failure must never break the user-facing prompt.
import { withCamofoxHealth } from '@/lib/camofox';

/**
 * POST /api/pi/prompt
 *   { message, mode?, systemPrompt?, memory?, niches?, genres? }
 *
 * Returns text/event-stream:
 *   data: {"text":"<delta>"}\n\n
 *   ...
 *   data: {"error":"..."}\n\n   (on failure)
 *   data: [DONE]\n\n
 *
 * `mode` maps to a mode-specific system directive that is prepended to
 * the user message (pi ignores the RPC `system` field, so per-request
 * customization has to go into the prompt body itself).
 *
 * `systemPrompt` is an additional freeform system instruction from the
 * caller (typically the user's Settings-panel system prompt). It's
 * layered after the mode directive.
 *
 * `memory` is the client's PipelineMemory snapshot (localStorage-backed).
 * It's only consulted for `idea` and `generate` modes — other modes don't
 * benefit from cross-call coherence and we'd rather keep their prompts
 * tight.
 *
 * `niches` / `genres` come from Settings and shape the trending web-search
 * query for `idea` mode (see buildTrendingQuery). Without them, the search
 * falls back to a generic "crossover fan art" probe, which is why every
 * run used to surface the same cyberpunk results.
 *
 * Memory + trending blocks are injected BEFORE the mode directive so the
 * LLM reads them as standing context.
 */

const TRENDING_PER_QUERY_COUNT = 2;
const TRENDING_MAX_RESULTS = 6;
const TRENDING_MAX_CHARS = 900; // ≈ 150 words
const TRENDING_SNIPPET_CHARS = 220;
const TRENDING_TAG_LIMIT = 10;
const DEFAULT_NICHES = ['Star Wars', 'Marvel', 'Warhammer 40k'];

/**
 * Freshness/suffix pool. A single fixed suffix ("trending 2026") caused
 * every idea run to collapse onto the same top-ranked pages. Rotating
 * across a small pool of period + framing modifiers perturbs the query
 * enough that DDG/Brave return different canonical pages each time
 * without departing from the "what's trending right now" intent.
 */
const FRESHNESS_POOL = [
  'trending 2026',
  'trending this week',
  'new this month',
  'latest 2026',
  'recent buzz',
  'viral this year',
];

/**
 * Fallback-query pool. Used when niche-derived queries come up empty or
 * as the third probe per run. Previously a single hardcoded string, which
 * meant at least 2 duplicate results pinned to every pipeline run.
 */
const TRENDING_FALLBACK_POOL = [
  'popular crossover fan art new characters 2026',
  'viral mashup character concepts fandom 2026',
  'best crossover art reddit twitter recent',
  'trending fandom crossover illustrations this month',
  'new fan-made character mashups buzz',
];

/**
 * Cross-run URL exclusion. `webSearch` is stateless and DDG/Brave pin
 * the same top result for similar queries, so the trending block ended
 * up echoing the same 2–3 subreddit pages on every idea run. A capped
 * FIFO Set of recently-emitted URLs lets us drop any hit we've shown in
 * the last ~N runs so each run surfaces fresh material even when the
 * query rotation produces overlapping result sets. Module scope persists
 * across requests in the long-lived desktop Node process; HMR/serverless
 * cold starts will reset it, which is an acceptable degradation.
 */
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

/**
 * 15-minute time bucket. Keeps results stable inside a burst of related
 * requests but rotates across hours so consecutive pipeline runs pick
 * different pool entries.
 */
function currentRotationBucket(): number {
  return Math.floor(Date.now() / (1000 * 60 * 15));
}

/**
 * Deterministic pool picker keyed by the rotation bucket + an offset so
 * the fallback query doesn't align with the freshness suffix.
 */
export function pickFromPool<T>(pool: readonly T[], offset: number, bucket: number): T {
  if (pool.length === 0) throw new Error('pickFromPool called with empty pool');
  const idx = Math.abs((bucket + offset) % pool.length);
  return pool[idx];
}

function sanitizeStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim());
}

/**
 * V080-DES-003 — Build a "focus" system-prompt block from the user's
 * configured niches/genres. Added to the composed system prompt on every
 * mode (not just `idea`) so captions, enhances, tags etc. reflect the
 * user's settings without each caller having to re-word the agentPrompt.
 *
 * Returns an empty string when both arrays are empty so the caller's
 * `.filter(Boolean)` drops it cleanly.
 */
export function buildFocusBlock(niches: string[], genres: string[]): string {
  if (niches.length === 0 && genres.length === 0) return '';
  const nicheClause =
    niches.length > 0 ? `The user creates content in: ${niches.join(', ')}.` : '';
  const genreClause =
    genres.length > 0 ? `Favor themes and styles like: ${genres.join(', ')}.` : '';
  return ['Focus areas:', nicheClause, genreClause, 'Every output should visibly reflect these areas.']
    .filter(Boolean)
    .join(' ');
}

/**
 * Build the trending-context query from the user's active niches/genres.
 *
 * Picks 2 niches to diversify results — a single fixed query was returning
 * the same cyberpunk thumbnails on every idea run. Two niches joined with
 * "x" rhymes with the crossover framing the LLM already uses ("Darth
 * Vader x Warhammer") and gives DDG/Brave a specific enough signal to
 * surface fresh fan-art coverage.
 *
 * `rng` is injectable so tests can pin a deterministic shuffle.
 */
export function buildTrendingQuery(
  niches?: string[],
  genres?: string[],
  rng: () => number = Math.random,
  freshness: string = 'trending 2026',
  genreIndex: number = 0,
): string {
  const cleanedNiches = sanitizeStringArray(niches);
  const active = cleanedNiches.length > 0 ? cleanedNiches : DEFAULT_NICHES;

  const shuffled = [...active];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const pick = shuffled.slice(0, Math.min(2, shuffled.length));

  const cleanedGenres = sanitizeStringArray(genres);
  // Rotate which genre drives the query across calls. With a single
  // genre this degenerates to index 0 (original behavior); with several
  // configured, consecutive runs touch different ones so the search
  // intent shifts instead of always anchoring on cleanedGenres[0].
  const genreHint =
    cleanedGenres.length > 0
      ? cleanedGenres[Math.abs(genreIndex) % cleanedGenres.length]
      : '';

  return [pick.join(' x '), 'crossover fan art', genreHint, freshness]
    .filter((s) => s.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatTrendingContext(results: WebSearchResult[]): string {
  if (!results || results.length === 0) return '';
  // Framing matters: an earlier version ran a single search and led with
  // "treat as signal, not ground truth", which the LLM still interpreted
  // as "theme every idea around whatever is trending" — observable as 4/4
  // cyberpunk ideas when r/Cyberpunk dominated the result set. The
  // rewrite makes the subordinate role explicit and repeats the "niches
  // are the real constraint" directive twice, which empirically is what
  // it takes to stop the LLM from defaulting to the trending universe.
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

/**
 * Dedupe by URL, preserving first-seen order. Different search queries
 * frequently surface the same top-ranked result, so without dedup the
 * trending block fills up with duplicate entries of whatever subreddit
 * or news site is dominating at the moment.
 */
export function dedupeByUrl(results: WebSearchResult[]): WebSearchResult[] {
  const seen = new Set<string>();
  const out: WebSearchResult[] = [];
  for (const r of results) {
    const key = r.url;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export type PiMode =
  | 'chat'
  | 'generate'
  | 'idea'
  | 'enhance'
  | 'caption'
  | 'tag'
  | 'negative-prompt'
  | 'collection-info';

const MODE_DIRECTIVES: Record<PiMode, string> = {
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

  // Ensure pi is running — start it lazily on first prompt.
  try {
    if (!isRunning()) {
      await piStart();
    }
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: getErrorMessage(e) || 'pi not available' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const directive = directiveFor(mode);

  // Enrichment is split into pre-directive (memory — sets the standing
  // state the LLM should remember) and post-directive (trending — flavor
  // only). This ordering was deliberate: a previous version put trending
  // before the mode directive and the LLM read it as the headline brief,
  // producing 4/4 cyberpunk ideas when the cyberpunk subreddit dominated
  // trending. Putting the directive first makes the niche/genre
  // constraint primary; trending becomes a footnote.
  //
  // Everything here is best-effort: a web-search failure, a corrupt
  // memory blob, or an empty memory all degrade to the pre-enrichment
  // prompt, never to an error.
  const preBlocks: string[] = [];
  const postBlocks: string[] = [];

  // V080-DES-003 — compute focus block once per request so every mode
  // benefits, not just `idea` (which also uses niches/genres below to
  // build its trending-search query).
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
    const cleanedNiches = focusNiches;
    const cleanedGenres = focusGenres;

    // Three queries instead of one: two niche-tailored shuffles (the
    // Fisher-Yates in buildTrendingQuery reseeds from Math.random on each
    // call, so consecutive calls pick different pairings) with different
    // freshness / genre rotations, plus a rotating-pool fallback probe
    // that's immune to a weirdly-focused niche set. Aggregated results
    // are filtered against the recent-URL memory, deduped, and capped so
    // the trending block can't balloon past our token budget.
    const bucket = currentRotationBucket();
    const freshA = pickFromPool(FRESHNESS_POOL, 0, bucket);
    const freshB = pickFromPool(FRESHNESS_POOL, 3, bucket);
    const fallback = pickFromPool(TRENDING_FALLBACK_POOL, 1, bucket);
    const queries = [
      buildTrendingQuery(cleanedNiches, cleanedGenres, Math.random, freshA, bucket),
      buildTrendingQuery(cleanedNiches, cleanedGenres, Math.random, freshB, bucket + 1),
      fallback,
    ];

    const allResults: WebSearchResult[] = [];
    for (const q of queries) {
      try {
        // CAMOFOX-CAMOUFOX-1.1.0: route trending queries through the
        // camofox sidecar first, fall back to webSearch() on any
        // camofox failure. The sessionKey includes the query index
        // so concurrent in-flight calls don't share tabs.
        const sessionKey = `pi-trending-${bucket}-${queries.indexOf(q)}`;
        const results = await withCamofoxHealth(
          () =>
            // Dynamic import keeps the camofox client out of the
            // web-only critical path. If a route handler is invoked
            // in an environment where `@/lib/camofox` fails to load
            // (e.g. SSR with no node-fetch), the dynamic import
            // throws and the wrapper falls back to webSearch.
            import('@/lib/camofox').then((m) =>
              m.camofoxSearch({
                userId: 'pi-route',
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
        /* silent — trending is optional enrichment */
      }
    }

    // Filter against the recent-URL memory BEFORE dedup + cap: if every
    // query happened to return the same stale URL, the user would still
    // see nothing fresh. Filtering first gives new material a chance to
    // fill the budget before the cap kicks in. If filtering strips
    // everything (e.g. the memory saturated after many runs with a
    // narrow niche), fall back to the raw set so enrichment degrades to
    // "duplicated" rather than "empty".
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
        for await (const delta of piPrompt(message, { systemPrompt: composedSystem })) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ text: delta })}\n\n`)
          );
        }
      } catch (e: unknown) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: getErrorMessage(e) || 'pi stream error' })}\n\n`
          )
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
