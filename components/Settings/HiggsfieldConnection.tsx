'use client';

/**
 * HIGGSFIELD-INTEGRATION: Higgsfield connection panel for the
 * Settings → AI Engine tab. Renders:
 *   - Connection state (Connected as <email> / Not connected)
 *   - "Connect Higgsfield" or "Disconnect" button
 *   - Default image model picker (Nano Banana Pro / FLUX.2 / etc.)
 *   - Default video model picker (Seedance 2.0 / Veo 3.1 / etc.)
 *   - "Use alongside Leonardo" hint (peer, not replacement)
 *
 * Tokens are stored in IDB (encrypted, see lib/higgsfield/token-store).
 * The OAuth client_id is in config.json (auto-registered on first
 * connect). Users who want to use the CLI can find the
 * "Open terminal" hint at the bottom.
 *
 * The picker is a small client component — the data it writes
 * (defaultHiggsfieldImageModel / defaultHiggsfieldVideoModel) is
 * expected to live on `settings` (UserSettings) and be persisted
 * by the parent SettingsModal.
 */

import { useEffect, useState, useCallback } from 'react';
import { Loader2, ExternalLink, Check, X } from 'lucide-react';
import {
  HIGGSFIELD_IMAGE_MODELS,
  HIGGSFIELD_VIDEO_MODELS,
  HIGGSFIELD_DEFAULT_IMAGE_MODEL,
  HIGGSFIELD_DEFAULT_VIDEO_MODEL,
  getHiggsfieldImageModel,
  type HiggsfieldImageModelSlug,
  type HiggsfieldVideoModelSlug,
} from '@/lib/higgsfield/models';

interface HiggsfieldStatus {
  connected: boolean;
  email?: string;
  name?: string;
  orgId?: string;
  expiresAt?: number;
  needsRefresh?: boolean;
}

interface HiggsfieldConnectionProps {
  selectedImageModel: HiggsfieldImageModelSlug;
  selectedVideoModel: HiggsfieldVideoModelSlug;
  onSelectImageModel: (slug: HiggsfieldImageModelSlug) => void;
  onSelectVideoModel: (slug: HiggsfieldVideoModelSlug) => void;
  saving?: boolean;
  /**
   * Triggered when the connection state changes so the parent can
   * refresh `useImageGeneration`/pipeline provider availability.
   */
  onConnectionChange?: (connected: boolean) => void;
}

export function HiggsfieldConnection({
  selectedImageModel,
  selectedVideoModel,
  onSelectImageModel,
  onSelectVideoModel,
  saving,
  onConnectionChange,
}: HiggsfieldConnectionProps) {
  const [status, setStatus] = useState<HiggsfieldStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/higgsfield/oauth/status', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as HiggsfieldStatus;
      setStatus(json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load Higgsfield status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-pick defaults if the user's current selection is empty or
  // not a known Higgsfield slug. We DON'T write automatically — the
  // user has to pick something. This effect only validates.
  const safeImageSlug = getHiggsfieldImageModel(selectedImageModel)
    ? selectedImageModel
    : HIGGSFIELD_DEFAULT_IMAGE_MODEL;
  const safeVideoSlug = (HIGGSFIELD_VIDEO_MODELS.find((m) => m.slug === selectedVideoModel)?.slug) ||
    HIGGSFIELD_DEFAULT_VIDEO_MODEL;

  const handleConnect = () => {
    // Bounce to /api/higgsfield/oauth/authorize. The route redirects
    // to the Higgsfield authorize page; the callback comes back to
    // /api/higgsfield/oauth/callback which redirects to /studio with
    // ?higgsfield=connected in the URL.
    window.location.href = '/api/higgsfield/oauth/authorize';
  };

  const handleDisconnect = async () => {
    if (!confirm('Disconnect Higgsfield? Generation will fall back to Leonardo.')) return;
    setWorking(true);
    try {
      const res = await fetch('/api/higgsfield/oauth/disconnect', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refresh();
      onConnectionChange?.(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Disconnect failed');
    } finally {
      setWorking(false);
    }
  };

  // Surface a success banner when the URL has ?higgsfield=connected
  // (set by the callback route). Strip it after first read.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const flag = url.searchParams.get('higgsfield');
    if (flag === 'connected') {
      onConnectionChange?.(true);
      refresh();
      url.searchParams.delete('higgsfield');
      window.history.replaceState({}, '', url.toString());
    } else if (flag === 'error') {
      const reason = url.searchParams.get('reason') || 'unknown';
      const detail = url.searchParams.get('detail') || '';
      setError(`Higgsfield connect failed (${reason})${detail ? `: ${detail.slice(0, 120)}` : ''}`);
      url.searchParams.delete('higgsfield');
      url.searchParams.delete('reason');
      url.searchParams.delete('detail');
      window.history.replaceState({}, '', url.toString());
    }
  }, [refresh, onConnectionChange]);

  return (
    <div className="space-y-4">
      {/* Connection card */}
      <div className="rounded-lg border border-white/10 bg-white/5 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-white">Higgsfield MCP</h4>
            {loading ? (
              <div className="mt-1 flex items-center gap-2 text-xs text-white/60">
                <Loader2 className="h-3 w-3 animate-spin" />
                Checking connection…
              </div>
            ) : status?.connected ? (
              <div className="mt-1 space-y-0.5 text-xs">
                <div className="flex items-center gap-1.5 text-emerald-300">
                  <Check className="h-3 w-3" />
                  Connected as <span className="font-medium">{status.email || status.name || 'Higgsfield user'}</span>
                </div>
                {status.orgId && (
                  <div className="text-white/40">Workspace: {status.orgId}</div>
                )}
                {status.needsRefresh && (
                  <div className="text-amber-300">Token expiring soon — will refresh on next call.</div>
                )}
              </div>
            ) : (
              <div className="mt-1 flex items-center gap-1.5 text-xs text-white/60">
                <X className="h-3 w-3" />
                Not connected. Each user must link their own Higgsfield account.
              </div>
            )}
            {error && <div className="mt-2 text-xs text-rose-300">{error}</div>}
          </div>
          <div className="flex flex-col items-end gap-2">
            {status?.connected ? (
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={working}
                className="rounded border border-rose-400/40 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-200 transition hover:bg-rose-500/20 disabled:opacity-50"
              >
                {working ? 'Disconnecting…' : 'Disconnect'}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleConnect}
                disabled={loading}
                className="rounded border border-emerald-400/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-200 transition hover:bg-emerald-500/20 disabled:opacity-50"
              >
                {loading ? 'Loading…' : 'Connect Higgsfield'}
              </button>
            )}
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-white/40">
          Higgsfield runs 30+ image and video models (Nano Banana Pro, FLUX.2, Seedance 2.0, Veo 3.1,
          Kling 3.0, etc.) on a credit-based subscription. Connecting is OAuth — your credits, your
          account. We add Higgsfield <em>alongside</em> Leonardo, not as a replacement: pick per
          idea which provider to use.
        </p>
      </div>

      {/* Default model pickers — only meaningful when connected */}
      {status?.connected && (
        <>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-white/70">
              Default image model
            </label>
            <select
              value={safeImageSlug}
              disabled={saving}
              onChange={(e) => onSelectImageModel(e.target.value as HiggsfieldImageModelSlug)}
              className="w-full rounded border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-white focus:border-emerald-400/60 focus:outline-none"
            >
              {HIGGSFIELD_IMAGE_MODELS.map((m) => (
                <option key={m.slug} value={m.slug}>
                  {m.displayName}{m.badge === 'flagship' ? ' ★' : m.badge === 'fast' ? ' ⚡' : m.badge === 'character' ? ' 👤' : ''}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-white/40">
              {HIGGSFIELD_IMAGE_MODELS.find((m) => m.slug === safeImageSlug)?.blurb}
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-white/70">
              Default video model
            </label>
            <select
              value={safeVideoSlug}
              disabled={saving}
              onChange={(e) => onSelectVideoModel(e.target.value as HiggsfieldVideoModelSlug)}
              className="w-full rounded border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-white focus:border-emerald-400/60 focus:outline-none"
            >
              {HIGGSFIELD_VIDEO_MODELS.map((m) => (
                <option key={m.slug} value={m.slug}>
                  {m.displayName}{m.badge === 'flagship' ? ' ★' : m.badge === 'cheap' ? ' 💰' : m.badge === 'pro' ? ' 👑' : ''}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-white/40">
              {HIGGSFIELD_VIDEO_MODELS.find((m) => m.slug === safeVideoSlug)?.blurb}
            </p>
          </div>
        </>
      )}

      {/* CLI hint — power users can `npx @higgsfield/cli` for the full 35-model catalog */}
      <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
        <div className="flex items-center gap-2 text-[11px] font-medium text-white/50">
          <span>Power users:</span>
          <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-[11px] text-emerald-200">
            npx @higgsfield/cli model list
          </code>
          <a
            href="https://higgsfield.ai/cli"
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-white/40 hover:text-white/70"
          >
            docs <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
