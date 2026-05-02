'use client';

import { useEffect, useState } from 'react';

/**
 * Returns whether the nca CLI is callable on the server.
 *
 * - `null` while the GET is in flight (callers should treat as "unknown,
 *   render nothing yet" so disabled buttons don't flash on every load).
 * - `true` / `false` once /api/nca/status has answered.
 *
 * Cached in module scope so siblings (Sidebar + Studio + Settings) don't
 * refetch. Per-tab; a hard reload re-probes.
 *
 * Replaces useMmxAvailability for the chat path. The mmx hook is kept in
 * place for now because the multimodal mmx routes (image/music/video/
 * speech/describe) still depend on the mmx availability probe — see the
 * NCA-INTEGRATION-DEV deviation note in commit b187acf.
 */
let cachedAvailable: boolean | null = null;
let inflight: Promise<boolean> | null = null;

async function probe(): Promise<boolean> {
  if (cachedAvailable !== null) return cachedAvailable;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch('/api/nca/status', { cache: 'no-store' });
      if (!res.ok) {
        cachedAvailable = false;
        return false;
      }
      const data = (await res.json()) as { available?: boolean };
      cachedAvailable = !!data.available;
      return cachedAvailable;
    } catch {
      cachedAvailable = false;
      return false;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function useNcaAvailability(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(cachedAvailable);

  useEffect(() => {
    let cancelled = false;
    probe().then((v) => {
      if (!cancelled) setAvailable(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return available;
}
