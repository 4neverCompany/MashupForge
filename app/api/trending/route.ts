import { NextRequest, NextResponse } from 'next/server';
import { getErrorMessage } from '@/lib/errors';

// V1.1.1-PIPELINE-TRENDING: camofox is added as a tertiary fan-out
// alongside SearXNG and Reddit. The original two-source design (SearXNG
// for news, Reddit JSON for franchise sub chatter) had a single point
// of failure: when SearXNG on `localhost:34567` was not running on a
// user's machine (the typical case — it's a dev-only meta-search that
// isn't required at runtime), the route silently returned zero results
// and the pipeline-mode trend-research step logged "No trending data
// found — proceeding without". v1.1.0's camofox wiring covered the
// prompt-routes and /api/web-search but missed /api/trending, so the
// pipeline kept failing this way.
//
// The fix: one camofox @google_search fetch per request, fired in
// parallel with the SearXNG/Reddit calls. The existing dedup-by-
// headline-prefix logic absorbs the overlap; camofox just fills the
// gap when SearXNG is unreachable.
import { withCamofoxHealth } from '@/lib/camofox';
import type { WebSearchResult } from '@/lib/web-search';

// Minimal shapes for external API responses — only the fields we actually use.
interface SearxResult { title?: string; url?: string; publishedDate?: string; pubdate?: string; date?: string; }
interface SearxResponse { results?: SearxResult[] }

interface RedditPost { title?: string; score?: number; subreddit?: string; permalink?: string; }
interface RedditResponse { data?: { children?: Array<{ data?: RedditPost }> } }

/**
 * Trending research endpoint for the content pipeline.
 *
 * Sources:
 *  1. SearXNG (self-hosted meta-search) on localhost:34567 — replaces
 *     Google News RSS, which returned stale and off-topic results for
 *     fandom/art queries. The time_range=week param ensures only
 *     recent indexed news.
 *  2. Reddit JSON — queried against a targeted franchise subreddit
 *     list, split across sort=hot (quality) and sort=new (freshness).
 *
 * Results are date-filtered (30-day cutoff for web hits that expose a
 * publishedDate), deduplicated, cached for 5 minutes, and returned
 * with a `note` field when the total drops below 3 so the caller can
 * surface a "limited data" hint.
 */

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
const SEARXNG_BASE = 'http://localhost:34567';
const WEB_RESULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function hostnameFromUrl(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return 'web';
  }
}

async function fetchSearxng(query: string): Promise<TrendResult[]> {
  try {
    const url = `${SEARXNG_BASE}/search?q=${encodeURIComponent(query)}&format=json&time_range=week&categories=news`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'MashupForge/1.0' },
    });
    if (!res.ok) return [];
    const data = await res.json() as SearxResponse;
    const items: TrendResult[] = [];
    const now = Date.now();
    for (const r of data?.results ?? []) {
      if (!r?.title || !r?.url) continue;
      // Reject anything older than 30 days IF we can parse a date.
      // Many SearXNG engines don't expose publishedDate; skip filter
      // in that case rather than drop the whole result.
      const rawDate = r.publishedDate || r.pubdate || r.date;
      if (rawDate) {
        const published = new Date(rawDate).getTime();
        if (!Number.isNaN(published) && now - published > WEB_RESULT_MAX_AGE_MS) continue;
      }
      items.push({
        topic: query,
        headline: String(r.title).trim(),
        source: hostnameFromUrl(r.url),
        url: r.url,
      });
      if (items.length >= 6) break;
    }
    return items;
  } catch {
    return [];
  }
}

async function fetchReddit(
  query: string,
  subreddits: string[] | undefined,
  sort: 'hot' | 'new' = 'hot'
): Promise<TrendResult[]> {
  try {
    let url: string;
    if (subreddits && subreddits.length > 0) {
      const subQuery = subreddits.join('+');
      url = `https://www.reddit.com/r/${subQuery}/search.json?q=${encodeURIComponent(query)}&sort=${sort}&t=week&limit=8&restrict_sr=on`;
    } else {
      url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=${sort}&t=week&limit=8`;
    }
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'MashupForge/1.0' },
    });
    if (!res.ok) return [];
    const data = await res.json() as RedditResponse;
    const items: TrendResult[] = [];
    // sort=new posts often have low scores because they're fresh;
    // drop the score floor there so genuinely new content surfaces.
    const minScore = sort === 'new' ? 1 : 5;
    for (const child of data?.data?.children ?? []) {
      const post = child.data;
      if (post?.title && (post?.score ?? 0) >= minScore) {
        items.push({
          topic: query,
          headline: `[${post.score}↑] ${post.title}`,
          source: `r/${post.subreddit}`,
          url: `https://reddit.com${post.permalink}`,
        });
      }
    }
    return items;
  } catch {
    return [];
  }
}

// V1.1.1-PIPELINE-TRENDING: camofox-backed web search. Used as the
// tertiary fan-out when SearXNG on `localhost:34567` isn't reachable
// (which is the typical case — it's a dev-only meta-search). The
// fallback returns `[]` so the route degrades to the original
// SearXNG+Reddit behavior on every camofox failure mode (down,
// rate-limited, blocked, 4xx-retry budget exhausted, etc.).
async function fetchCamofox(query: string): Promise<TrendResult[]> {
  try {
    const results = await withCamofoxHealth<WebSearchResult[]>(
      () =>
        import('@/lib/camofox').then((m) =>
          m.camofoxSearch({
            userId: 'trending-route',
            sessionKey: `trend-${Date.now()}`,
            macro: '@google_search',
            query,
            count: 6,
          }),
        ),
      // No fallback: SearXNG+Reddit are already in the fan-out, so a
      // camofox failure should not double-fire the same source.
      async () => [],
    );
    return results.map((r) => ({
      topic: query,
      headline: r.title,
      source: 'camofox',
      url: r.url,
    }));
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: TrendingRequest = await req.json();
    const { tags = [], niches = [], genres = [], ideaConcept = '' } = body;

    const cacheKeyParts = [...(tags || []), ...(niches || []), ...(genres || [])].sort();
    if (ideaConcept) cacheKeyParts.push(ideaConcept);
    const cacheKey = cacheKeyParts.join('|');

    const cached = trendCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return NextResponse.json({
        success: true,
        results: cached.results,
        summary: cached.results.slice(0, 15).map(item => `- [${item.source}] ${item.headline}`).join('\n'),
        queriesUsed: ['(cached)'],
        note: cached.note,
      });
    }

    // Franchise → targeted subreddits. Order matters: the first few
    // entries for each franchise are its main subs, deeper entries are
    // lore/discussion subs that often have slower but richer threads.
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

    const allTopics = [...new Set([...tags, ...niches])];
    const lowerNiches = allTopics.map(n => n.toLowerCase());
    const currentYear = new Date().getUTCFullYear();

    // Freshness-biased query construction. For each active niche we
    // ask for "news YEAR", "announcement", and "new release" so the
    // search engines are forced to surface recent content instead of
    // the all-time-top art posts.
    const freshTerms: string[] = [];
    const crossoverTerms: string[] = [];
    const ideaTerms: string[] = [];

    for (const topic of allTopics.slice(0, 4)) {
      freshTerms.push(`${topic} news ${currentYear}`);
      freshTerms.push(`${topic} announcement`);
      freshTerms.push(`${topic} new release upcoming`);
    }

    const franchisePairs: string[][] = [];
    for (let i = 0; i < lowerNiches.length && franchisePairs.length < 3; i++) {
      for (let j = i + 1; j < lowerNiches.length && franchisePairs.length < 3; j++) {
        franchisePairs.push([lowerNiches[i], lowerNiches[j]]);
      }
    }
    for (const [a, b] of franchisePairs) {
      crossoverTerms.push(`${a} ${b} crossover art`);
    }

    if (ideaConcept) {
      const keywords = ideaConcept
        .split(/[\s,;.]+/)
        .filter(w => w.length > 3 && !['with', 'from', 'that', 'this', 'what', 'where', 'when', 'wielding', 'wearing', 'standing', 'fighting'].includes(w.toLowerCase()))
        .slice(0, 4);
      if (keywords.length > 0) {
        ideaTerms.push(keywords.join(' '));
      }
    }

    // Cap: freshTerms drive the freshness angle (web + reddit hot),
    // crossoverTerms power the art-sub search (reddit hot), ideaTerms
    // add specificity. Total fetches stay bounded.
    const webTerms = [...new Set([...freshTerms, ...ideaTerms])].slice(0, 6);
    const redditHotTerms = [...new Set([...freshTerms, ...crossoverTerms, ...ideaTerms])].slice(0, 6);
    const redditNewTerms = [...new Set(freshTerms)].slice(0, 3);

    // Build the targeted sub list per matched franchise, union'd with
    // the art subs. Cap at 12 so the r/a+b+c+... path stays short.
    const targetedSubs: string[] = [...ART_SUBREDDITS];
    for (const niche of lowerNiches) {
      for (const [franchise, subs] of Object.entries(FRANCHISE_SUBREDDITS)) {
        if (niche.includes(franchise)) {
          targetedSubs.push(...subs);
        }
      }
    }
    const uniqueSubs = [...new Set(targetedSubs.map(s => s.trim()).filter(Boolean))].slice(0, 12);

    // Dispatch everything in parallel.
    const fetches: Promise<TrendResult[]>[] = [
      ...webTerms.map(t => fetchSearxng(t)),
      ...redditHotTerms.map(t => fetchReddit(t, uniqueSubs, 'hot')),
      ...redditNewTerms.map(t => fetchReddit(t, uniqueSubs, 'new')),
    ];

    // V1.1.1-PIPELINE-TRENDING: camofox fan-out. One search per
    // request, fired alongside the SearXNG+Reddit calls. The query
    // is the same top-of-bag web term the SearXNG fan-out would
    // use, so the result overlap is intentional — camofox just
    // adds CAPTCHA-resilient web results when SearXNG is offline
    // (the failure mode this fix targets). The dedup step below
    // collapses the overlap.
    //
    // `withCamofoxHealth` returns `[]` if camofox is unavailable
    // so the route degrades gracefully to the original
    // SearXNG+Reddit behavior. Per-search timeout is the
    // `withCamofoxHealth` default (60s); the enclosing 8s
    // SearXNG/Reddit timeouts don't apply here.
    if (webTerms.length > 0) {
      const camofoxQuery = `${allTopics.slice(0, 3).join(' ')} news ${currentYear}`;
      fetches.push(fetchCamofox(camofoxQuery));
    }

    const allResults: TrendResult[] = [];
    const settled = await Promise.allSettled(fetches);
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        allResults.push(...result.value);
      }
    }

    // Deduplicate by headline prefix (strips Reddit score bracket so
    // the same title doesn't land twice from hot + new).
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
      .map(item => `- [${item.source}] ${item.headline}`)
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
        web: webTerms,
        redditHot: redditHotTerms,
        redditNew: redditNewTerms,
      },
      note,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(e), results: [], summary: '' },
      { status: 500 }
    );
  }
}
