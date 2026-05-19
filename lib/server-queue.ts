// SCHED-POST-ROBUST — server-side scheduled post queue, backed by Upstash Redis.
//
// Why Redis: scheduled posts live in the user's browser by default (IDB).
// When the browser is closed, the client-side auto-poster doesn't fire.
// This module is the server-side counterpart: when `serverCronEnabled`,
// the browser also pushes its scheduled posts here, and a GitHub Actions
// cron hits /api/social/cron-fire every 5 minutes to drain due posts.
//
// Layout:
//   mashup:queue:scheduled — ZSET. Member = post id, score = fire-time (epoch ms).
//   mashup:queue:posts     — HASH. Field = post id, value = JSON(EnqueuedPost).
//   mashup:queue:results   — HASH. Field = post id, value = JSON(QueueResult).
//
// The ZSET is the source of truth for "what is still pending" — atomic claim
// happens via ZREM (returns 1 only to the caller that successfully removed it).
// Posts hash holds payload separate from the schedule index so we can update
// metadata without touching the score, and so HDEL after firing keeps the
// store small.

import { Redis } from '@upstash/redis';

/** Per-platform credential snapshot the browser sends with each schedule
 *  push so the cron path can post on the user's behalf without depending
 *  on server env vars. Same shape as the credentials object that the
 *  browser auto-poster sends to /api/social/post (see MainContent.tsx
 *  buildCredentialsPayload), so /api/social/post needs no schema changes. */
export interface SocialCredentials {
  instagram?: { accessToken: string; igAccountId: string };
  twitter?: { appKey: string; appSecret: string; accessToken: string; accessSecret: string };
  pinterest?: { accessToken: string; boardId?: string };
  discord?: { webhookUrl?: string };
}

export interface EnqueuedPost {
  /** Stable id matching the browser-side ScheduledPost.id. */
  id: string;
  /** ISO date YYYY-MM-DD — kept for parity with browser shape. */
  date: string;
  /** HH:mm — kept for parity. */
  time: string;
  /** Unix ms; the fire time. Computed once when enqueueing. */
  fireAt: number;
  platforms: string[];
  caption: string;
  /** Pre-resolved image URL — server has no IDB so the browser must pre-resolve. */
  mediaUrl?: string;
  /** Multi-image carousel post: every member URL, in order. */
  mediaUrls?: string[];
  /** All members of a carousel share this id; cron-fire groups them. */
  carouselGroupId?: string;
  /** Image id (for browser reconciliation back to local state). */
  imageId?: string;
  /** Per-platform credentials captured at enqueue time. cron-fire forwards
   *  these to /api/social/post so the route's existing
   *  `process.env.X ?? credentials?.X` chain finds them when env vars
   *  aren't set on the server. Without this, scheduled IG posts that
   *  worked in the browser silently failed when the cron fired them. */
  credentials?: SocialCredentials;
  /** QSTASH-DELIVERY: id of the queued QStash message that will fire
   *  this post. Persisted alongside the payload so cancel/reschedule
   *  can call cancelDelivery without a second lookup. Absent when
   *  QStash is unconfigured (Redis-only / GH-Actions-cron fallback) or
   *  when publishing to QStash failed (we keep the Redis entry so the
   *  cron safety net still drains it). */
  qstashMessageId?: string;
}

export interface QueueResult {
  id: string;
  status: 'posted' | 'failed';
  /** Unix ms. */
  at: number;
  error?: string;
  /** Carousel group this post belonged to, if any — mirrored so the
   *  browser can mark the whole group with one fetch result. */
  carouselGroupId?: string;
}

const NS = 'mashup:queue';
const KEY_SCHEDULED = `${NS}:scheduled`;
const KEY_POSTS = `${NS}:posts`;
const KEY_RESULTS = `${NS}:results`;

let _client: Redis | null = null;

/** Lazy Upstash client. Throws a readable error if env vars aren't set so
 *  routes fail with 503 instead of an opaque "fetch failed". */
export function getRedis(): Redis {
  if (_client) return _client;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      'Server queue not configured: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set in the server env.',
    );
  }
  _client = new Redis({ url, token });
  return _client;
}

/** Test seam — replace the cached client with a mock. */
export function __setRedisForTests(client: Redis | null): void {
  _client = client;
}

/** Compute the fire timestamp for a YYYY-MM-DD + HH:mm pair in the user's
 *  local timezone (matches the browser auto-poster's `new Date(...)`). */
export function computeFireAt(date: string, time: string): number {
  const t = new Date(`${date}T${time}:00`).getTime();
  if (!Number.isFinite(t)) {
    throw new Error(`Invalid date/time: ${date} ${time}`);
  }
  return t;
}

/** Push a post to the queue. Idempotent — re-enqueueing the same id
 *  updates the score (rescheduling) and overwrites the payload. */
export async function enqueuePost(post: EnqueuedPost): Promise<void> {
  const r = getRedis();
  // Pipeline to keep the two writes adjacent. Not transactional, but
  // worst case the post is in the ZSET without payload (cron will skip
  // and the next enqueue heals it) or vice-versa (orphan payload, never
  // claimed). Both are recoverable; full WATCH/MULTI is overkill here.
  const pipe = r.pipeline();
  pipe.zadd(KEY_SCHEDULED, { score: post.fireAt, member: post.id });
  pipe.hset(KEY_POSTS, { [post.id]: JSON.stringify(post) });
  await pipe.exec();
}

// QUEUE-REPLACE-FIX: explicit remove-then-add for reschedules. enqueuePost
// already overwrites by id (zadd updates the score, hset overwrites the
// payload), but callers that need to know whether they displaced an
// existing entry — e.g. the schedule route's "this was a reschedule"
// telemetry — use this helper instead.
export async function replacePost(post: EnqueuedPost): Promise<{ replaced: boolean }> {
  const r = getRedis();
  // Probe whether an entry exists for this id BEFORE we touch it. zscore
  // is the cheapest existence check on the ZSET (returns null if absent)
  // and avoids an extra round-trip vs hexists.
  const existing = await r.zscore(KEY_SCHEDULED, post.id);
  const replaced = existing !== null && existing !== undefined;

  const pipe = r.pipeline();
  pipe.zrem(KEY_SCHEDULED, post.id);
  pipe.hdel(KEY_POSTS, post.id);
  pipe.zadd(KEY_SCHEDULED, { score: post.fireAt, member: post.id });
  pipe.hset(KEY_POSTS, { [post.id]: JSON.stringify(post) });
  await pipe.exec();
  return { replaced };
}

/** Remove a post from the queue. Used by the browser when the user
 *  cancels or rejects a scheduled post before fire-time. */
export async function cancelPost(id: string): Promise<void> {
  const r = getRedis();
  const pipe = r.pipeline();
  pipe.zrem(KEY_SCHEDULED, id);
  pipe.hdel(KEY_POSTS, id);
  await pipe.exec();
}

/** QSTASH-DELIVERY: read a single post without claiming it. Used by
 *  the cancel route to look up qstashMessageId before deleting, and by
 *  callers that need to inspect state without atomic claim semantics.
 *  Returns null when the post is unknown or its payload has already
 *  been drained. */
export async function getPostById(id: string): Promise<EnqueuedPost | null> {
  const r = getRedis();
  const raw = (await r.hget(KEY_POSTS, id)) as string | EnqueuedPost | null;
  if (raw === null) return null;
  return typeof raw === 'string' ? (JSON.parse(raw) as EnqueuedPost) : raw;
}

/** QSTASH-DELIVERY: attach a QStash message id to an already-enqueued
 *  post. Best-effort: if the post was concurrently cancelled (no entry
 *  in KEY_POSTS) we silently no-op — the QStash callback will land,
 *  find Redis empty via claimPostById, and skip cleanly. */
export async function setQStashMessageId(id: string, messageId: string): Promise<void> {
  const r = getRedis();
  const existing = await getPostById(id);
  if (!existing) return;
  const merged: EnqueuedPost = { ...existing, qstashMessageId: messageId };
  await r.hset(KEY_POSTS, { [id]: JSON.stringify(merged) });
}

/**
 * QSTASH-DELIVERY: atomic single-post claim used by the deliver route.
 * QStash carries the payload too, but we still consult Redis to dedupe
 * against the GH Actions safety-net cron: only the caller that
 * successfully ZREMs takes ownership. Returns the live post if the
 * caller claimed it (and clears the payload hash), or null if it's
 * already been drained — letting the QStash delivery skip silently.
 */
export async function claimPostById(id: string): Promise<EnqueuedPost | null> {
  const r = getRedis();
  const removed = await r.zrem(KEY_SCHEDULED, id);
  if (removed !== 1) return null;
  const raw = (await r.hget(KEY_POSTS, id)) as string | EnqueuedPost | null;
  if (raw === null) return null;
  const post: EnqueuedPost = typeof raw === 'string' ? JSON.parse(raw) : raw;
  await r.hdel(KEY_POSTS, id);
  return post;
}

/**
 * Claim every post whose fireAt ≤ now. Atomic per-post via ZREM: only
 * the caller that actually removed the id from the ZSET takes ownership;
 * concurrent callers (overlapping cron fires) get back 0 and skip.
 *
 * Returns the claimed posts, ready to be fired. Their payload is removed
 * from the posts hash too — re-claim is impossible once we return.
 */
export async function claimDuePosts(now: number): Promise<EnqueuedPost[]> {
  const r = getRedis();
  const dueIds = (await r.zrange(KEY_SCHEDULED, 0, now, { byScore: true })) as string[];
  if (dueIds.length === 0) return [];

  const claimed: EnqueuedPost[] = [];
  for (const id of dueIds) {
    const removed = await r.zrem(KEY_SCHEDULED, id);
    if (removed !== 1) continue; // someone else got it
    const raw = (await r.hget(KEY_POSTS, id)) as string | EnqueuedPost | null;
    if (raw === null) {
      // Schedule entry without payload — drop it silently. Will be
      // re-pushed by the browser on the next sync if still relevant.
      continue;
    }
    // @upstash/redis auto-parses JSON when the value looks like JSON, so
    // `raw` may already be a parsed object. Handle both shapes.
    const post: EnqueuedPost = typeof raw === 'string' ? JSON.parse(raw) : raw;
    await r.hdel(KEY_POSTS, id);
    claimed.push(post);
  }
  return claimed;
}

/** Write a result for a post (after firing). Stored in a separate hash
 *  so the browser can fetch outcomes without scanning the live queue. */
export async function markResult(result: QueueResult): Promise<void> {
  const r = getRedis();
  await r.hset(KEY_RESULTS, { [result.id]: JSON.stringify(result) });
}

/** Read every result currently stored. The browser is expected to call
 *  this periodically and pass each result's id back to `clearResult`
 *  once it has been merged into local state — this keeps the hash from
 *  growing unbounded. */
export async function getResults(): Promise<QueueResult[]> {
  const r = getRedis();
  const map = (await r.hgetall(KEY_RESULTS)) as Record<string, string | QueueResult> | null;
  if (!map) return [];
  return Object.values(map).map((v) => (typeof v === 'string' ? JSON.parse(v) : v));
}

/** Drop a result from the hash. Called by the browser after it has
 *  reconciled the result into local state. */
export async function clearResult(id: string): Promise<void> {
  const r = getRedis();
  await r.hdel(KEY_RESULTS, id);
}

export const __KEYS_FOR_TESTS = {
  SCHEDULED: KEY_SCHEDULED,
  POSTS: KEY_POSTS,
  RESULTS: KEY_RESULTS,
};
