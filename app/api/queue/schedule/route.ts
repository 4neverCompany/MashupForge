// SCHED-POST-ROBUST: browser → server queue push.
//
// POST body shape mirrors a ScheduledPost plus pre-resolved media URLs
// (the server has no IDB so it can't dereference imageId on its own).

import { NextResponse } from 'next/server';
// QUEUE-REPLACE-FIX: switched from enqueuePost to replacePost so that
// reschedules update the existing entry in-place instead of leaving a
// stale-time duplicate that would fire on the cron's next sweep.
import { computeFireAt, replacePost, type EnqueuedPost } from '@/lib/server-queue';
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

  let replaced = false;
  try {
    // QUEUE-REPLACE-FIX: replaced=true when this id already had an entry,
    // i.e. the request was a reschedule rather than a fresh enqueue.
    ({ replaced } = await replacePost(post));
  } catch (e) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 503 });
  }
  return NextResponse.json({ ok: true, id, fireAt, replaced });
}
