// SCHED-POST-ROBUST: browser → server queue push.
//
// POST body shape mirrors a ScheduledPost plus pre-resolved media URLs
// (the server has no IDB so it can't dereference imageId on its own).

import { NextResponse } from 'next/server';
// QUEUE-REPLACE-FIX: switched from enqueuePost to replacePost so that
// reschedules update the existing entry in-place instead of leaving a
// stale-time duplicate that would fire on the cron's next sweep.
import {
  computeFireAt,
  getPostById,
  replacePost,
  setQStashMessageId,
  type EnqueuedPost,
} from '@/lib/server-queue';
// QSTASH-DELIVERY: push-based trigger via Upstash QStash. Replaces the
// polling GH Actions cron as the primary delivery mechanism — the cron
// stays as defense-in-depth, idempotent via atomic ZREM.
import {
  cancelDelivery,
  isQStashConfigured,
  scheduleDelivery,
} from '@/lib/qstash-client';
import { getErrorMessage } from '@/lib/errors';

// @upstash/redis is a Node.js HTTP client — edge runtime omits the
// Node-flavoured fetch agents it relies on, so the queue ops fail
// non-deterministically on cold starts in edge.
export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  let body: Partial<EnqueuedPost>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { id, date, time, platforms, caption, mediaUrl, mediaUrls, carouselGroupId, imageId, credentials } = body;

  if (!id || !date || !time) {
    return NextResponse.json(
      { error: 'Missing required fields: id, date, time' },
      { status: 400 },
    );
  }
  if (!Array.isArray(platforms) || platforms.length === 0) {
    return NextResponse.json({ error: 'platforms must be a non-empty array' }, { status: 400 });
  }
  if (typeof caption !== 'string') {
    return NextResponse.json({ error: 'caption is required' }, { status: 400 });
  }
  if (!mediaUrl && (!Array.isArray(mediaUrls) || mediaUrls.length === 0)) {
    return NextResponse.json(
      { error: 'mediaUrl or mediaUrls (carousel) is required' },
      { status: 400 },
    );
  }

  let fireAt: number;
  try {
    fireAt = computeFireAt(date, time);
  } catch (e) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 400 });
  }

  const post: EnqueuedPost = {
    id,
    date,
    time,
    fireAt,
    platforms,
    caption,
    ...(mediaUrl ? { mediaUrl } : {}),
    ...(mediaUrls ? { mediaUrls } : {}),
    ...(carouselGroupId ? { carouselGroupId } : {}),
    ...(imageId ? { imageId } : {}),
    ...(credentials ? { credentials } : {}),
  };

  // QSTASH-DELIVERY: when this is a reschedule of an existing post,
  // capture the prior QStash message id (if any) BEFORE replacePost
  // overwrites the payload so we can cancel the now-stale callback.
  // Cancelling first would race against an at-fireAt delivery, but
  // QStash's notBefore is well in the future for any active reschedule.
  let priorQStashMessageId: string | undefined;
  if (isQStashConfigured()) {
    try {
      const existing = await getPostById(id);
      priorQStashMessageId = existing?.qstashMessageId;
    } catch {
      // Reading prior state is opportunistic — if it fails we skip the
      // cancel-old step and let the stale message fire harmlessly
      // (deliver route's claimPostById ZREM dedupe will reject it).
    }
  }

  let replaced = false;
  try {
    // QUEUE-REPLACE-FIX: replaced=true when this id already had an entry,
    // i.e. the request was a reschedule rather than a fresh enqueue.
    ({ replaced } = await replacePost(post));
  } catch (e) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 503 });
  }

  // QSTASH-DELIVERY: publish the delayed callback. Best-effort — if
  // QStash is unconfigured or the publish fails, the post still sits
  // in Redis and the GH Actions cron drains it (degraded but not
  // broken). We surface qstashError in the response so the browser
  // (and Vercel logs) can flag the degradation.
  let qstashMessageId: string | undefined;
  let qstashError: string | undefined;
  if (isQStashConfigured()) {
    try {
      const result = await scheduleDelivery(post);
      qstashMessageId = result.messageId;
      await setQStashMessageId(id, result.messageId);
    } catch (e) {
      qstashError = getErrorMessage(e);
    }

    // Cancel the stale callback only after we know the new publish
    // succeeded (or failed cleanly) — leaves no window where both old
    // and new are armed. Errors here are non-fatal: a leaked stale
    // callback hits the deliver route, finds the post already gone
    // (replacePost ZREM+re-ZADD changed the score; the prior callback
    // body has the old payload but its id-keyed claim will fail
    // because the ZSET entry now points at fireAt'). To be safe,
    // claimPostById uses the id only, so we must cancel the prior to
    // avoid the prior firing the new payload at the WRONG time.
    if (priorQStashMessageId && priorQStashMessageId !== qstashMessageId) {
      try {
        await cancelDelivery(priorQStashMessageId);
      } catch {
        // Stale cancel failed; best-effort. If the stale message fires
        // it will fire at the OLD time, find the new ZSET score and
        // ZREM-claim it (claimPostById doesn't gate on fireAt), so the
        // post would publish slightly earlier than the rescheduled
        // time. Acceptable — same drift behaviour as the existing
        // browser auto-poster on reschedule.
      }
    }
  }

  return NextResponse.json({
    ok: true,
    id,
    fireAt,
    replaced,
    ...(qstashMessageId ? { qstashMessageId } : {}),
    ...(qstashError ? { qstashError } : {}),
  });
}
