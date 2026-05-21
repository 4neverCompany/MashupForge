// POST-413-FIX phase 3 (2026-05-21): client-side image hosting so the
// request body to /api/social/post stays a few hundred bytes regardless
// of how many images a carousel carries. Vercel's serverless function
// body limit is 4.5MB; even JPEG@0.92 watermarked GPT Image-2 / MiniMax
// 2048-3840px outputs each push 3-5MB, so a 2+ image carousel reliably
// crosses the limit when shipped inline. Uploading to a public host
// first turns each image into a ~50 byte URL.
//
// uguu.se is the same host the /api/social/post IG branch already uses
// internally — picking it client-side keeps the trust surface and
// failure-mode catalog the same. n.uguu.se URLs are CDN-backed and stay
// live for ~30 days (long enough for the route's downstream IG/Twitter/
// Pinterest/Discord posts to fetch).

/**
 * Public-host upload result. `hostedUrl` is what gets shipped to the
 * route in place of the data URL / base64.
 */
export interface HostedImage {
  hostedUrl: string;
}

const UGUU_UPLOAD_ENDPOINT = 'https://uguu.se/upload.php';
const UPLOAD_TIMEOUT_MS = 30_000;

/**
 * Strip a `data:image/<mime>;base64,` prefix and return `{ base64, mimeType }`.
 * Returns null if the string is not a data URL.
 */
function parseDataUrl(s: string): { base64: string; mimeType: string } | null {
  if (!s.startsWith('data:')) return null;
  const comma = s.indexOf(',');
  if (comma < 0) return null;
  const header = s.slice(5, comma);
  const base64 = s.slice(comma + 1);
  const mimeType = header.split(';')[0] || 'image/jpeg';
  return { base64, mimeType };
}

/**
 * Convert a base64 string into a Blob suitable for FormData upload.
 * Avoids `atob` on huge strings by chunking — atob on a multi-MB
 * base64 in some browsers stalls the UI thread for hundreds of ms.
 */
function base64ToBlob(base64: string, mimeType: string): Blob {
  const CHUNK = 1024;
  const bin = atob(base64);
  const len = bin.length;
  const buf = new Uint8Array(len);
  for (let i = 0; i < len; i += CHUNK) {
    const end = Math.min(i + CHUNK, len);
    for (let j = i; j < end; j++) buf[j] = bin.charCodeAt(j);
  }
  return new Blob([buf], { type: mimeType });
}

/**
 * POST one image (as Blob) to uguu and return the hosted URL. Throws
 * on network/parse/contract failures so the caller can fall back to
 * shipping the raw data URL (and hitting the 413, but at least with
 * a descriptive error from the route's diagnostic patch).
 */
async function uploadBlobToUguu(blob: Blob, filename: string): Promise<string> {
  const formData = new FormData();
  formData.append('files[]', blob, filename);
  const res = await fetch(UGUU_UPLOAD_ENDPOINT, {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  const text = await res.text();
  let data: { success?: boolean; files?: Array<{ url?: string }>; description?: string; error?: string };
  try {
    data = JSON.parse(text);
  } catch {
    const snippet = text.slice(0, 200).replace(/\s+/g, ' ').trim();
    throw new Error(`uguu returned non-JSON (HTTP ${res.status}): ${snippet || '<empty>'}`);
  }
  if (!res.ok || !data.success) {
    throw new Error(`uguu upload failed (HTTP ${res.status}): ${data.description ?? data.error ?? 'no message'}`);
  }
  const url = data.files?.[0]?.url;
  if (!url) throw new Error('uguu returned success but no files[0].url');
  return url;
}

/**
 * Ensure a single image source is a public https URL.
 *
 * - Already-https URLs pass through unchanged.
 * - data: URLs get uploaded to uguu and replaced with the hosted URL.
 * - Other inputs throw — the caller should pre-validate.
 */
export async function ensureHostedUrl(source: string): Promise<string> {
  if (source.startsWith('http://') || source.startsWith('https://')) return source;
  const parsed = parseDataUrl(source);
  if (!parsed) throw new Error(`ensureHostedUrl: unsupported source (not http/https/data:): ${source.slice(0, 40)}...`);
  // Pick a sensible extension for uguu's filename — doesn't affect
  // content, just helps the host route the file correctly on its end.
  const ext = parsed.mimeType.endsWith('png') ? 'png' : 'jpg';
  const blob = base64ToBlob(parsed.base64, parsed.mimeType);
  return uploadBlobToUguu(blob, `image.${ext}`);
}

/**
 * Ensure every image source in the array is a public https URL.
 * Uploads happen in parallel (carousels are typically 2-10 images;
 * uguu handles concurrent uploads fine). One failed upload rejects
 * the whole array so the caller can surface "host failed" once,
 * not per-image.
 */
export async function ensureHostedUrls(sources: string[]): Promise<string[]> {
  return Promise.all(sources.map((s) => ensureHostedUrl(s)));
}

/**
 * Upload a raw base64 string (no data: prefix) to uguu and return the
 * hosted URL. Convenience wrapper for the manual-single autopost paths
 * that store `img.base64` separately from `img.url`.
 */
export async function uploadBase64ToHost(base64: string, mimeType = 'image/jpeg'): Promise<string> {
  const ext = mimeType.endsWith('png') ? 'png' : 'jpg';
  const blob = base64ToBlob(base64, mimeType);
  return uploadBlobToUguu(blob, `image.${ext}`);
}
