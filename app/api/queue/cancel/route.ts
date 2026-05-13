// SCHED-POST-ROBUST: browser → server queue cancel.
// Removes a post from the server queue (called when user
// rejects/edits a scheduled post in the browser).

import { NextResponse } from 'next/server';
import { cancelPost } from '@/lib/server-queue';
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
  try {
    await cancelPost(id);
  } catch (e) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 503 });
  }
  return NextResponse.json({ ok: true, id });
}
