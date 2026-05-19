// QSTASH-DELIVERY — push-trigger endpoint hit by Upstash QStash at the
// post's fireAt time. Replaces the polling drain that GH Actions cron
// was supposed to run every 5 minutes but actually fires only ~5x/day
// on the free tier (see the diagnostic that triggered this change).
//
// Flow on a valid delivery:
//   1. Read raw body + upstash-signature header
//   2. Verify with QStash receiver (rotates current → next signing key)
//   3. Parse body as EnqueuedPost
//   4. Atomically claim by id from Redis (ZREM=1 only to the winner;
//      the GH Actions cron safety-net using claimDuePosts loses the
//      race when QStash arrives first, and vice-versa — no double-fire)
//   5. Group as carousel/single, fire via /api/social/post (same code
//      path as cron-fire so platform-specific behaviour is unchanged)
//   6. markResult so the browser's reconcile loop sees the outcome
//
// Auth model: ONLY the QStash signature gates this route. We deliberately
// do not also accept Bearer CRON_SHARED_SECRET here — that secret is for
// the GH Actions cron safety net, which still hits /api/social/cron-fire.
// Conflating the two would let either credential trigger either path and
// blur the audit trail.
//
// Idempotency: the QStash claim depends on Redis ZREM returning 1. If
// the post was already drained (by the cron safety net or by an earlier
// QStash retry), the deliver returns 200 with `skipped: true`. QStash
// considers any 200 a success, so it won't retry endlessly.
//
// Why use body payload instead of re-reading Redis: QStash already has
// the post bytes from publish time, so the deliver can fire even if
// Redis is briefly unavailable — but we still ZREM-claim to guarantee
// no double-fire with the cron. The body shape matches what cron-fire's
// fireOne consumes, so the executor is identical.

import { NextResponse } from 'next/server';
import {
  claimPostById,
  markResult,
  type EnqueuedPost,
  type QueueResult,
} from '@/lib/server-queue';
import { verifyDelivery } from '@/lib/qstash-client';
import { getErrorMessage } from '@/lib/errors';

// @upstash/qstash Receiver uses jose (Node WebCrypto) + @upstash/redis
// (Node fetch) — both require the Node runtime.
export const runtime = 'nodejs';

interface DeliverSummary {
  delivered: number;
  failed: number;
  skipped?: boolean;
  reason?: string;
  postId?: string;
  carouselGroupId?: string;
}

/**
 * Fire one group (single or carousel) via /api/social/post. Identical
 * shape to cron-fire/fireOne — kept in sync so platform behaviour
 * matches. QStash bundles each post as its own message, so a carousel
 * of N images results in N QStash deliveries; the carouselGroupId
 * dedupe happens via the Redis ZREM check (only the first delivery in
 * the group claims it).
 *
 * NOTE: today QStash delivers one post per message. For a true
 * grouped-carousel publish, the schedule path would need to dedupe at
 * publish-time (group → 1 message). For now we accept that each
 * carousel image fires as its own publish — same behaviour as if the
 * browser auto-poster had been open. The /api/social/post executor
 * already handles single-image-of-carousel correctly via mediaUrls.
 */
async function fireOne(
  post: EnqueuedPost,
  baseUrl: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const isCarousel = (post.mediaUrls?.length ?? 0) > 0;
  const credentials = post.credentials ?? {};
  const body = isCarousel
    ? {
        caption: post.caption,
        platforms: post.platforms,
        mediaUrls: post.mediaUrls,
        credentials,
      }
    : {
        caption: post.caption,
        platforms: post.platforms,
        mediaUrl: post.mediaUrl,
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

export async function POST(req: Request): Promise<Response> {
  // Verification needs the raw byte stream, not the parsed JSON. We
  // read once and re-parse downstream so the SHA-256 inside the
  // receiver sees the exact bytes QStash signed.
  const rawBody = await req.text();
  const signature = req.headers.get('upstash-signature') ?? '';

  if (!signature) {
    return NextResponse.json(
      { error: 'Missing upstash-signature header' },
      { status: 401 },
    );
  }

  try {
    const ok = await verifyDelivery({
      signature,
      rawBody,
      // We pass the request URL so the receiver checks it matches the
      // signed url claim — prevents an attacker forwarding a valid
      // signed payload to a different endpoint on the same domain.
      url: req.url,
    });
    if (!ok) {
      return NextResponse.json({ error: 'Invalid QStash signature' }, { status: 401 });
    }
  } catch (e) {
    // SignatureError from @upstash/qstash lands here. Message already
    // describes the failure mode (expired, bad sig, mismatched url).
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 401 });
  }

  let post: EnqueuedPost;
  try {
    post = JSON.parse(rawBody) as EnqueuedPost;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!post.id || typeof post.id !== 'string') {
    return NextResponse.json({ error: 'Body missing required field: id' }, { status: 400 });
  }

  // Atomic claim. If Redis already drained this post (cron safety net
  // beat us, or a QStash retry on the same id) we return 200 so QStash
  // marks the message as delivered and stops retrying. The cron path
  // wrote the result, so the browser will still see the outcome.
  let claimed: EnqueuedPost | null;
  try {
    claimed = await claimPostById(post.id);
  } catch (e) {
    // Redis is down. Returning 5xx lets QStash retry per its backoff,
    // which is exactly the right behaviour — once Redis recovers the
    // claim succeeds and the post fires.
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 503 });
  }

  if (!claimed) {
    // Another worker (cron-fire safety net or prior QStash retry) already
    // handled this post. 200 stops QStash retries; skipped flag surfaces
    // in QStash logs so an operator can investigate if it happens often
    // (indicates the cron is firing ahead of QStash → safe but wasteful).
    const skipResp: DeliverSummary = {
      delivered: 0,
      failed: 0,
      skipped: true,
      reason: 'Already claimed (cron safety net or prior QStash retry won the race)',
      postId: post.id,
      ...(post.carouselGroupId ? { carouselGroupId: post.carouselGroupId } : {}),
    };
    return NextResponse.json(skipResp);
  }

  // Use the Redis snapshot for firing — it has the freshest credentials
  // (if a reschedule updated them) and matches what the cron path would
  // have fired. The QStash body and the Redis payload SHOULD be identical
  // here, but the Redis copy wins on principle: one source of truth.
  const baseUrl =
    process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') ||
    new URL(req.url).origin;

  const outcome = await fireOne(claimed, baseUrl);
  const at = Date.now();
  const result: QueueResult = outcome.ok
    ? {
        id: claimed.id,
        status: 'posted',
        at,
        ...(claimed.carouselGroupId ? { carouselGroupId: claimed.carouselGroupId } : {}),
      }
    : {
        id: claimed.id,
        status: 'failed',
        at,
        error: outcome.error,
        ...(claimed.carouselGroupId ? { carouselGroupId: claimed.carouselGroupId } : {}),
      };

  try {
    await markResult(result);
  } catch {
    // Result hash write failed — the publish still happened (or failed)
    // on the social side. Surfacing in the response is the best we can
    // do; QStash logs will show whichever status code we return next.
  }

  const summary: DeliverSummary = {
    delivered: outcome.ok ? 1 : 0,
    failed: outcome.ok ? 0 : 1,
    postId: claimed.id,
    ...(claimed.carouselGroupId ? { carouselGroupId: claimed.carouselGroupId } : {}),
    ...(outcome.ok ? {} : { reason: outcome.error }),
  };

  // Always 200 on a verified delivery, even when the social publish
  // failed: we've already retried inside /api/social/post (e.g. the IG
  // container poll), and QStash's outer retry would re-fire the WHOLE
  // post — risking a duplicate publish if the platform side actually
  // succeeded but our timeout missed it. The failure is recorded in
  // markResult and bubbles to the browser via the results buffer.
  return NextResponse.json(summary);
}
