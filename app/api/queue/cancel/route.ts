// SCHED-POST-ROBUST: browser → server queue cancel.
// Removes a post from the server queue (called when user
// rejects/edits a scheduled post in the browser).

import { NextResponse } from 'next/server';
import { cancelPost, getPostById } from '@/lib/server-queue';
// QSTASH-DELIVERY: also cancel the queued QStash callback so a
// rejected post can't fire later. 404-tolerant inside cancelDelivery.
import { cancelDelivery, isQStashConfigured } from '@/lib/qstash-client';
import { getErrorMessage } from '@/lib/errors';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const id = body.id;
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  // QSTASH-DELIVERY: read the QStash message id BEFORE we drop the
  // payload — cancelPost removes it from the hash and we'd lose the
  // pointer otherwise.
  let qstashMessageId: string | undefined;
  if (isQStashConfigured()) {
    try {
      const existing = await getPostById(id);
      qstashMessageId = existing?.qstashMessageId;
    } catch {
      // Lookup failure is non-fatal — proceed with the Redis cancel.
      // A leaked QStash callback hits deliver, finds Redis empty (ZREM
      // returns 0), and skips cleanly.
    }
  }

  try {
    await cancelPost(id);
  } catch (e) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 503 });
  }

  let qstashCancelError: string | undefined;
  if (qstashMessageId) {
    try {
      await cancelDelivery(qstashMessageId);
    } catch (e) {
      // Surface but don't fail the request — Redis is already cleared
      // so the safety-net cron won't fire it; worst case is a wasted
      // QStash invocation hitting deliver, which no-ops via ZREM dedupe.
      qstashCancelError = getErrorMessage(e);
    }
  }

  return NextResponse.json({
    ok: true,
    id,
    ...(qstashCancelError ? { qstashCancelError } : {}),
  });
}
