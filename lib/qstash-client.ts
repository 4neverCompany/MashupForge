// QSTASH-DELIVERY — push-based scheduled-post trigger.
//
// Replaces the polling drain (GitHub Actions cron every 5 minutes hitting
// /api/social/cron-fire) with an Upstash QStash push: when the browser
// schedules a post, the schedule route publishes a delayed HTTP callback
// to /api/social/qstash-deliver at the post's fireAt. QStash delivers
// the signed callback even when no browser is open and without our
// having to keep a cron warm. Free tier (500 msgs/day) comfortably
// covers Maurice's 3-5 posts/day, allowing for retries.
//
// QStash != Upstash Redis. They share the Upstash brand but are
// separate services with their own console + env vars. The existing
// Redis queue stays as the source of truth for "what is still pending"
// — QStash is the trigger, Redis is the mutex (atomic ZREM on claim
// prevents double-firing when the GH Actions cron safety-net also
// drains a post QStash already delivered).

import { Client, Receiver } from '@upstash/qstash';
import type { EnqueuedPost } from './server-queue';

let _publisher: Client | null = null;
let _receiver: Receiver | null = null;

/** True when QStash publishing creds are present. Lets the schedule
 *  route degrade gracefully: if QStash is unconfigured the post still
 *  lands in Redis and the GH Actions cron drains it (best-effort
 *  backward compatibility for self-hosted / unconfigured deploys). */
export function isQStashConfigured(): boolean {
  return Boolean(process.env.QSTASH_TOKEN);
}

export function getQStashClient(): Client {
  if (_publisher) return _publisher;
  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    throw new Error(
      'QStash not configured: QSTASH_TOKEN must be set in the server env. Get one at https://console.upstash.com/qstash.',
    );
  }
  _publisher = new Client({ token });
  return _publisher;
}

export function getQStashReceiver(): Receiver {
  if (_receiver) return _receiver;
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!currentSigningKey || !nextSigningKey) {
    throw new Error(
      'QStash receiver not configured: QSTASH_CURRENT_SIGNING_KEY and QSTASH_NEXT_SIGNING_KEY must be set in the server env.',
    );
  }
  _receiver = new Receiver({ currentSigningKey, nextSigningKey });
  return _receiver;
}

/** Test seam — mirrors __setRedisForTests in server-queue.ts. */
export function __setQStashForTests(publisher: Client | null, receiver: Receiver | null): void {
  _publisher = publisher;
  _receiver = receiver;
}

/** Resolve the absolute public URL QStash should hit. QStash needs a
 *  publicly reachable HTTPS endpoint — localhost is rejected outside
 *  the dev-server. Priority: explicit QSTASH_DELIVERY_URL > APP_URL >
 *  Vercel-injected VERCEL_URL. Returns the full /api/social/qstash-deliver
 *  URL ready to pass to publishJSON. */
export function resolveDeliveryUrl(): string {
  const explicit = process.env.QSTASH_DELIVERY_URL;
  if (explicit) return ensureDeliverPath(explicit);
  const app = process.env.APP_URL;
  if (app) return ensureDeliverPath(app);
  const vercel = process.env.VERCEL_URL;
  if (vercel) return ensureDeliverPath(`https://${vercel}`);
  throw new Error(
    'Cannot resolve QStash delivery URL: set QSTASH_DELIVERY_URL, APP_URL, or rely on VERCEL_URL.',
  );
}

function ensureDeliverPath(base: string): string {
  const trimmed = base.replace(/\/+$/, '');
  return trimmed.endsWith('/api/social/qstash-deliver')
    ? trimmed
    : `${trimmed}/api/social/qstash-deliver`;
}

export interface ScheduleDeliveryResult {
  messageId: string;
  deduplicated?: boolean;
}

/** Publish a delayed HTTP callback to the deliver endpoint. The body
 *  is the full EnqueuedPost so the deliver route has everything it
 *  needs (credentials snapshot included) without re-reading Redis.
 *  Redis is still consulted to dedupe against the GH Actions safety
 *  net via atomic ZREM; QStash carries the payload. */
export async function scheduleDelivery(post: EnqueuedPost): Promise<ScheduleDeliveryResult> {
  const client = getQStashClient();
  const url = resolveDeliveryUrl();
  // QStash takes notBefore as Unix SECONDS, not ms. Floor so an
  // off-by-a-millisecond fireAt doesn't slip to the next second.
  const notBefore = Math.floor(post.fireAt / 1000);
  const result = await client.publishJSON({
    url,
    body: post,
    notBefore,
    // 3 retries is QStash's default; explicit keeps it visible at the
    // call site so future tweaks are obvious.
    retries: 3,
    headers: { 'Content-Type': 'application/json' },
  });
  return { messageId: result.messageId, deduplicated: result.deduplicated };
}

/** Cancel a queued QStash message. 404-tolerant: a message that has
 *  already been delivered (or never existed) is not an error from the
 *  caller's perspective — the schedule was either never created or has
 *  already fired. Both cases mean "no pending delivery to cancel". */
export async function cancelDelivery(messageId: string): Promise<{ cancelled: number }> {
  const client = getQStashClient();
  try {
    return await client.messages.cancel(messageId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/not found|404/i.test(msg)) return { cancelled: 0 };
    throw e;
  }
}

export interface VerifyDeliveryArgs {
  /** Value of the `upstash-signature` header on the incoming request. */
  signature: string;
  /** The raw (unparsed) request body — verification hashes bytes, so
   *  passing the parsed JSON object would silently fail. */
  rawBody: string;
  /** Optional. When set, verify checks the signed URL matches. Useful
   *  in prod to reject replays aimed at the wrong route; skip in tests
   *  where the URL is synthetic. */
  url?: string;
}

/** Verify a QStash delivery signature. Returns true on success;
 *  throws SignatureError (from @upstash/qstash) on bad signature so
 *  the route can return 401 with a clear reason. */
export async function verifyDelivery(args: VerifyDeliveryArgs): Promise<boolean> {
  const receiver = getQStashReceiver();
  return receiver.verify({
    signature: args.signature,
    body: args.rawBody,
    ...(args.url ? { url: args.url } : {}),
  });
}
