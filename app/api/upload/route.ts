import { NextResponse } from 'next/server';
import { getErrorMessage } from '@/lib/errors';

// POST-413-FIX phase 4 (2026-05-21): proxy uguu uploads through our own
// route so the browser never hits uguu directly. uguu.se sends no
// Access-Control-Allow-Origin header on /upload.php, so the browser's
// CORS check blocked phase 3's client-side upload outright (visible as
// "Failed to fetch" in DevTools). Server-side fetch has no CORS so we
// can re-host on the user's behalf and return just the hosted URL.
//
// Body limit: this route still inherits Vercel's 4.5MB serverless
// function body limit. The frontend handles that by calling /api/upload
// once per image — a single watermarked JPEG@0.92 fits, and carousels
// upload their members serially-or-parallel as individual requests.

const UGUU_UPLOAD_ENDPOINT = 'https://uguu.se/upload.php';
const UPLOAD_TIMEOUT_MS = 30_000;

interface UguuResponse {
  success?: boolean;
  files?: Array<{ url?: string; hash?: string; filename?: string; size?: number; dupe?: boolean }>;
  description?: string;
  errorcode?: number;
  error?: string;
}

export async function POST(req: Request) {
  try {
    // Accept multipart/form-data with a single `file` part. FormData
    // streaming through Next.js avoids us having to base64-decode the
    // body ourselves — uguu wants the raw bytes anyway.
    const incoming = await req.formData();
    const file = incoming.get('file');
    // FormData.get returns FormDataEntryValue (string | File-like). We
    // only accept the Blob/File branch — `typeof file === 'object'` with
    // an `arrayBuffer()` method is the cross-runtime structural check
    // (avoids depending on a global `File` constructor in the route's
    // lib.dom typing).
    if (!file || typeof file === 'string' || typeof (file as Blob).arrayBuffer !== 'function') {
      return NextResponse.json({ error: 'multipart `file` field is required' }, { status: 400 });
    }
    const blob = file as Blob;
    const filename = (file as { name?: string }).name || 'image.jpg';

    // Re-pack the Blob into a fresh FormData payload so uguu sees
    // exactly the field name it expects (`files[]`, with the trailing
    // brackets — the upstream IG branch in /api/social/post mirrors
    // this convention).
    const forwarded = new FormData();
    forwarded.append('files[]', blob, filename);

    const res = await fetch(UGUU_UPLOAD_ENDPOINT, {
      method: 'POST',
      body: forwarded,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
    const text = await res.text();
    let data: UguuResponse;
    try {
      data = JSON.parse(text);
    } catch {
      const snippet = text.slice(0, 200).replace(/\s+/g, ' ').trim();
      console.error('[/api/upload] uguu non-JSON', { status: res.status, snippet });
      return NextResponse.json(
        { error: `uguu returned non-JSON (HTTP ${res.status}): ${snippet || '<empty>'}` },
        { status: 502 },
      );
    }
    if (!res.ok || !data.success) {
      const msg = data.description ?? data.error ?? `HTTP ${res.status}`;
      console.error('[/api/upload] uguu rejected upload', { status: res.status, data });
      return NextResponse.json({ error: `uguu upload failed: ${msg}` }, { status: 502 });
    }
    const url = data.files?.[0]?.url;
    if (!url) {
      console.error('[/api/upload] uguu success but no files[0].url', { data });
      return NextResponse.json({ error: 'uguu returned success but no files[0].url' }, { status: 502 });
    }
    return NextResponse.json({ url });
  } catch (e: unknown) {
    console.error('[/api/upload] handler error', e);
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
  }
}
