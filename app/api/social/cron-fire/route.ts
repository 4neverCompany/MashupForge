// SCHED-POST-ROBUST: cron entry point.
//
// Hit by GitHub Actions every 5 minutes (or workflow_dispatch). Drains
// every due post from the queue and fires it via the existing
// /api/social/post route — we forward through HTTP so the cron path
// inherits all of /api/social/post's battle-tested platform-specific
// quirks (IG container polling, image-aspect padding, retry logic) and
// we don't have to refactor 500+ LOC of shared executor.
//
// Auth: requires `Authorization: Bearer <CRON_SHARED_SECRET>` matching
// the env var, compared in constant time. Without the env var set, the
// route returns 503 — never deploy this without the secret configured.
//
// Returns a JSON summary of what was attempted: useful in workflow logs
// and as a smoke test via `curl -H 'Authorization: Bearer …'`.

import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { claimDuePosts, markResult, type EnqueuedPost, type QueueResult } from '@/lib/server-queue';
import { getErrorMessage } from '@/lib/errors';

// timingSafeEqual + the @upstash/redis client (via server-queue) both
// need Node APIs that the edge runtime omits.
export const runtime = 'nodejs';

// IG-UPSTASH-FIX: surface a warning when the long-lived token is within
// this many days of expiry. The cron response JSON bubbles up into
// GitHub Actions logs, giving Maurice >= a week of lead time to refresh.
const TOKEN_WARN_DAYS = 10;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

interface FireSummary {
  claimed: number;
  posted: number;
  failed: number;
  posts: Array<{ id: string; status: 'posted' | 'failed'; error?: string }>;
  // Present only when INSTAGRAM_TOKEN_EXPIRES_AT is set and < TOKEN_WARN_DAYS away.
  tokenWarning?: string;
}

/**
 * Read INSTAGRAM_TOKEN_EXPIRES_AT (Unix ms). If it's within TOKEN_WARN_DAYS
 * of `now`, return a human-readable warning string for the response JSON.
 * Returns undefined when the env var is missing, malformed, or comfortably
 * far from expiry. Negative-day cases (already expired) still surface a
 * warning so the operator can react.
 */
function tokenExpiryWarning(now: number): string | undefined {
  const raw = process.env.INSTAGRAM_TOKEN_EXPIRES_AT;
  if (!raw) return undefined;
  const expiresAt = Number.parseInt(raw, 10);
  if (!Number.isFinite(expiresAt)) return undefined;
  const msLeft = expiresAt - now;
  const daysLeft = Math.floor(msLeft / ONE_DAY_MS);
  if (daysLeft >= TOKEN_WARN_DAYS) return undefined;
  if (msLeft <= 0) {
    return 'Instagram token EXPIRED — refresh immediately (POST /api/social/instagram-refresh)';
  }
  return `Instagram token expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'} — refresh soon (POST /api/social/instagram-refresh)`;
}

// CWE-208 fix: the prior hand-rolled XOR-fold short-circuited on a length
// mismatch, which leaks the expected secret's length via timing. Defer to
// Node's `crypto.timingSafeEqual` — runtime-guaranteed constant-time. The
// outer length check is still required (timingSafeEqual throws on
// mismatched buffer sizes) but the secret-length leak is acceptable: an
// attacker can already enumerate plausible secret lengths trivially; what
// timingSafeEqual prevents is per-byte bisection of the secret itself.
function safeEqual(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

function checkAuth(req: Request): { ok: true } | { ok: false; res: Response } {
  const expected = process.env.CRON_SHARED_SECRET;
  if (!expected) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: 'CRON_SHARED_SECRET not configured on server' },
        { status: 503 },
      ),
    };
  }
  const header = req.headers.get('authorization') || '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!presented || !safeEqual(presented, expected)) {
    return {
      ok: false,
      res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }
  return { ok: true };
}

/**
 * Group claimed posts by carouselGroupId. Same logic as the browser
 * auto-poster: posts sharing a carouselGroupId fire as one multi-image
 * publish, not N separate publishes.
 */
function groupForFire(posts: EnqueuedPost[]): EnqueuedPost[][] {
  const byGroup = new Map<string, EnqueuedPost[]>();
  const singles: EnqueuedPost[] = [];
  for (const p of posts) {
    if (p.carouselGroupId) {
      const arr = byGroup.get(p.carouselGroupId) ?? [];
      arr.push(p);
      byGroup.set(p.carouselGroupId, arr);
    } else {
      singles.push(p);
    }
  }
  return [...Array.from(byGroup.values()), ...singles.map((s) => [s])];
}

/**
 * Fire one group (single post or carousel) via /api/social/post.
 * SCHED-CRON-CREDS-FIX: credentials come from the enqueued post's own
 * snapshot (captured at schedule time from the browser's settings) and
 * fall back to {} only when the post predates the credential field —
 * /api/social/post's env-fallback chain still picks up server-side
 * env vars when the snapshot is empty.
 */
async function fireOne(
  group: EnqueuedPost[],
  baseUrl: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const head = group[0];
  const isCarousel = group.length > 1 || (head.mediaUrls && head.mediaUrls.length > 0);
  const credentials = head.credentials ?? {};
  const body = isCarousel
    ? {
        caption: head.caption,
        platforms: head.platforms,
        mediaUrls: head.mediaUrls ?? group.map((g) => g.mediaUrl).filter((u): u is string => !!u),
        credentials,
      }
    : {
        caption: head.caption,
        platforms: head.platforms,
        mediaUrl: head.mediaUrl,
        credentials,
      };

  try {
    const res = await fetch(`${baseUrl}/api/social/post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let detail = '';
      try {
        const data = (await res.json()) as { error?: string };
        detail = data.error ?? '';
      } catch {
        detail = await res.text().catch(() => '');
      }
      return { ok: false, error: `HTTP ${res.status}: ${detail || 'no detail'}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) };
  }
}

async function handle(req: Request): Promise<Response> {
  const auth = checkAuth(req);
  if (!auth.ok) return auth.res;

  const baseUrl =
    process.env.APP_URL ||
    process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}` ||
    new URL(req.url).origin;

  let claimed: EnqueuedPost[];
  try {
    claimed = await claimDuePosts(Date.now());
  } catch (e) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 503 });
  }

  const summary: FireSummary = { claimed: claimed.length, posted: 0, failed: 0, posts: [] };
  const groups = groupForFire(claimed);

  for (const group of groups) {
    const outcome = await fireOne(group, baseUrl);
    const at = Date.now();
    for (const post of group) {
      const result: QueueResult = outcome.ok
        ? { id: post.id, status: 'posted', at, ...(post.carouselGroupId ? { carouselGroupId: post.carouselGroupId } : {}) }
        : { id: post.id, status: 'failed', at, error: outcome.error, ...(post.carouselGroupId ? { carouselGroupId: post.carouselGroupId } : {}) };
      try {
        await markResult(result);
      } catch {
        // Result write failed — the post still fired (or failed) on the
        // social platform; surfacing in the response is the best we can do.
      }
      summary.posts.push({
        id: post.id,
        status: result.status,
        ...(result.error ? { error: result.error } : {}),
      });
      if (outcome.ok) summary.posted += 1;
      else summary.failed += 1;
    }
  }

  const warning = tokenExpiryWarning(Date.now());
  if (warning) summary.tokenWarning = warning;
  return NextResponse.json(summary);
}

export const POST = handle;
// GET also accepted so workflow_dispatch / curl smoke-test is convenient
// (still requires the bearer token).
export const GET = handle;
