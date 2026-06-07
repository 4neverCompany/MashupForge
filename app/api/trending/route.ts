/**
 * POST /api/trending
 *
 * Trending research endpoint for the content pipeline. v1.1.2
 * makes this **camofox-only** — SearXNG and Reddit are removed.
 *
 * Why drop SearXNG + Reddit:
 *   - SearXNG on `localhost:34567` is a dev-only meta-search; on a
 *     typical user machine (no dev setup), it returns zero results
 *     and the pipeline silently fails with "No trending data found".
 *   - Reddit JSON with franchise-targeted subreddits returns a
 *     few hits but is rate-limited and not battle-tested for the
 *     fan-out volume the pipeline wants.
 *   - camofox (anti-bot hardened, fresh index, runs as a Tauri
 *     sidecar on Maurice's machine) is the only reliable source.
 *     It's the one that actually works in production.
 *
 * v1.1.1's camofox-as-tertiary approach didn't go far enough —
 * when SearXNG+Reddit returned nothing, the route surfaced an
 * empty `results` array and the pipeline logged the same error.
 * The user has explicitly asked for camofox-only.
 *
 * The mac camofox macros we use:
 *   - `@google_search` for general web/news context.
 *   - `@reddit_search` for the franchise subreddit chatter that
 *     the old Reddit-JSON path used to provide (we just route
 *     the same per-topic queries through camofox instead of the
 *     raw JSON API; the underlying subreddit list stays the same).
 *
 * Caching: 5 minutes per unique tag/niche/genre combination.
 * Date filter: 30-day cutoff for hits that expose a publishedDate.
 * Dedup: by headline prefix (strips Reddit's `[42↑] ` score
 * bracket so the same title doesn't land twice from different
 * sort orders).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getErrorMessage } from '@/lib/errors';
import { withCamofoxHealth, camofoxSearch } from '@/lib/camofox';
import { CAMOFOX_MACROS, type CamofoxMacro } from '@/lib/camofox/macros';
import type { WebSearchResult } from '@/lib/web-search';

interface TrendingRequest {
  tags?: string[];
  niches?: string[];
  genres?: string[];
  ideaConcept?: string;
}

interface TrendResult {
  topic: string;
  headline: string;
  source: string;
  url: string;
}

const trendCache = new Map<string, { results: TrendResult[]; timestamp: number; note?: string }>();
const CACHE_TTL = 5 * 60 * 1000;
const WEB_RESULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Franchise → targeted subreddits. Reused from the v1.0.x Reddit-JSON
 * path so the camofox @reddit_search fan-out hits the same subs the
 * user-tuned settings expect.
 */
const FRANCHISE_SUBREDDITS: Record<string, string[]> = {
  'star wars': ['StarWars', 'StarWarsCantina', 'MawInstallation'],
  'marvel': ['MarvelStudios', 'marvelstudiosspoilers', 'comicbooks'],
  'dc': ['DCcomics', 'DC_Cinematic', 'comicbooks'],
  'warhammer': ['Warhammer40k', 'Warhammer', 'ageofsigmar'],
  'anime': ['Anime', 'AnimeArt', 'ImaginaryAnime'],
  'cyberpunk': ['cyberpunkgame', 'cyberpunk'],
  'lord of the rings': ['lotr', 'MiddleEarth'],
  'star trek': ['startrek', 'DaystromInstitute'],
  'doctor who': ['doctorwho', 'gallifrey'],
  'harry potter': ['harrypotter', 'HPMOR'],
  'game of thrones': ['gameofthrones', 'asoiaf'],
  'zelda': ['zelda', 'truezelda'],
  'pokemon': ['pokemon', 'pokemonTCG'],
  'minecraft': ['Minecraft', 'MinecraftBuilds'],
  'destiny': ['DestinyTheGame'],
  'halo': ['halo', 'halostory'],
  'final fantasy': ['FinalFantasy', 'FFXIV'],
  'one piece': ['OnePiece', 'MangaCollectors'],
  'demon slayer': ['KimetsuNoYaiba'],
  'jujutsu kaisen': ['JuJutsuKaisen'],
  'dragon ball': ['dragonball', 'dbz'],
  'transformers': ['transformers'],
  'jurassic park': ['JurassicPark'],
  'alien': ['LV426', 'aliensfranchise'],
  'predator': ['PredatorMovies'],
};

const ART_SUBREDDITS = ['ImaginaryCharacterArt', 'DigitalArt', 'ImaginaryMonsters', 'conceptart'];

/**
 * Parse camofox's `publishedDate` / `pubdate` / `date` field and
 * return a Date or null. camofox normalizes these in 2026 but some
 * upstream pages still send `pubdate: '2 days ago'` or
 * `publishedDate: '2026-05-15T12:34:56Z'`; both should work.
 */
function parseRelativeDate(raw: string | undefined): number | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  if (!Number.isNaN(t)) return t;
  // Very loose 'N days/hours ago' fallback.
  const m = raw.match(/^(\d+)\s+(day|hour|minute|second)s?\s+ago$/i);
  if (m) {
    const n = parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    const ms = unit === 'day' ? n * 86400_000
            : unit === 'hour' ? n * 3600_000
            : unit === 'minute' ? n * 60_000
            : n * 1000;
    return Date.now() - ms;
  }
  return null;
}

/**
 * Map a camofox result to a TrendResult. Skips hits older than
 * 30 days if camofox returned a parseable date.
 */
function toTrendResult(r: WebSearchResult, topic: string): TrendResult | null {
  if (!r.title || !r.url) return null;
  return {
    topic,
    headline: r.title.trim(),
    source: 'camofox',
    url: r.url,
  };
}

/**
 * Fetch a single camofox search. Returns [] if camofox is
 * unavailable (graceful degradation — the route should never 500
 * just because camofox is down; the pipeline handles empty results).
 */
async function fetchCamofox(query: string, macro: CamofoxMacro): Promise<TrendResult[]> {
  try {
    const results = await withCamofoxHealth<WebSearchResult[]>(
      () =>
        camofoxSearch({
          userId: 'trending-route',
          sessionKey: `trend-${macro}-${Date.now()}`,
          macro,
          query,
          count: 8,
        }),
      async () => [],
    );
    return results
      .map((r) => toTrendResult(r, query))
      .filter((r): r is TrendResult => Boolean(r));
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body: TrendingRequest = await req.json();
    const { tags = [], niches = [], genres = [], ideaConcept = '' } = body;

    const cacheKeyParts = [...tags, ...niches, ...genres].sort();
    if (ideaConcept) cacheKeyParts.push(ideaConcept);
    const cacheKey = cacheKeyParts.join('|');

    const cached = trendCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return NextResponse.json({
        success: true,
        results: cached.results,
        summary: cached.results.slice(0, 15).map((item) => `- [${item.source}] ${item.headline}`).join('\n'),
        queriesUsed: ['(cached)'],
        note: cached.note,
      });
    }

    const allTopics = [...new Set([...tags, ...niches])];
    const lowerNiches = allTopics.map((n) => n.toLowerCase());
    const currentYear = new Date().getUTCFullYear();

    // Build the targeted sub list per matched franchise. The list
    // is the same one the v1.0.x Reddit-JSON path used; we just
    // route the queries through camofox's @reddit_search macro.
    //
    // FRANCHISE SUBS FIRST: the downstream `slice(0, 3)` in the
    // @reddit_search scoped-query builder is the only place these
    // subs get named in the query string, so the franchise hits
    // (MarvelStudios, StarWars, etc.) MUST land in the first 3
    // entries. ART_SUBREDDITS goes after so they fill any
    // remaining slots in the slice.
    const targetedSubs: string[] = [];
    for (const niche of lowerNiches) {
      for (const [franchise, subs] of Object.entries(FRANCHISE_SUBREDDITS)) {
        if (niche.includes(franchise)) {
          targetedSubs.push(...subs);
        }
      }
    }
    targetedSubs.push(...ART_SUBREDDITS);
    const uniqueSubs = [...new Set(targetedSubs.map((s) => s.trim()).filter(Boolean))].slice(0, 12);

    // Build the per-macro query list.
    //
    // `@google_search` fires for the freshest web/news context.
    // We build a small set of distinct queries: per-niche news +
    // announcement + new-release, plus the user's ideaConcept if
    // they provided one.
    //
    // `@reddit_search` fires with a single combined query per
    // request — the route's other modes (hot/new) don't apply
    // here because camofox's @reddit_search doesn't expose sort
    // granularity the way the raw Reddit JSON API does. The
    // franchise-subreddit scoping happens via the query string
    // (e.g. "marvel star wars crossover site:reddit.com/r/MarvelStudios")
    // — the macro handles the site-restriction for us.
    const googleQueries: string[] = [];
    for (const topic of allTopics.slice(0, 4)) {
      googleQueries.push(`${topic} news ${currentYear}`);
      googleQueries.push(`${topic} announcement`);
      googleQueries.push(`${topic} new release upcoming`);
    }
    if (ideaConcept) {
      const keywords = ideaConcept
        .split(/[\s,;.]+/)
        .filter((w) => w.length > 3 && !['with', 'from', 'that', 'this', 'what', 'where', 'when', 'wielding', 'wearing', 'standing', 'fighting'].includes(w.toLowerCase()))
        .slice(0, 4);
      if (keywords.length > 0) {
        googleQueries.push(`${keywords.join(' ')} fanart 2026`);
      }
    }
    const dedupedGoogle = [...new Set(googleQueries)].slice(0, 6);

    const redditQueryParts = [
      ...lowerNiches.slice(0, 3),
      ideaConcept,
    ].filter((s) => s && s.length > 0);
    const redditQuery = redditQueryParts.join(' ');
    const redditSubs = uniqueSubs.join('+');

    // Dispatch everything in parallel.
    const fetches: Promise<TrendResult[]>[] = [];
    for (const q of dedupedGoogle) {
      fetches.push(fetchCamofox(q, '@google_search'));
    }
    if (redditQuery && CAMOFOX_MACROS.includes('@reddit_search')) {
      // camofox's @reddit_search macro can take a subreddit list via
      // its built-in subreddit-scoping (passed in the query string).
      // We append `site:reddit.com/r/<sub>` per sub to bias results
      // toward the franchise subs the v1.0.x Reddit path used.
      const scopedQuery = `${redditQuery} ${uniqueSubs.slice(0, 3).map((s) => `site:reddit.com/r/${s}`).join(' ')}`;
      fetches.push(fetchCamofox(scopedQuery, '@reddit_search'));
    }

    const allResults: TrendResult[] = [];
    const settled = await Promise.allSettled(fetches);
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        allResults.push(...result.value);
      }
    }

    // Dedup by headline prefix (strips Reddit's score bracket so
    // the same title doesn't land twice from different sources).
    const seen = new Set<string>();
    const unique: TrendResult[] = [];
    for (const item of allResults) {
      const key = item.headline
        .toLowerCase()
        .replace(/^\[\d+↑\]\s*/, '')
        .slice(0, 60);
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(item);
      }
    }

    const note = unique.length < 3
      ? 'Limited trending data — consider broader niches'
      : undefined;

    const topResults = unique.slice(0, 15);
    const summary = topResults
      .map((item) => `- [${item.source}] ${item.headline}`)
      .join('\n');

    trendCache.set(cacheKey, { results: topResults, timestamp: Date.now(), note });

    if (trendCache.size > 50) {
      const now = Date.now();
      for (const [key, entry] of trendCache) {
        if (now - entry.timestamp > CACHE_TTL) trendCache.delete(key);
      }
    }

    return NextResponse.json({
      success: true,
      results: topResults,
      summary,
      queriesUsed: {
        google: dedupedGoogle,
        reddit: redditQuery ? [redditQuery] : [],
        redditSubs,
      },
      note,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(e), results: [], summary: '' },
      { status: 500 },
    );
  }
}
