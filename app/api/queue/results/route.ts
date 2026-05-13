// SCHED-POST-ROBUST: server → browser results pull + cleanup.
//
// GET  → return all stored results (cron-fired posts that the browser
//        hasn't reconciled yet).
// POST { ids: string[] } → drop those ids from the results hash. Called
//        by the browser after merging the results into local state, so
//        the hash doesn't grow unbounded.

import { NextResponse } from 'next/server';
import { clearResult, getResults } from '@/lib/server-queue';
import { getErrorMessage } from '@/lib/errors';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  try {
    const results = await getResults();
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 503 });
  }
}

export async function POST(req: Request): Promise<Response> {
  let body: { ids?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const ids = body.ids;
  if (!Array.isArray(ids)) {
    return NextResponse.json({ error: 'ids must be an array' }, { status: 400 });
  }
  try {
    await Promise.all(ids.map((id) => clearResult(id)));
  } catch (e) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 503 });
  }
  return NextResponse.json({ ok: true, cleared: ids.length });
}
