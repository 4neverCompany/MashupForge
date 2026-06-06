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
import { Loader2, ExternalLink, Check, X, AlertTriangle, RefreshCcw } from 'lucide-react';
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
  // V1.0.8.1-OAUTH-MIGRATION: when the desktop app surfaces
  // `expired_flow` on the OAuth callback, it almost always means the
  // user's Higgsfield OAuth client was registered before v1.0.7.1
  // and doesn't have the `mashupforge://` redirect URI in its
  // allowlist. We surface a one-click reset banner in that case so
  // the user doesn't have to dig into the Higgsfield dashboard to
  // re-register by hand.
  const [migrationNeeded, setMigrationNeeded] = useState(false);
  const [resetting, setResetting] = useState(false);

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
    // Defer the initial fetch to a microtask so `setLoading(true)` inside
    // `refresh` doesn't run synchronously in the effect body (React 19's
    // react-hooks/set-state-in-effect rule). The microtask is still
    // synchronous-from-the-user's-perspective: the load indicator
    // appears in the same browser frame as the effect.
    queueMicrotask(() => {
      void refresh();
    });
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
    //
    // V107.1-OAUTH: in the Tauri desktop app, pass ?via=desktop so the
    // authorize route returns a `mashupforge://oauth/callback` redirect
    // URI instead of the HTTPS one. The OS launches the deep link back
    // into the WebView2 (where the state/PKCE cookies still live),
    // and the deep-link listener below re-issues the callback fetch in
    // that cookie context. Without this, the callback URL opens in the
    // system browser (Tauri's default for external URLs) which has a
    // different cookie jar and we get `expired_flow`.
    const isTauri =
      typeof window !== 'undefined' &&
      (Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) ||
        Boolean((window as unknown as { __TAURI__?: unknown }).__TAURI__));
    const qs = isTauri ? '?via=desktop' : '';
    window.location.href = `/api/higgsfield/oauth/authorize${qs}`;
  };

  // V107.1-OAUTH: listen for the deep-link event from the Tauri backend
  // and complete the OAuth flow by re-issuing the callback in the
  // WebView2 cookie context. Without this, the user gets `expired_flow`
  // because the state/PKCE cookies were set in WebView2 but the
  // callback URL is opened in the system browser by Tauri's default
  // external-URL handling.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const tauriInternals = (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    if (!tauriInternals) return;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        // Lazy-import the event API to avoid pulling Tauri internals
        // into the web bundle's type graph. The dynamic import is a
        // 1-line shim that the bundler tree-shakes out for the web
        // build.
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen<string[]>('deep-link', (event) => {
          const urls = (event.payload as string[]) || [];
          for (const raw of urls) {
            if (!raw.startsWith('mashupforge://oauth/callback')) continue;
            // Parse the callback URL and re-issue the callback in the
            // WebView2 cookie context. Use a same-origin path so the
            // state/PKCE cookies (set during /authorize) are sent.
            const url = new URL(raw.replace(/^mashupforge:/, 'https://mashupforge.invalid:'));
            const code = url.searchParams.get('code');
            const state = url.searchParams.get('state');
            const errorParam = url.searchParams.get('error');
            if (errorParam) {
              window.location.href = `/studio?higgsfield=error&reason=${encodeURIComponent(errorParam)}`;
              return;
            }
            if (!code || !state) {
              window.location.href = '/studio?higgsfield=error&reason=missing_params';
              return;
            }
            // Re-issue the callback in the WebView2 cookie context.
            // The server reads the state/PKCE cookies (set in
            // WebView2 during /authorize), matches state, exchanges
            // the code, and redirects to /studio?higgsfield=connected.
            window.location.href = `/api/higgsfield/oauth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
            return;
          }
        });
      } catch (e) {
        // Tauri internals present but the event API isn't reachable.
        // Fall back gracefully — the user will still see the original
        // expired_flow error and we can debug from the tauri.log.
        console.error('deep-link listen failed', e);
      }
    })();
    return () => {
      try {
        unlisten?.();
      } catch {
        // ignore
      }
    };
  }, []);

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

  // V1.0.8.1-OAUTH-MIGRATION: reset the locally-cached OAuth
  // client_id and bounce back into the authorize flow. The authorize
  // route will register a fresh client whose allowlist includes
  // `mashupforge://oauth/callback`, so the deep-link callback
  // succeeds on the next attempt.
  const handleResetAndRetry = async () => {
    setResetting(true);
    try {
      const res = await fetch('/api/higgsfield/oauth/reset-client', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMigrationNeeded(false);
      // Re-enter the connect flow with ?via=desktop (the in-Tauri
      // detection is the same helper as handleConnect, but we set
      // it explicitly to be defensive in case the Tauri global is
      // not yet wired up at the moment the user clicks Reset).
      const isTauri =
        typeof window !== 'undefined' &&
        (Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) ||
          Boolean((window as unknown as { __TAURI__?: unknown }).__TAURI__));
      const qs = isTauri ? '?via=desktop' : '';
      window.location.href = `/api/higgsfield/oauth/authorize${qs}`;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Reset failed');
      setResetting(false);
    }
  };

  // Surface a success banner when the URL has ?higgsfield=connected
  // (set by the callback route). Strip it after first read.
  //
  // ESLint react-hooks/set-state-in-effect: the setState calls below
  // are deferred via `queueMicrotask` so React's effect body only
  // synchronizes an external system (window.history) — not local
  // component state. The microtask runs after the effect's commit
  // phase so it doesn't trigger cascading renders.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const flag = url.searchParams.get('higgsfield');
    if (flag === 'connected') {
      onConnectionChange?.(true);
      queueMicrotask(() => {
        refresh();
      });
      url.searchParams.delete('higgsfield');
      window.history.replaceState({}, '', url.toString());
    } else if (flag === 'error') {
      const reason = url.searchParams.get('reason') || 'unknown';
      const detail = url.searchParams.get('detail') || '';
      const msg = `Higgsfield connect failed (${reason})${detail ? `: ${detail.slice(0, 120)}` : ''}`;
      // V1.0.8.1-OAUTH-MIGRATION: in the desktop app, an `expired_flow`
      // almost always means the user's Higgsfield OAuth client was
      // registered before v1.0.7.1 and doesn't have the
      // `mashupforge://` redirect URI.
      //
      // BUG-FIX-2026-06-06: the original trigger only fired on
      // `expired_flow` (our /callback's "no state cookie" case). But
      // when the OAuth server itself rejects the redirect_uri at the
      // /authorize step (before our callback ever runs), it returns
      // `reason=invalid_request` with a detail mentioning
      // `redirect_uri`. That was reported in v1.0.9 testing — the
      // banner never showed because `invalid_request` wasn't in the
      // trigger set. The fix: also fire the migration banner on
      // `invalid_request` (or any error whose detail mentions
      // redirect_uri). The web build never hits this case (it uses
      // the HTTPS callback), so the migration banner is desktop-only.
      const isTauri =
        typeof window !== 'undefined' &&
        (Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) ||
          Boolean((window as unknown as { __TAURI__?: unknown }).__TAURI__));
      const detailLower = detail.toLowerCase();
      const isRedirectUriMismatch =
        reason === 'invalid_request' ||
        detailLower.includes('redirect_uri') ||
        detailLower.includes('redirect uri') ||
        detailLower.includes('pre-registered');
      const needsMigration = isTauri && isRedirectUriMismatch;
      queueMicrotask(() => {
        setError(msg);
        setMigrationNeeded(needsMigration);
      });
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
            {migrationNeeded && (
              <div
                data-testid="oauth-migration-banner"
                className="mt-3 rounded border border-amber-400/40 bg-amber-500/10 p-3"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
                  <div className="min-w-0 flex-1 space-y-2 text-[11px] leading-relaxed text-amber-100/90">
                    <p>
                      <span className="font-semibold text-amber-200">OAuth client needs a one-time update.</span>{' '}
                      You connected before v1.0.7.1, so your Higgsfield OAuth
                      client doesn&apos;t have the <code className="rounded bg-black/30 px-1 font-mono text-amber-200">mashupforge://</code> redirect URI in its allowlist.
                      The desktop app can&apos;t complete sign-in until that URI is registered.
                    </p>
                    <p className="text-amber-100/70">
                      <strong>One-click fix:</strong> reset the cached client ID and let MashupForge register a fresh one with the right allowlist. Your existing grants stay safe — re-registering only creates a new client, it doesn&apos;t revoke access.
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={handleResetAndRetry}
                        disabled={resetting}
                        className="inline-flex items-center gap-1.5 rounded border border-amber-400/50 bg-amber-500/20 px-2.5 py-1 text-[11px] font-medium text-amber-100 transition hover:bg-amber-500/30 disabled:opacity-50"
                      >
                        <RefreshCcw className="h-3 w-3" />
                        {resetting ? 'Resetting…' : 'Reset OAuth client and retry'}
                      </button>
                      <a
                        href="https://higgsfield.ai/dashboard/developers/oauth"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-amber-200/80 underline-offset-2 hover:text-amber-100 hover:underline"
                      >
                        Or update your client manually
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            )}
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
            {/* V1.1.0-HOTFIX: always-visible recovery action for users
                whose OAuth client was registered with an outdated
                redirect_uri allowlist. The OAuth 2.0 spec requires
                the server to display the `redirect_uri parameter does
                not match` error IN THE BROWSER (not via redirect), so
                the migration banner in the parent component never
                fires for that class of failure — the user is stranded
                unless they have a button to reset the cached client_id
                and re-register. This button is always visible (not
                gated on the migration banner) so any user who hits
                the redirect_uri error can self-recover. */}
            <button
              type="button"
              onClick={handleResetAndRetry}
              disabled={resetting || working}
              title="Wipe the cached OAuth client_id and re-register. Use this if the Connect flow fails with a 'redirect_uri does not match' error in the browser."
              className="text-[10px] text-white/40 underline-offset-2 transition hover:text-white/70 hover:underline disabled:opacity-50"
            >
              {resetting ? 'Resetting…' : 'Reset OAuth client'}
            </button>
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
