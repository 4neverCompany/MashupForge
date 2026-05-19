'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  Settings as SettingsIcon,
  X,
  Check,
  Image as ImageIcon,
  Trash2,
  Folder,
  Plus,
  Tag,
  Minus,
  Save,
  FolderOpen,
  RefreshCw,
  Eye,
  EyeOff,
  Copy,
  AlertCircle,
  Loader2,
  KeyRound,
  Cpu,
  Monitor,
  Sliders,
  Bot,
  Terminal,
} from 'lucide-react';
import { useNcaAvailability } from '@/lib/useNcaAvailability';
import { showToast } from '@/components/Toast';
import {
  LEONARDO_MODELS,
  type Collection,
  type GeneratedImage,
} from './MashupContext';
import type { UserSettings, WatermarkSettings } from '@/types/mashup';
import { getAllTextModelSpecs } from '@/lib/text-model-specs';
import { DesktopSettingsPanel } from './DesktopSettingsPanel';
import type { SettingsSaveState } from '@/hooks/useSettings';
import { APP_VERSION, getAppVersion } from '@/lib/app-version';

// FEAT-002b: tab restructure. Four sections — General (collections, channel,
// image/video defaults, watermark), API Keys (web-only inputs + a desktop hint),
// AI Engine (pi.dev + system prompt + niches/genres + personalities), and
// Desktop (auto-update + Tauri-native config panel).
type TabId = 'general' | 'apiKeys' | 'aiAgent' | 'aiEngine' | 'desktop';

const TABS: ReadonlyArray<{ id: TabId; label: string; icon: typeof SettingsIcon }> = [
  { id: 'general', label: 'General', icon: Sliders },
  { id: 'apiKeys', label: 'API Keys', icon: KeyRound },
  { id: 'aiAgent', label: 'AI Agent', icon: Bot },
  { id: 'aiEngine', label: 'AI Engine', icon: Cpu },
  { id: 'desktop', label: 'Desktop', icon: Monitor },
];

interface NcaStatus {
  available: boolean;
  authenticated: boolean;
  /** nca's selected provider (e.g. "MiniMax"). Replaces the mmx version
   *  string since nca's `doctor` reports the provider name not a version. */
  provider: string;
  /** Default model for the selected provider (e.g. "MiniMax-M2.5"). */
  model: string;
}

/** One row from `nca models --json` → `provider_models`. */
interface NcaModel {
  provider: string;
  model: string;
  base_url?: string;
  selected?: boolean;
}

// FIX-100 slice A: extracted from MainContent.tsx (~714 LOC).
// PiStatus shape lifted from the inline declaration that lived inside
// MainContent — moved to module scope so the prop interface can refer to it.
export interface PiStatus {
  installed: boolean;
  authenticated: boolean;
  running: boolean;
  provider: string | null;
  model: string | null;
  modelsAvailable: number;
  lastError: string | null;
}

export type PiBusy = null | 'install' | 'start' | 'stop' | 'setup';

// V080-DES-003: defaults + builder live in lib/agent-prompt so the
// runtime ("Reset to Default" button) can interpolate the user's actual
// niches/genres into the system prompt instead of the old hardcoded
// "Marvel, DC, Star Wars, Warhammer 40k" paragraph.
import {
  DEFAULT_NICHES as RECOMMENDED_NICHES,
  DEFAULT_GENRES as RECOMMENDED_GENRES,
  buildDefaultAgentPrompt,
} from '@/lib/agent-prompt';

interface SettingsModalProps {
  onClose: () => void;
  settings: UserSettings;
  updateSettings: (
    patch: Partial<UserSettings> | ((prev: UserSettings) => Partial<UserSettings>),
  ) => void;
  /** FEAT-002b S1: lifecycle of the debounced IDB save — drives the header pill. */
  saveState: SettingsSaveState;
  isDesktop: boolean | null;
  piStatus: PiStatus | null;
  piBusy: PiBusy;
  piError: string | null;
  piSetupMsg: string | null;
  handlePiSetup: () => void;
  ncaSetupMsg: string | null;
  onNcaSetupComplete: (message: string | null) => void;
  refreshPiStatus: () => void;
  collections: Collection[];
  savedImages: GeneratedImage[];
  deleteCollection: (id: string) => void;
  openCollectionModal: () => void;
}

export function SettingsModal({
  onClose,
  settings,
  updateSettings,
  saveState,
  isDesktop,
  piStatus,
  piBusy,
  piError,
  piSetupMsg,
  handlePiSetup,
  ncaSetupMsg,
  onNcaSetupComplete,
  refreshPiStatus,
  collections,
  savedImages,
  deleteCollection,
  openCollectionModal,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>('general');
  // BUG-ACL-006: app version chip in the modal footer. Seeded from the
  // package.json constant so the footer renders something on the first
  // paint; upgraded to the Tauri-reported value when the runtime API
  // resolves. The runtime call is wrapped in try/catch inside
  // `getAppVersion` so the BUG-ACL-006 throw can't leave the footer
  // blank — falls back to APP_VERSION on ACL denial.
  const [appVersion, setAppVersion] = useState<string>(APP_VERSION);
  useEffect(() => {
    let cancelled = false;
    void getAppVersion().then((v) => {
      if (!cancelled) setAppVersion(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  // Inline personality-save input — replaces the blocking prompt() dialog.
  const [personalityName, setPersonalityName] = useState<string | null>(null);
  // Which password fields are currently revealed.
  const [revealedFields, setRevealedFields] = useState<Set<string>>(new Set());
  const toggleReveal = (field: string) =>
    setRevealedFields((prev) => {
      const next = new Set(prev);
      next.has(field) ? next.delete(field) : next.add(field);
      return next;
    });
  const copyField = (value: string) =>
    navigator.clipboard.writeText(value).then(
      () => showToast('Copied to clipboard', 'success'),
      () => showToast('Failed to copy', 'error'),
    );

  // MMX setup handler — opens `mmx auth login --no-browser` in a tmux
  // session so the user can authenticate via OAuth or paste an API key.
  // ncaBusyRef gates double-click: once the user clicks Launch, the button
  // stays disabled until the POST completes (success or error), preventing
  // a second click from silently killing the first tmux session.
  const ncaBusyRef = useRef(false);
  const [ncaApiKey, setNcaApiKey] = useState('');
  // Transient success flag set after a non-interactive API-key save lands a
  // 200 from /api/mmx/setup AND /api/mmx/status confirms `authenticated:true`.
  // Auto-clears after ~3.5s so the inline confirmation doesn't linger forever.
  // Distinct from `onNcaSetupComplete` (which surfaces the server's `message`
  // field in a separate code-block panel) — this flag is the green "✓
  // Authenticated" line that lives next to the form itself.
  const [ncaJustAuthed, setNcaJustAuthed] = useState(false);

  // Refresh `ncaStatus` from the server. Called after a successful setup so
  // the UI flips from "Not Authenticated" → "Available" without a tab toggle.
  // Returns the new status (or null on error) so callers can branch on it
  // — used by `postNcaSetup` to decide whether to fire the success badge.
  const refreshNcaStatus = async (): Promise<NcaStatus | null> => {
    try {
      const r = await fetch('/api/nca/status', { cache: 'no-store' });
      if (!r.ok) return null;
      const d = (await r.json()) as { available?: unknown; authenticated?: unknown; provider?: unknown; model?: unknown };
      const next: NcaStatus = {
        available: !!d.available,
        authenticated: !!d.authenticated,
        provider: typeof d.provider === 'string' ? d.provider : '',
        model: typeof d.model === 'string' ? d.model : '',
      };
      setNcaStatus(next);
      return next;
    } catch {
      // Best-effort; the existing tab-mount probe will retry on next open.
      return null;
    }
  };

  // Internal POST helper. `apiKey` undefined → interactive (tmux) flow;
  // `apiKey` set → non-interactive `mmx auth login --api-key` on the server.
  const postNcaSetup = async (apiKey?: string): Promise<void> => {
    if (ncaBusyRef.current) return;
    ncaBusyRef.current = true;
    setNcaBusy(true);
    setNcaError(null);
    try {
      const res = await fetch('/api/nca/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: apiKey ? JSON.stringify({ apiKey }) : undefined,
      });
      const data = (await res.json()) as {
        success?: boolean;
        error?: string;
        tmuxSession?: string;
        message?: string;
        // `pending: true` means the server opened a terminal / tmux session
        // but the user still has to complete sign-in there. Used to keep the
        // status panel in an informational rather than confirmatory state.
        pending?: boolean;
      };
      if (!res.ok || data.success === false) {
        setNcaError(data.error || 'Setup failed');
      } else {
        onNcaSetupComplete(data.message || null);
        if (apiKey) {
          // Non-interactive path: clear the field + re-probe status. Fire
          // the success badge only if the re-probe confirms authenticated;
          // otherwise the user gets the server message via the existing
          // ncaSetupMsg panel without a misleading green checkmark.
          setNcaApiKey('');
          const next = await refreshNcaStatus();
          if (next?.authenticated) setNcaJustAuthed(true);
        }
      }
    } catch {
      setNcaError('Network error — could not reach the setup endpoint.');
    } finally {
      setNcaBusy(false);
      ncaBusyRef.current = false;
    }
  };

  // Auto-dismiss the success badge so the UI returns to its steady "Available"
  // state. 3.5s is long enough to read "✓ Authenticated" without it becoming
  // visual debt the user has to dismiss manually.
  useEffect(() => {
    if (!ncaJustAuthed) return;
    const t = setTimeout(() => setNcaJustAuthed(false), 3500);
    return () => clearTimeout(t);
  }, [ncaJustAuthed]);

  const handleNcaSetup = () => { void postNcaSetup(); };
  const handleNcaApiKeySave = () => {
    const key = ncaApiKey.trim();
    if (!key) return;
    void postNcaSetup(key);
  };

  // MMX status polling — runs once when the AI Agent tab is opened.
  // /api/mmx/status fills in version + auth detail when this tab is open.
  // When MMX is selected but not authenticated, the "Launch MMX Setup"
  // button opens `mmx auth login --no-browser` in a tmux session so the
  // user can OAuth or paste an API key interactively.
  const ncaAvailable = useNcaAvailability();
  const [ncaStatus, setNcaStatus] = useState<NcaStatus | null>(null);
  const [ncaBusy, setNcaBusy] = useState(false);
  const [ncaError, setNcaError] = useState<string | null>(null);
  // LLM-INTEGRATION-0513: status for the Vercel AI SDK provider.
  // Same shape as NcaStatus but `provider` is the resolved upstream
  // (openai / anthropic / openrouter) so the card can render which API
  // key is wired up. `available` ↔ at least one key is set on the server.
  const [aiStatus, setAiStatus] = useState<{
    available: boolean;
    authenticated: boolean;
    provider: string | null;
    model: string | null;
  } | null>(null);
  // Model list from /api/nca/models. Populated lazily once nca is
  // authenticated — there's no point fetching it before then since the
  // models endpoint will surface them per-provider regardless of which
  // env keys are set, but the picker UI is only useful in the
  // authenticated branch. NCA-INSTALL-DESIGN.
  const [ncaModels, setNcaModels] = useState<NcaModel[] | null>(null);
  // Disambiguates "saving a model selection" from the broader ncaBusy
  // (which gates the API-key Save button + card click). Lets the model
  // picker stay interactive while the auth flow is mid-flight, and vice
  // versa.
  const [ncaModelSaving, setNcaModelSaving] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab !== 'aiAgent') return;
    let cancelled = false;
    fetch('/api/nca/status', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setNcaStatus({
          available: !!data.available,
          authenticated: !!data.authenticated,
          provider: typeof data.provider === 'string' ? data.provider : '',
          model: typeof data.model === 'string' ? data.model : '',
        });
      })
      .catch(() => { /* leave null — card will fall back to ncaAvailable */ });
    return () => { cancelled = true; };
  }, [activeTab]);

  // LLM-INTEGRATION-0513: probe /api/ai/status for the vercel-ai card.
  // Same gating as the nca probe (only fires when the AI Agent tab is
  // open) — no point burning a server hop on every tab change.
  useEffect(() => {
    if (activeTab !== 'aiAgent') return;
    let cancelled = false;
    fetch('/api/ai/status', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setAiStatus({
          available: !!data.available,
          authenticated: !!data.authenticated,
          provider: typeof data.provider === 'string' ? data.provider : null,
          model: typeof data.model === 'string' ? data.model : null,
        });
      })
      .catch(() => { /* leave null — card renders "Checking…" until probe lands */ });
    return () => { cancelled = true; };
  }, [activeTab]);

  // Fetch the model list when (and only when) nca is authenticated. The
  // endpoint runs `nca models --json` server-side and returns the full
  // `provider_models` array; we ignore aliases / thinking config here
  // because the picker only needs the raw provider/model rows.
  useEffect(() => {
    if (!ncaStatus?.authenticated) return;
    let cancelled = false;
    fetch('/api/nca/models', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { provider_models?: unknown } | null) => {
        if (cancelled || !data || !Array.isArray(data.provider_models)) return;
        const rows: NcaModel[] = data.provider_models.flatMap((row): NcaModel[] => {
          if (!row || typeof row !== 'object') return [];
          const r = row as Record<string, unknown>;
          if (typeof r.provider !== 'string' || typeof r.model !== 'string') return [];
          return [{
            provider: r.provider,
            model: r.model,
            base_url: typeof r.base_url === 'string' ? r.base_url : undefined,
            selected: typeof r.selected === 'boolean' ? r.selected : undefined,
          }];
        });
        setNcaModels(rows);
      })
      .catch(() => { /* leave null — picker just won't render until next probe */ });
    return () => { cancelled = true; };
  }, [ncaStatus?.authenticated]);

  /**
   * Persist a model selection via /api/nca/setup, then re-probe status so
   * the "ready (model)" line updates immediately. Uses the existing
   * setup-route shape (which accepts `{ model }` without an apiKey).
   */
  const handleNcaModelSelect = async (model: string): Promise<void> => {
    if (ncaModelSaving) return;
    setNcaModelSaving(model);
    setNcaError(null);
    try {
      const res = await fetch('/api/nca/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || data.success === false) {
        setNcaError(data.error || 'Failed to save model selection');
        return;
      }
      await refreshNcaStatus();
    } catch {
      setNcaError('Network error — could not reach the setup endpoint.');
    } finally {
      setNcaModelSaving(null);
    }
  };

  // AI-AGENT-SETTINGS: read the canonical aiAgentProvider but fall back to
  // the legacy activeAiAgent so users with older persisted settings keep
  // their selection. Writes go to both fields below until activeAiAgent
  // is fully retired (see types/mashup.ts deprecation note). 'mmx' is a
  // historical value still in some IDB payloads — treated as 'nca' for
  // selection / status logic per NCA-INTEGRATION-DESIGN.
  // LLM-INTEGRATION-0513 added 'vercel-ai' — direct SDK calls.
  const activeAiAgent: 'pi' | 'nca' | 'mmx' | 'vercel-ai' =
    settings.aiAgentProvider ?? settings.activeAiAgent ?? 'pi';


  // FEAT-002b S1: drive the saved/saving/error pill from the real lifecycle
  // exposed by useSettings instead of an ephemeral local timer. The "Saved"
  // pill only shows for ~1.5s after each successful write so the header
  // doesn't permanently advertise "Saved" the entire session — once the
  // window elapses we hide it via the local fade flag below.
  const [showSavedPill, setShowSavedPill] = useState(false);
  useEffect(() => {
    if (saveState.kind !== 'saved') {
      setShowSavedPill(false);
      return;
    }
    setShowSavedPill(true);
    const t = setTimeout(() => setShowSavedPill(false), 1500);
    return () => clearTimeout(t);
  }, [saveState]);

  // ── MMX setup form (shared between hoisted CTA and active-agent panel) ───
  // Defined inline so both render sites get pixel-identical UX. The caption
  // is state-aware so a single block covers Loading / Not Installed /
  // Not Authenticated. The authenticated-and-ready state is rendered
  // separately by the active-agent panel since the hoisted CTA hides itself
  // in that case.
  //
  // State-driven copy:
  //   loading        → "Checking MMX status…"
  //   not installed  → "MMX is not installed yet."
  //   not auth'd     → "MMX is installed but not authenticated."
  //
  // Note: the prior secondary "Sign in via terminal (OAuth)" link was
  // removed in MMX-OAUTH-404-FIX after MiniMax's `/oauth/authorize` 404'd.
  // See docs/bmad/discoveries/MMX-OAUTH-404-2026-04-30.md.
  const ncaCaption =
    ncaStatus == null
      ? 'Checking nca status…'
      : !ncaStatus.available
        ? 'nca is not installed yet.'
        : 'nca is installed but not authenticated.';

  // NCA-INSTALL-DESIGN: branch on installation state. The "not installed"
  // path used to render the same API-key form as "not authenticated",
  // which was confusing — the user can't authenticate a binary that
  // doesn't exist yet. Now we show an Install CTA + winget hint and
  // hold back the API-key form until ncaStatus.available flips true.
  const ncaIsNotInstalled = ncaStatus == null || !ncaStatus.available;

  // NCA-SETUP-UI-FIX: split the setup surface into two pieces. The install
  // instructions stay below the card grid (rendered when nca isn't on PATH);
  // the API-key form moves INSIDE the nca card so the input sits next to the
  // amber "Not Authenticated" status it's responding to. `stopPropagation`
  // on the wrapper is required because the card is clickable for selection
  // — without it, focusing the input would also toggle the card.
  const ncaInstallBlock = (
    <div className="space-y-2">
      <p className="text-[11px] text-zinc-400">{ncaCaption}</p>
      <p className="text-[10px] text-zinc-500 leading-relaxed">
        nca should be bundled with MashupForge on Windows. If you&apos;re seeing this:
      </p>
      <ul className="text-[10px] text-zinc-500 leading-relaxed list-disc pl-4 space-y-1">
        <li>
          <strong>Desktop app:</strong> reinstall the latest release from{' '}
          <a
            href="https://github.com/Code4neverCompany/MashupForge/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-400 hover:text-[#c5a062] underline underline-offset-2"
          >
            MashupForge releases
          </a>{' '}
          — the bundle includes <code className="font-mono">nca.exe</code>.
        </li>
        <li>
          <strong>Web / dev mode:</strong> install nca yourself —
          clone <a
            href="https://github.com/madebyaris/native-cli-ai"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-400 hover:text-[#c5a062] underline underline-offset-2"
          >native-cli-ai</a>, run <code className="font-mono">cargo build --release -p nca-cli</code>,
          place <code className="font-mono">nca</code> on PATH or set <code className="font-mono">NCA_BIN</code>.
        </li>
      </ul>
    </div>
  );

  const ncaApiKeyForm = (
    <div
      className="space-y-3 mt-3 pt-3 border-t border-zinc-800/60"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="space-y-1">
        <label htmlFor="nca-api-key" className="block text-[10px] uppercase tracking-wider text-zinc-500">
          MiniMax API key
        </label>
        <div className="flex gap-2">
          <input
            id="nca-api-key"
            type="password"
            value={ncaApiKey}
            onChange={(e) => setNcaApiKey(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && ncaApiKey.trim() && !ncaBusy) {
                e.preventDefault();
                handleNcaApiKeySave();
              }
            }}
            placeholder="sk-…"
            disabled={ncaBusy}
            autoComplete="off"
            spellCheck={false}
            aria-describedby="nca-api-key-help"
            className="flex-1 bg-zinc-900 border border-zinc-700 focus:border-[#c5a062] outline-none rounded px-2 py-1 text-[12px] text-white font-mono disabled:opacity-60"
          />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleNcaApiKeySave(); }}
            disabled={ncaBusy || !ncaApiKey.trim()}
            className="btn-gold-sm rounded-lg px-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {ncaBusy ? 'Saving…' : 'Save'}
          </button>
        </div>
        <p id="nca-api-key-help" className="text-[10px] text-zinc-600">
          Stored in your local config (read by nca via the MINIMAX_API_KEY env); never sent to MashupForge servers.
        </p>
      </div>

      {/* MMX-OAUTH-404-FIX 2026-04-30: external link to the API-key
          procurement page (the OAuth flow upstream is currently
          broken). See docs/bmad/discoveries/MMX-OAUTH-404-2026-04-30.md. */}
      <div className="flex items-center gap-2">
        <a
          href="https://platform.minimax.io/"
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-[11px] text-zinc-400 hover:text-[#c5a062] underline underline-offset-2"
        >
          Don&apos;t have an API key? Get one at platform.minimax.io →
        </a>
      </div>

      {/* Inline feedback. ncaJustAuthed auto-clears after 3.5s; ncaError
          persists until the next attempt. */}
      {ncaJustAuthed && (
        <p className="text-[11px] text-emerald-400 flex items-center gap-1">
          <span aria-hidden>✓</span>
          nca authenticated. Pick a provider/model below.
        </p>
      )}
      {ncaError && (
        <p className="text-[11px] text-red-400 whitespace-pre-wrap" role="alert">{ncaError}</p>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="bg-[#0d0d0d]/99 backdrop-blur-xl border-0 sm:border border-[#c5a062]/30 rounded-none sm:rounded-2xl w-full sm:max-w-2xl overflow-hidden shadow-[0_8px_48px_rgba(0,0,0,0.8),0_0_60px_rgba(197,160,98,0.08),0_0_0_1px_rgba(197,160,98,0.06)] flex flex-col h-full sm:h-auto max-h-[100dvh] sm:max-h-[90vh]"
      >
        <div className="flex items-center justify-between p-6 border-b border-[#c5a062]/20 bg-[#050505]/60 shrink-0">
          <h3 className="type-title flex items-center gap-2">
            <SettingsIcon className="w-5 h-5 text-[#c5a062]" />
            Settings
          </h3>
          <div className="flex items-center gap-3">
            {/* FEAT-002b S1: real save lifecycle pill — emerald Saved /
                blue Saving… / red Save failed: msg. Replaces the prior
                ephemeral local timer that fired regardless of whether
                the IDB write actually succeeded. */}
            {saveState.kind === 'error' && (
              <span
                role="alert"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-red-500/15 text-red-300 border border-red-500/40 max-w-[260px]"
                title={saveState.message}
              >
                <AlertCircle className="w-3 h-3 shrink-0" />
                <span className="truncate">Save failed: {saveState.message}</span>
              </span>
            )}
            {saveState.kind === 'saving' && (
              <span className="inline-flex items-center gap-1.5 text-xs text-[#00e6ff] pointer-events-none select-none">
                <Loader2 className="w-3 h-3 animate-spin" />
                Saving…
              </span>
            )}
            {saveState.kind !== 'error' && saveState.kind !== 'saving' && (
              <motion.span
                animate={{ opacity: showSavedPill ? 1 : 0 }}
                transition={{ duration: 0.2 }}
                className="text-xs text-emerald-400 flex items-center gap-1 pointer-events-none select-none"
              >
                <Check className="w-3 h-3" />
                Saved
              </motion.span>
            )}
            <button
              onClick={onClose}
              className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* FEAT-002b: tab bar — sticky between header and scroll body. */}
        <div className="flex items-stretch gap-1 px-3 pt-2 border-b border-zinc-800/60 bg-[#050505]/40 shrink-0 overflow-x-auto custom-scrollbar">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                aria-current={active ? 'page' : undefined}
                className={`relative inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap rounded-t-lg ${
                  active
                    ? 'text-white bg-zinc-900/60'
                    : 'text-zinc-500 hover:text-zinc-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
                {active && (
                  <span className="absolute left-2 right-2 -bottom-px h-0.5 bg-[#c5a062] rounded-full" />
                )}
              </button>
            );
          })}
        </div>

        <div className="p-6 space-y-6 overflow-y-auto">
          {activeTab === 'apiKeys' && (
          <>
          {/* FEAT-002b: in desktop mode all API credentials are owned by
              DesktopSettingsPanel (config.json). Surface a hint here so
              users land on the right place instead of pondering an empty
              tab. The actual web-only inputs below are gated by
              `isDesktop === false` for STORY-130 / INSTAGRAM-CRED-FIX. */}
          {isDesktop === true && (
            <div className="rounded-xl border border-[#c5a062]/30 bg-[#c5a062]/5 p-4 flex items-start gap-3">
              <Monitor className="w-4 h-4 text-[#c5a062] shrink-0 mt-0.5" />
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-white">Managed in Desktop Configuration</p>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Leonardo, Instagram, and Pinterest credentials are stored in <code className="text-zinc-300">config.json</code> on disk and injected into the pi sidecar at start. Edit them in the Desktop tab.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('desktop')}
                  className="text-[11px] text-[#00e6ff] hover:text-[#33eaff] transition-colors"
                >
                  Open Desktop tab →
                </button>
              </div>
            </div>
          )}
          {/* API Keys Section */}
          <div className="space-y-4 pt-4 border-t border-zinc-800">
            <label className="text-sm font-medium text-zinc-300">API Keys</label>
            {/*
              STORY-130: In desktop mode the Leonardo API key is owned by
              DesktopSettingsPanel (writes to config.json + injects env var
              into the sidecar). Rendering a second input here persisted to
              origin-scoped IndexedDB and silently shadowed the real value
              — top appeared broken while bottom worked. Hide in desktop.
            */}
            {isDesktop === false && (
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Leonardo API Key</label>
                <div className="relative">
                  <input
                    type={revealedFields.has('leonardo') ? 'text' : 'password'}
                    value={settings.apiKeys.leonardo || ''}
                    onChange={(e) => updateSettings({ apiKeys: { ...settings.apiKeys, leonardo: e.target.value } })}
                    placeholder="••••••••••••••••"
                    className="w-full bg-zinc-950 border border-zinc-800/60 rounded-lg px-3 py-2 pr-16 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#c5a062]/30"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    {settings.apiKeys.leonardo && (
                      <button type="button" onClick={() => copyField(settings.apiKeys.leonardo!)} className="text-zinc-500 hover:text-zinc-300 transition-colors" aria-label="Copy API key">
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button type="button" onClick={() => toggleReveal('leonardo')} className="text-zinc-500 hover:text-zinc-300 transition-colors" aria-label={revealedFields.has('leonardo') ? 'Hide API key' : 'Show API key'}>
                      {revealedFields.has('leonardo') ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-4 pt-4 border-t border-zinc-800">
              <h4 className="text-sm font-bold text-white">Free Social Posting Setup</h4>

              {/*
                INSTAGRAM-CRED-FIX: In desktop mode IG creds are owned by
                DesktopSettingsPanel (writes to config.json, stable on-disk
                location). Rendering a second input here persisted to
                origin-scoped IndexedDB silently lost data on webview origin
                drift (STORY-121 fallback path). Hide in desktop.
              */}
              {isDesktop === false && (
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Instagram Graph API (Free)</label>
                  <div className="grid grid-cols-1 gap-2">
                    <input
                      type="text"
                      value={settings.apiKeys.instagram?.igAccountId || ''}
                      onChange={(e) => updateSettings({ apiKeys: { ...settings.apiKeys, instagram: { accessToken: settings.apiKeys.instagram?.accessToken ?? '', igAccountId: e.target.value } } })}
                      placeholder="Instagram Business Account ID"
                      className="w-full bg-zinc-950 border border-zinc-800/60 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#c5a062]/30"
                    />
                    <div className="relative">
                      <input
                        type={revealedFields.has('ig-token') ? 'text' : 'password'}
                        value={settings.apiKeys.instagram?.accessToken || ''}
                        onChange={(e) => updateSettings({ apiKeys: { ...settings.apiKeys, instagram: { accessToken: e.target.value, igAccountId: settings.apiKeys.instagram?.igAccountId ?? '' } } })}
                        placeholder="Long-lived Page Access Token"
                        className="w-full bg-zinc-950 border border-zinc-800/60 rounded-lg px-3 py-2 pr-16 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#c5a062]/30"
                      />
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                        {settings.apiKeys.instagram?.accessToken && (
                          <button type="button" onClick={() => copyField(settings.apiKeys.instagram!.accessToken)} className="text-zinc-500 hover:text-zinc-300 transition-colors" aria-label="Copy access token">
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button type="button" onClick={() => toggleReveal('ig-token')} className="text-zinc-500 hover:text-zinc-300 transition-colors" aria-label={revealedFields.has('ig-token') ? 'Hide token' : 'Show token'}>
                          {revealedFields.has('ig-token') ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  </div>
                  <p className="text-[10px] text-zinc-500 mt-1">Requires a Facebook Developer App linked to an Instagram Business account.</p>
                </div>
              )}

              {/* Pinterest — hidden on desktop; config.json owns these keys */}
              {isDesktop === false && (
              <div className="space-y-2 pt-3 border-t border-zinc-800/60">
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Pinterest API</label>
                <div className="grid grid-cols-1 gap-2">
                  <div className="relative">
                    <input
                      type={revealedFields.has('pinterest-token') ? 'text' : 'password'}
                      value={settings.apiKeys.pinterest?.accessToken || ''}
                      onChange={(e) => updateSettings({ apiKeys: { ...settings.apiKeys, pinterest: { accessToken: e.target.value, boardId: settings.apiKeys.pinterest?.boardId } } })}
                      placeholder="Pinterest Access Token"
                      className="w-full bg-zinc-950 border border-zinc-800/60 rounded-lg px-3 py-2 pr-16 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#c5a062]/30"
                    />
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                      {settings.apiKeys.pinterest?.accessToken && (
                        <button type="button" onClick={() => copyField(settings.apiKeys.pinterest!.accessToken)} className="text-zinc-500 hover:text-zinc-300 transition-colors" aria-label="Copy access token">
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button type="button" onClick={() => toggleReveal('pinterest-token')} className="text-zinc-500 hover:text-zinc-300 transition-colors" aria-label={revealedFields.has('pinterest-token') ? 'Hide token' : 'Show token'}>
                        {revealedFields.has('pinterest-token') ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                  <input
                    type="text"
                    value={settings.apiKeys.pinterest?.boardId || ''}
                    onChange={(e) => updateSettings({ apiKeys: { ...settings.apiKeys, pinterest: { accessToken: settings.apiKeys.pinterest?.accessToken ?? '', boardId: e.target.value } } })}
                    placeholder="Board ID (optional — defaults to account's first board)"
                    className="w-full bg-zinc-950 border border-zinc-800/60 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#c5a062]/30"
                  />
                </div>
                <p className="text-[10px] text-zinc-500 mt-1">
                  Create an app at developers.pinterest.com with <code>pins:write</code> and <code>boards:read</code> scopes.
                </p>
              </div>
              )}
            </div>
          </div>
          </>
          )}

          {activeTab === 'aiAgent' && (
          <>
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-1.5 bg-[#c5a062]/10 rounded-lg">
                <Bot className="w-4 h-4 text-[#c5a062]" />
              </div>
              <h4 className="text-sm font-bold text-white uppercase tracking-wider">Active AI Agent</h4>
            </div>
            <p className="text-[11px] text-zinc-500 -mt-2">
              Pick the backend that handles ideas, captions, prompt enhancement, and tagging. The active agent is used for every text-AI call across the app.
            </p>

            {/* FIRSTRUN-503: fresh installs default to vercel-ai (types/mashup.ts:847)
                but ship with no API keys, so the first chat hits a 503 with no
                explanation. Surface the missing-key state at the top of the tab
                whenever vercel-ai is active and /api/ai/status reports
                available=false. Keys are server-side env vars, so we point at
                them by name instead of pretending there's an in-UI form. */}
            {activeAiAgent === 'vercel-ai' && aiStatus?.available === false && (
              <div
                role="status"
                className="flex items-start gap-2.5 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2.5"
              >
                <AlertCircle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold text-amber-200 mb-0.5">
                    AI chat is unavailable — vercel-ai has no API key.
                  </p>
                  <p className="text-[11px] text-amber-200/80 leading-relaxed">
                    Set one of <code className="text-[10px] bg-amber-400/10 px-1 rounded">MINIMAX_API_KEY</code>,{' '}
                    <code className="text-[10px] bg-amber-400/10 px-1 rounded">OPENAI_API_KEY</code>,{' '}
                    <code className="text-[10px] bg-amber-400/10 px-1 rounded">ANTHROPIC_API_KEY</code>, or{' '}
                    <code className="text-[10px] bg-amber-400/10 px-1 rounded">OPENROUTER_API_KEY</code> on the server, or pick a different agent below.
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* nca card — Aris's native-cli-ai. 'mmx' is treated as
                  selected here too so legacy persisted settings render
                  correctly; lib/aiClient.ts back-compat-aliases mmx→nca. */}
              {(() => {
                const selected = activeAiAgent === 'nca' || activeAiAgent === 'mmx';
                const available = ncaStatus?.available ?? ncaAvailable;
                let dot = 'bg-zinc-600';
                let label = 'Checking…';
                let labelColor = 'text-zinc-400';
                if (available === true) {
                  if (ncaStatus?.authenticated === false) {
                    dot = 'bg-amber-400';
                    label = 'Not Authenticated';
                    labelColor = 'text-amber-300';
                  } else {
                    dot = 'bg-emerald-400';
                    label = 'Available';
                    labelColor = 'text-emerald-300';
                  }
                } else if (available === false) {
                  dot = 'bg-red-500';
                  label = 'Not Installed';
                  labelColor = 'text-red-300';
                }
                  const handleNcaCardClick = () => {
                    // Probe / refresh nca state on click. /api/nca/setup is
                    // idempotent — the empty-body call below is just a
                    // doctor probe that re-syncs ncaStatus without writing.
                    handleNcaSetup();
                    // Promote nca to the active agent only on a healthy
                    // machine and only when not already selected — no point
                    // re-writing the same setting on every click.
                    if (
                      !selected
                      && available === true
                      && ncaStatus?.authenticated === true
                    ) {
                      updateSettings({ activeAiAgent: 'nca', aiAgentProvider: 'nca' });
                    }
                  };
                  // NCA-SETUP-UI-FIX: card is a div (not a button) so the
                  // inline API-key input + Save can nest legally — HTML
                  // forbids interactive elements inside <button>. Click +
                  // keyboard activation are wired manually for parity with
                  // the previous button semantics.
                  // Show the form whenever the binary is known-installed and
                  // we don't yet have a positive auth signal. Using `!== true`
                  // (instead of `=== false`) keeps the form visible during
                  // the status-probe loading window — when ncaStatus is
                  // still null but `available` is true via the
                  // useNcaAvailability fallback, otherwise the form stays
                  // invisible for the 300–1500ms of the network probe and
                  // a quick-clicking user sees no input at all.
                  const showApiKeyForm = available === true && ncaStatus?.authenticated !== true;
                  // CLI-SETUP-MUTEX: while pi.dev setup is in flight (piBusy
                  // non-null) we lock the nca card too, otherwise a click
                  // here would spawn a parallel tmux/setup session and the
                  // two flows would race for the user's attention.
                  const setupBusy = ncaBusy || piBusy !== null;
                  return (
                    <div
                      role="button"
                      tabIndex={setupBusy ? -1 : 0}
                      onClick={() => { if (!setupBusy) handleNcaCardClick(); }}
                      onKeyDown={(e) => {
                        if (setupBusy) return;
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleNcaCardClick();
                        }
                      }}
                      aria-pressed={selected}
                      aria-disabled={setupBusy}
                      className={`text-left rounded-xl border p-4 transition-all cursor-pointer ${
                        setupBusy ? 'opacity-60 cursor-not-allowed' : ''
                      } ${
                        selected
                          ? 'border-[#c5a062] bg-[#c5a062]/10 shadow-[0_0_0_1px_rgba(197,160,98,0.3)]'
                          : 'border-zinc-800/60 bg-zinc-950/40 hover:border-zinc-700'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Terminal className="w-4 h-4 text-[#c5a062]" />
                          <span className="text-sm font-bold text-white">nca</span>
                        </div>
                        <span className={`text-[10px] font-semibold uppercase tracking-wider ${selected ? 'text-[#c5a062]' : 'text-zinc-500'}`}>
                          {selected ? '● Selected' : '○ Select'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mb-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                        <span className={`text-[11px] ${labelColor}`}>{label}</span>
                        {ncaStatus?.model && (
                          <span className="text-[10px] text-zinc-500 ml-1 truncate">{ncaStatus.model}</span>
                        )}
                      </div>
                      <p className="text-[10px] text-zinc-500 leading-relaxed">
                        Aris&apos;s nca (native-cli-ai) — Rust-native, MiniMax-powered text agent
                        with multi-provider support (OpenAI / Anthropic / OpenRouter via env keys).
                      </p>
                      {showApiKeyForm && ncaApiKeyForm}
                    </div>
                  );
              })()}

              {/* Pi.dev card */}
              {(() => {
                const selected = activeAiAgent === 'pi';
                const s = piStatus;
                let dot = 'bg-zinc-600';
                let label = 'Checking…';
                let labelColor = 'text-zinc-400';
                if (s) {
                  if (!s.installed) {
                    dot = 'bg-red-500';
                    label = 'Not Installed';
                    labelColor = 'text-red-300';
                  } else if (!s.authenticated) {
                    dot = 'bg-amber-400';
                    label = 'Not Authenticated';
                    labelColor = 'text-amber-300';
                  } else if (s.running) {
                    dot = 'bg-emerald-400';
                    label = 'Running';
                    labelColor = 'text-emerald-300';
                  } else {
                    dot = 'bg-[#00e6ff]';
                    label = 'Ready';
                    labelColor = 'text-[#00e6ff]';
                  }
                }
                return (
                  <button
                    type="button"
                    onClick={() => updateSettings({ activeAiAgent: 'pi', aiAgentProvider: 'pi' })}
                    aria-pressed={selected}
                    className={`text-left rounded-xl border p-4 transition-all ${
                      selected
                        ? 'border-[#c5a062] bg-[#c5a062]/10 shadow-[0_0_0_1px_rgba(197,160,98,0.3)]'
                        : 'border-zinc-800/60 bg-zinc-950/40 hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Cpu className="w-4 h-4 text-[#c5a062]" />
                        <span className="text-sm font-bold text-white">Pi.dev</span>
                      </div>
                      <span className={`text-[10px] font-semibold uppercase tracking-wider ${selected ? 'text-[#c5a062]' : 'text-zinc-500'}`}>
                        {selected ? '● Selected' : '○ Select'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                      <span className={`text-[11px] ${labelColor}`}>{label}</span>
                      {s?.provider && s?.model && (
                        <span className="text-[10px] text-zinc-500 ml-1 truncate">{s.provider}/{s.model}</span>
                      )}
                    </div>
                    <p className="text-[10px] text-zinc-500 leading-relaxed">
                      pi.dev sidecar — text generation, ideas, captions, tags, vision.
                    </p>
                  </button>
                );
              })()}

              {/* LLM-INTEGRATION-0513: Vercel AI SDK card — stateless direct
                  HTTPS calls to the configured provider (OpenAI / Anthropic
                  / OpenRouter). No subprocess, no binary, no install flow.
                  Availability flips on the moment one of the *_API_KEY env
                  vars is set on the server. */}
              {(() => {
                const selected = activeAiAgent === 'vercel-ai';
                const available = aiStatus?.available;
                let dot = 'bg-zinc-600';
                let label = 'Checking…';
                let labelColor = 'text-zinc-400';
                if (available === true) {
                  dot = 'bg-emerald-400';
                  label = 'Available';
                  labelColor = 'text-emerald-300';
                } else if (available === false) {
                  dot = 'bg-amber-400';
                  label = 'No API key';
                  labelColor = 'text-amber-300';
                }
                return (
                  <button
                    type="button"
                    onClick={() => updateSettings({ activeAiAgent: 'vercel-ai', aiAgentProvider: 'vercel-ai' })}
                    aria-pressed={selected}
                    className={`text-left rounded-xl border p-4 transition-all ${
                      selected
                        ? 'border-[#c5a062] bg-[#c5a062]/10 shadow-[0_0_0_1px_rgba(197,160,98,0.3)]'
                        : 'border-zinc-800/60 bg-zinc-950/40 hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Cpu className="w-4 h-4 text-[#c5a062]" />
                        <span className="text-sm font-bold text-white">vercel-ai</span>
                      </div>
                      <span className={`text-[10px] font-semibold uppercase tracking-wider ${selected ? 'text-[#c5a062]' : 'text-zinc-500'}`}>
                        {selected ? '● Selected' : '○ Select'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                      <span className={`text-[11px] ${labelColor}`}>{label}</span>
                      {aiStatus?.provider && aiStatus?.model && (
                        <span className="text-[10px] text-zinc-500 ml-1 truncate">{aiStatus.provider}/{aiStatus.model}</span>
                      )}
                    </div>
                    <p className="text-[10px] text-zinc-500 leading-relaxed">
                      Vercel AI SDK — direct MiniMax / OpenAI / Anthropic / OpenRouter streaming.
                      Set MINIMAX_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, or OPENROUTER_API_KEY on the server.
                    </p>
                  </button>
                );
              })()}
            </div>

            {/* MMX install CTA — visible regardless of which agent is currently
                active so users can install/auth MMX without first selecting it.
                Without this hoist the button was buried inside the
                `activeAiAgent === 'mmx'` branch and invisible whenever Pi.dev
                was the default active agent. Renders during the null/loading
                window as well so the install affordance never disappears: the
                /api/mmx/status probe can take a beat on cold starts and we'd
                rather show the button optimistically than make the user wait. */}
            {/* NCA-SETUP-UI-FIX: API-key form moved into the nca card so
                this hoisted block now only surfaces install instructions
                (binary missing). When nca is installed-but-not-auth'd, the
                inline form on the card itself is the single source of
                truth — no duplicate input below. */}
            {activeAiAgent === 'pi' && ncaIsNotInstalled && (
              <div className="pt-2">{ncaInstallBlock}</div>
            )}

            {/* Active-agent panel. When nca is the active agent and the
                binary is missing we still show the install instructions
                here so the user has a clear next step. The amber
                "needs-auth" state is handled inside the card via
                ncaApiKeyForm — not duplicated here. */}
            <div className="pt-2">
              {(activeAiAgent === 'nca' || activeAiAgent === 'mmx') ? (
                <>
                  {ncaIsNotInstalled
                    ? ncaInstallBlock
                    : ncaStatus?.authenticated === false
                    ? (
                      // The API-key form lives inside the nca card above
                      // (NCA-SETUP-UI-FIX). Without this nudge the panel
                      // rendered `null` here and a user who didn't notice
                      // the form embedded in the card had no CTA at all.
                      <p className="text-[11px] text-amber-300">
                        Enter your MiniMax API key in the nca card above to authenticate.
                      </p>
                    )
                    : (
                      <div className="space-y-3">
                        <p className="text-[11px] text-emerald-400 flex items-center gap-1">
                          <span aria-hidden>✓</span>
                          nca is authenticated and ready
                          {ncaStatus.model ? ` (${ncaStatus.model})` : ''}.
                        </p>

                        {/* NCA-INSTALL-DESIGN: model picker. Radio buttons
                            grouped by provider, populated from /api/nca/models.
                            On click, POSTs /api/nca/setup with `{model}` and
                            re-probes status — the green "ready" line above
                            then reflects the new selection. */}
                        {ncaModels && ncaModels.length > 0 && (() => {
                          const grouped = ncaModels.reduce<Record<string, NcaModel[]>>((acc, m) => {
                            (acc[m.provider] ||= []).push(m);
                            return acc;
                          }, {});
                          const providerOrder = Object.keys(grouped);
                          return (
                            <fieldset className="space-y-2">
                              <legend className="text-[10px] uppercase tracking-wider text-zinc-500">Model</legend>
                              <div className="space-y-2">
                                {providerOrder.map((provider) => (
                                  <div key={provider} className="space-y-1">
                                    <p className="text-[10px] text-zinc-500">{provider}</p>
                                    <div className="space-y-1">
                                      {grouped[provider].map((m) => {
                                        const id = `nca-model-${provider}-${m.model}`;
                                        const checked = ncaStatus.model === m.model;
                                        const saving = ncaModelSaving === m.model;
                                        return (
                                          <label
                                            key={id}
                                            htmlFor={id}
                                            className={`flex items-center gap-2 px-2 py-1 rounded text-[11px] cursor-pointer transition-colors ${
                                              checked
                                                ? 'bg-[#c5a062]/10 border border-[#c5a062]/40 text-white'
                                                : 'border border-transparent hover:border-zinc-700 text-zinc-300'
                                            } ${ncaModelSaving && !saving ? 'opacity-50 pointer-events-none' : ''}`}
                                          >
                                            <input
                                              id={id}
                                              type="radio"
                                              name="nca-model"
                                              value={m.model}
                                              checked={checked}
                                              disabled={!!ncaModelSaving}
                                              onChange={() => { void handleNcaModelSelect(m.model); }}
                                              className="accent-[#c5a062]"
                                            />
                                            <span className="font-mono">{m.model}</span>
                                            {saving && <span className="text-[10px] text-zinc-500 ml-auto">saving…</span>}
                                          </label>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </fieldset>
                          );
                        })()}

                      </div>
                    )}
                  {ncaSetupMsg && (
                    // Informational panel — the message describes a pending
                    // terminal / tmux session the user still has to act on.
                    // Body text is neutral zinc (not green) so it does not
                    // read as an authentication confirmation; the green
                    // ✓ badge above (gated on a real auth-status probe) is
                    // the only place we claim success.
                    <div className="mt-3 bg-zinc-900 border border-zinc-700 rounded-lg p-3 space-y-1">
                      <p className="text-[11px] text-amber-300 font-medium">nca setup — action required</p>
                      <pre className="text-[11px] text-zinc-300 bg-zinc-950 px-2 py-1 rounded whitespace-pre-wrap">{ncaSetupMsg}</pre>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {piStatus && !piStatus.authenticated && piStatus.installed ? (
                    <button
                      type="button"
                      onClick={handlePiSetup}
                      // CLI-SETUP-MUTEX: also disabled while nca setup is
                      // running so we don't open a second tmux session
                      // concurrently. Mirrors the nca card's setupBusy lock.
                      disabled={piBusy !== null || ncaBusy}
                      className="btn-gold-sm rounded-lg"
                    >
                      {piBusy === 'setup' ? 'Opening…' : 'Launch Pi.dev Setup'}
                    </button>
                  ) : piStatus?.authenticated ? (
                    <p className="text-[11px] text-emerald-400">pi.dev authenticated and ready.</p>
                  ) : (
                    <p className="text-[11px] text-zinc-500">
                      {piStatus && !piStatus.installed
                        ? 'pi.dev not installed — will auto-install on next check.'
                        : 'Checking pi.dev status…'}
                    </p>
                  )}
                  {piSetupMsg && (
                    <div className="mt-3 bg-zinc-900 border border-zinc-700 rounded-lg p-3 space-y-1">
                      <p className="text-[11px] text-amber-300 font-medium">Pi Setup</p>
                      <code className="block text-[11px] text-emerald-400 bg-zinc-950 px-2 py-1 rounded">
                        tmux attach -t pi-setup
                      </code>
                    </div>
                  )}
                  {piError && (
                    <p className="mt-2 text-[11px] text-red-400 whitespace-pre-wrap">{piError}</p>
                  )}
                </>
              )}
            </div>

            <p className="text-[10px] text-zinc-500 pt-2 border-t border-zinc-800/60">
              The active agent handles all AI tasks. Engine details (system prompt, niches, genres) live in the AI Engine tab.
            </p>
          </div>
          </>
          )}

          {activeTab === 'general' && (
          <>
          {/* FEAT-002b: Manage Collections (lifted out of watermark conditional) */}
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-[#c5a062]/10 rounded-lg">
                  <Folder className="w-4 h-4 text-[#c5a062]" />
                </div>
                <h4 className="text-sm font-bold text-white uppercase tracking-wider">Manage Collections</h4>
              </div>
              <button
                onClick={openCollectionModal}
                className="btn-blue-sm px-3 py-1 text-[10px] rounded-lg gap-2"
              >
                <Plus className="w-3 h-3" />
                New
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2 max-h-[200px] overflow-y-auto custom-scrollbar pr-2">
              {collections.map((col) => (
                <div key={col.id} className="group bg-zinc-900 border border-zinc-800/60 rounded-xl p-3 flex items-center justify-between hover:border-zinc-700 transition-all">
                  <div className="space-y-0.5">
                    <h5 className="text-xs font-bold text-white">{col.name}</h5>
                    <p className="text-[9px] text-zinc-600 uppercase tracking-tighter">
                      {savedImages.filter((img) => img.collectionId === col.id).length} Images
                    </p>
                  </div>
                  <button
                    onClick={() => deleteCollection(col.id)}
                    className="p-1.5 text-zinc-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                    title="Delete Collection"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {collections.length === 0 && (
                <div className="text-center py-4 border border-dashed border-zinc-800 rounded-xl">
                  <p className="text-[10px] text-zinc-500 italic">No collections created yet.</p>
                </div>
              )}
            </div>
          </div>

          {/* FEAT-002b: Channel Name (lifted out of watermark conditional) */}
          <div className="space-y-4 pt-4 border-t border-zinc-800/50">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-1.5 bg-[#c5a062]/10 rounded-lg">
                <Tag className="w-4 h-4 text-[#c5a062]" />
              </div>
              <h4 className="text-sm font-bold text-white uppercase tracking-wider">Social Media</h4>
            </div>
            <div className="space-y-2">
              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-[0.1em]">Channel Name (for Hashtags)</label>
              <input
                type="text"
                value={settings.channelName || ''}
                onChange={(e) => updateSettings({ channelName: e.target.value })}
                placeholder="e.g. MultiverseMashupAI"
                className="w-full bg-zinc-900 border border-zinc-800/60 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-[#c5a062]/30 transition-all"
              />
            </div>
          </div>

          <div className="space-y-4 pt-4 border-t border-zinc-800">
            <h4 className="text-lg font-medium text-white mb-2">Image Generation Settings</h4>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="block text-[10px] font-medium text-zinc-500 uppercase tracking-wider">Default Image Model</label>
                <select
                  value={settings.defaultLeonardoModel}
                  onChange={(e) => updateSettings({ defaultLeonardoModel: e.target.value })}
                  className="w-full bg-zinc-950 border border-zinc-800/60 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#c5a062]/30"
                >
                  {/* P3 of PROV-AGNOSTIC-PARAMS: group models by backend
                      provider so the user can see at a glance which
                      models go through Leonardo vs MiniMax's native
                      image_generation endpoint. Undefined `provider` on
                      pre-MXIMG-001 models bucketises as Leonardo. */}
                  {(() => {
                    const buckets = new Map<string, typeof LEONARDO_MODELS>();
                    for (const m of LEONARDO_MODELS) {
                      const p = m.provider ?? 'leonardo';
                      const list = buckets.get(p) ?? [];
                      list.push(m);
                      buckets.set(p, list);
                    }
                    const providerLabel = (p: string) =>
                      p === 'leonardo' ? 'Leonardo' :
                      p === 'minimax' ? 'MiniMax' :
                      p.charAt(0).toUpperCase() + p.slice(1);
                    // Stable display order: Leonardo first (historical
                    // default), then everything else alphabetical.
                    const orderedProviders = Array.from(buckets.keys()).sort((a, b) => {
                      if (a === 'leonardo') return -1;
                      if (b === 'leonardo') return 1;
                      return a.localeCompare(b);
                    });
                    return orderedProviders.map((p) => (
                      <optgroup key={p} label={providerLabel(p)}>
                        {(buckets.get(p) ?? []).map((m) => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </optgroup>
                    ));
                  })()}
                </select>
              </div>

              {/* P3 of PROV-AGNOSTIC-PARAMS: text-model picker. Only
                  visible when vercel-ai is active — pi/nca/mmx select
                  their text model server-side via subprocess flags and
                  ignore body.model from this client. An empty selection
                  means "use server default" (VERCEL_AI_MODEL env or the
                  provider-built-in fallback in resolveProvider). */}
              {activeAiAgent === 'vercel-ai' && (
                <div className="space-y-2">
                  <label className="block text-[10px] font-medium text-zinc-500 uppercase tracking-wider">Default Text Model</label>
                  <select
                    value={settings.activeTextModel ?? ''}
                    onChange={(e) => updateSettings({ activeTextModel: e.target.value || undefined })}
                    className="w-full bg-zinc-950 border border-zinc-800/60 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#c5a062]/30"
                  >
                    <option value="">— Server default —</option>
                    {(() => {
                      const buckets = new Map<string, ReturnType<typeof getAllTextModelSpecs>>();
                      for (const s of getAllTextModelSpecs()) {
                        const list = buckets.get(s.provider) ?? [];
                        list.push(s);
                        buckets.set(s.provider, list);
                      }
                      const providerLabel = (p: string) =>
                        p === 'minimax' ? 'MiniMax' :
                        p === 'openai' ? 'OpenAI' :
                        p === 'anthropic' ? 'Anthropic' :
                        p === 'openrouter' ? 'OpenRouter' :
                        p.charAt(0).toUpperCase() + p.slice(1);
                      // MiniMax-first ordering: the route's
                      // resolveProvider chain prioritises MINIMAX_API_KEY,
                      // so the picker mirrors that hierarchy.
                      const order = ['minimax', 'openai', 'anthropic', 'openrouter'];
                      return order
                        .filter((p) => buckets.has(p))
                        .map((p) => (
                          <optgroup key={p} label={providerLabel(p)}>
                            {(buckets.get(p) ?? []).map((s) => (
                              <option key={s.modelId} value={s.modelId}>{s.modelId}</option>
                            ))}
                          </optgroup>
                        ));
                    })()}
                  </select>
                </div>
              )}
            </div>
          </div>
          </>
          )}

          {activeTab === 'aiEngine' && (
          <>
          {/* AI Engine — shows whichever backend is the active agent */}
          <div className="space-y-4 pt-4 border-t border-zinc-800">
            <h4 className="text-lg font-medium text-white mb-2">
              {activeAiAgent === 'vercel-ai' ? 'Vercel.ai AI Engine' : 'Pi.dev AI Engine'}
            </h4>
            {activeAiAgent === 'vercel-ai' ? (
              <p className="text-[11px] text-zinc-500 -mt-2">
                Text AI runs through Vercel&apos;s AI gateway — no local subprocess. Model:{' '}
                <code className="text-[#00e6ff]">MiniMax-M2.7</code>.
                Provider keys are stored in <code>.env.local</code>.
              </p>
            ) : (
              <p className="text-[11px] text-zinc-500 -mt-2">
                All text AI runs through <code>pi</code> as a subprocess.
                Pick a provider + model below in <span className="text-zinc-300">Desktop Configuration</span>; API keys are stored locally in <code>config.json</code>.
              </p>
            )}

            {/* pi.dev-specific status + controls. Hidden entirely when the
                vercel-ai backend is the active agent — vercel-ai has no
                subprocess to install, start, authenticate, or surface
                errors from, so the whole sub-block is pi-only. */}
            {activeAiAgent !== 'vercel-ai' && (
              <>
            {/* Status row */}
            <div className="flex items-center gap-3">
              {(() => {
                const s = piStatus;
                let label = 'Checking…';
                let bgColor = 'bg-zinc-700';
                let textColor = 'text-white';
                let dotColor = 'bg-white/70';
                if (s) {
                  if (!s.installed) { label = 'Not Installed'; bgColor = 'bg-red-600'; }
                  else if (!s.authenticated) { label = 'Not Authenticated'; bgColor = 'bg-[#c5a062]'; textColor = 'text-[#050505]'; dotColor = 'bg-[#050505]/40'; }
                  else if (s.running) { label = 'Running'; bgColor = 'bg-[#00e6ff]'; textColor = 'text-[#050505]'; dotColor = 'bg-[#050505]/40'; }
                  else { label = 'Ready'; bgColor = 'bg-[#00e6ff]/20 border border-[#00e6ff]/30'; textColor = 'text-[#00e6ff]'; dotColor = 'bg-[#00e6ff]'; }
                }
                return (
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium ${bgColor} ${textColor}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                    {label}
                  </span>
                );
              })()}
              {piStatus?.provider && piStatus?.model && (
                <span className="text-[11px] text-zinc-400">
                  {piStatus.provider}/{piStatus.model}
                </span>
              )}
              {piStatus && piStatus.modelsAvailable > 0 && (
                <span className="text-[11px] text-zinc-500">
                  {piStatus.modelsAvailable} models available
                </span>
              )}
            </div>

            {/* Autonomous boot status — no manual install/start buttons.
                Install + start are triggered automatically on app mount
                (see piAutoBootRef effect in MainContent). The only user
                action that remains is the Sign-in button below for pi's
                auth flow, which requires interactive OAuth. */}
            <div className="flex flex-wrap gap-2 items-center">
              {piBusy === 'install' && (
                <span className="text-[11px] text-[#00e6ff]">Installing pi.dev (first launch only, ~30–60s)…</span>
              )}
              {piBusy === 'start' && (
                <span className="text-[11px] text-[#00e6ff]">Starting pi.dev…</span>
              )}
              {!piBusy && piStatus && !piStatus.installed && (
                <span className="text-[11px] text-[#c5a062]">pi.dev not installed — will auto-install on next check</span>
              )}
              {!piBusy && piStatus?.running && (
                <span className="text-[11px] text-emerald-400">pi.dev running</span>
              )}
              <button
                onClick={() => refreshPiStatus()}
                disabled={piBusy !== null}
                className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition-colors"
              >
                Refresh
              </button>
            </div>

            {piStatus && !piStatus.authenticated && piStatus.installed && (
              <button
                onClick={handlePiSetup}
                disabled={piBusy !== null}
                className="btn-gold-sm rounded-lg"
              >
                {piBusy === 'setup' ? 'Opening…' : 'Setup Pi.dev'}
              </button>
            )}

            {piSetupMsg && (
              <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 space-y-1">
                <p className="text-[11px] text-amber-300 font-medium">Pi Setup gestartet</p>
                <p className="text-[11px] text-zinc-300">
                  Terminal öffnen und verbinden:
                </p>
                <code className="block text-[11px] text-emerald-400 bg-zinc-950 px-2 py-1 rounded">
                  tmux attach -t pi-setup
                </code>
                <p className="text-[10px] text-zinc-500">
                  Pi führt dich durch Provider-Auswahl und Login. Danach &quot;Start Pi&quot; drücken.
                </p>
              </div>
            )}

            {piError && (
              <p className="text-[11px] text-red-400 whitespace-pre-wrap">
                {piError}
              </p>
            )}
              </>
            )}

            <p className="text-[10px] text-zinc-500 pt-2 border-t border-zinc-800/60">
              {activeAiAgent === 'vercel-ai'
                ? 'This prompt shapes every AI interaction across the app. Changes apply immediately.'
                : 'The AI System Prompt lives below in this same tab. Restart pi (stop + start) after changing it for the new prompt to take effect.'}
            </p>
          </div>
          </>
          )}

          {activeTab === 'general' && (
          <>
          {/* Watermark Settings */}
          <div className="mt-8 pt-6 border-t border-zinc-800">
            <h4 className="text-lg font-medium text-white mb-4">Watermark (Wasserzeichen)</h4>

            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-zinc-300">Enable Watermark</span>
              <button
                onClick={() => updateSettings({ watermark: { enabled: !settings.watermark?.enabled } as WatermarkSettings })}
                className={`w-12 h-6 rounded-full transition-colors ${settings.watermark?.enabled ? 'bg-[#00e6ff]' : 'bg-zinc-700'} relative`}
              >
                <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${settings.watermark?.enabled ? 'translate-x-6' : ''}`} />
              </button>
            </div>

            {settings.watermark?.enabled && (
              <div className="space-y-4 bg-zinc-950/50 p-4 rounded-xl border border-zinc-800/60">
                <div>
                  <label className="block text-sm text-zinc-400 mb-2">Upload Logo</label>
                  <input
                    type="file"
                    id="watermark-upload"
                    accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (event) => {
                          updateSettings({ watermark: { image: event.target?.result as string } as WatermarkSettings });
                        };
                        reader.readAsDataURL(file);
                      }
                    }}
                    className="hidden"
                  />
                  <label
                    htmlFor="watermark-upload"
                    className="flex items-center justify-center w-full py-3 px-4 rounded-xl border-2 border-dashed border-zinc-800 hover:border-[#00e6ff]/40 hover:bg-[#00e6ff]/5 transition-all cursor-pointer group"
                  >
                    <div className="flex flex-col items-center gap-1">
                      <ImageIcon className="w-5 h-5 text-zinc-500 group-hover:text-[#00e6ff]" />
                      <span className="text-xs text-zinc-500 group-hover:text-zinc-400 font-medium">
                        {settings.watermark.image ? 'Change Logo' : 'Choose File'}
                      </span>
                    </div>
                  </label>

                  {settings.watermark.image && (
                    <div className="mt-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Visual Preview</span>
                        <button
                          onClick={() => updateSettings({ watermark: { image: null } as WatermarkSettings })}
                          className="text-xs text-red-400 hover:text-red-300 transition-colors flex items-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" /> Remove
                        </button>
                      </div>

                      {/* Visual Indicator Box */}
                      <div className="relative aspect-video bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden flex items-center justify-center group">
                        <div className="absolute inset-0 opacity-20 bg-[radial-gradient(#333_1px,transparent_1px)] [background-size:16px_16px]" />
                        <span className="text-[10px] text-zinc-700 font-mono uppercase tracking-[0.2em] select-none">Image Canvas Preview</span>

                        {/* The Watermark Mockup */}
                        <div
                          className={`absolute transition-all duration-300 flex items-center justify-center`}
                          style={{
                            top: settings.watermark.position?.includes('top') ? '10%' : settings.watermark.position === 'center' ? '50%' : 'auto',
                            bottom: settings.watermark.position?.includes('bottom') ? '10%' : 'auto',
                            left: settings.watermark.position?.includes('left') ? '10%' : settings.watermark.position === 'center' ? '50%' : 'auto',
                            right: settings.watermark.position?.includes('right') ? '10%' : 'auto',
                            transform: settings.watermark.position === 'center' ? 'translate(-50%, -50%)' : 'none',
                            opacity: settings.watermark.opacity || 0.8,
                            width: `${(settings.watermark.scale || 0.15) * 100}%`,
                            aspectRatio: '1/1',
                            maxWidth: '40%',
                            maxHeight: '40%',
                          }}
                        >
                          <img
                            src={settings.watermark.image}
                            alt="Watermark preview"
                            className="absolute inset-0 w-full h-full object-contain drop-shadow-lg"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* FEAT-002b bug fix: Manage Collections + Channel Name used
                    to live HERE, nested inside the watermark.enabled wrapper —
                    so disabling the watermark made them disappear. They have
                    been lifted up to the top of the General tab. */}

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider">Position</label>
                    <select
                      value={settings.watermark.position || 'bottom-right'}
                      onChange={(e) => updateSettings({ watermark: { position: e.target.value as WatermarkSettings['position'] } as WatermarkSettings })}
                      className="w-full bg-zinc-900 border border-zinc-800/60 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#c5a062]/30 cursor-pointer"
                    >
                      <option value="bottom-right">Bottom Right</option>
                      <option value="bottom-left">Bottom Left</option>
                      <option value="top-right">Top Right</option>
                      <option value="top-left">Top Left</option>
                      <option value="center">Center</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider">Opacity</label>
                    <select
                      value={settings.watermark.opacity || 0.8}
                      onChange={(e) => updateSettings({ watermark: { opacity: parseFloat(e.target.value) } as WatermarkSettings })}
                      className="w-full bg-zinc-900 border border-zinc-800/60 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#c5a062]/30 cursor-pointer"
                    >
                      {[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0].map((val) => (
                        <option key={val} value={val}>{Math.round(val * 100)}%</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider">Size (Relative to Image)</label>
                  <select
                    value={settings.watermark.scale || 0.15}
                    onChange={(e) => updateSettings({ watermark: { scale: parseFloat(e.target.value) } as WatermarkSettings })}
                    className="w-full bg-zinc-900 border border-zinc-800/60 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#c5a062]/30 cursor-pointer"
                  >
                    {[0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5].map((val) => (
                      <option key={val} value={val}>{Math.round(val * 100)}%</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Video Generation Settings */}
          <div className="mt-8 pt-6 border-t border-zinc-800">
            <h4 className="text-lg font-medium text-white mb-4">Default Video Settings</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-zinc-950/50 p-4 rounded-xl border border-zinc-800/60">
              <div className="space-y-2">
                <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Default Duration</label>
                <select
                  value={settings.defaultAnimationDuration || 5}
                  onChange={(e) => updateSettings({ defaultAnimationDuration: Number(e.target.value) as 5 | 10 })}
                  className="w-full bg-zinc-900 border border-zinc-800/60 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#c5a062]/30 cursor-pointer"
                >
                  <option value={5}>5 Seconds</option>
                  <option value={10}>10 Seconds</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Animation Style</label>
                <select
                  value={settings.defaultAnimationStyle || 'DYNAMIC'}
                  onChange={(e) => updateSettings({ defaultAnimationStyle: e.target.value })}
                  className="w-full bg-zinc-900 border border-zinc-800/60 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#c5a062]/30 cursor-pointer"
                >
                  <option value="DYNAMIC">Dynamic</option>
                  <option value="STATIC">Static</option>
                  <option value="CINEMATIC">Cinematic</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Leonardo Video Model</label>
                <select
                  value={settings.defaultVideoModel || 'kling-3.0'}
                  onChange={(e) => updateSettings({ defaultVideoModel: e.target.value })}
                  className="w-full bg-zinc-900 border border-zinc-800/60 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#c5a062]/30 cursor-pointer"
                >
                  <option value="kling-video-o-3">Kling O3 Omni (New)</option>
                  <option value="kling-3.0">Kling 3.0 (Pro Quality)</option>
                  <option value="ray-v2">Ray V2 (High Quality)</option>
                  <option value="ray-v1">Ray V1 (Standard)</option>
                </select>
              </div>
            </div>
          </div>
          </>
          )}

          {activeTab === 'aiEngine' && (
          <>
          {/* AI System Prompt + Personality */}
          <div className="mt-8 pt-6 border-t border-zinc-800">
            <h4 className="text-lg font-medium text-white mb-4">AI System Prompt</h4>
            <div className="space-y-6 bg-zinc-950/50 p-4 rounded-xl border border-zinc-800/60">
              <div className="space-y-2">
                <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider">System Prompt</label>
                <textarea
                  value={settings.agentPrompt}
                  onChange={(e) => updateSettings({ agentPrompt: e.target.value })}
                  placeholder="Define who the AI is, how it speaks, and what it focuses on..."
                  className="w-full bg-zinc-900 border border-zinc-800/60 rounded-xl px-3 py-2 text-sm text-zinc-300 focus:outline-none focus:ring-2 focus:ring-[#c5a062]/30 min-h-[220px] resize-y leading-relaxed font-mono"
                />
                <p className="text-[10px] text-zinc-500 leading-tight">
                  {activeAiAgent === 'vercel-ai'
                    ? 'This prompt shapes every AI interaction: idea generation, prompt enhancement, captions, and parameter selection. Changes apply immediately to the active Vercel.ai backend.'
                    : 'This prompt shapes every AI interaction: idea generation, prompt enhancement, captions, and parameter selection. Applied to every pi request on top of the mode directive. Restart pi (Settings → Pi.dev AI Engine → Stop + Start) after editing.'}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider">Platform Niches</label>
                    <div className="flex flex-wrap gap-2 mb-2">
                      {settings.agentNiches?.map((n) => (
                        <span
                          key={n}
                          className="px-2 py-1 bg-[#00e6ff]/10 text-[#00e6ff] text-[10px] rounded-lg border border-[#00e6ff]/20 flex items-center gap-1 group"
                        >
                          {n}
                          <button
                            onClick={() => updateSettings({ agentNiches: settings.agentNiches?.filter((t) => t !== n) })}
                            className="text-[#00e6ff] hover:text-red-400 transition-all"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                    <input
                      type="text"
                      placeholder="Add custom niche..."
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const val = e.currentTarget.value.trim();
                          if (val && !settings.agentNiches?.includes(val)) {
                            updateSettings({ agentNiches: [...(settings.agentNiches || []), val] });
                            e.currentTarget.value = '';
                          }
                        }
                      }}
                      className="w-full bg-zinc-900 border border-zinc-800/60 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-[#00e6ff]/30"
                    />
                    <div className="pt-2">
                      <p className="text-[10px] text-zinc-500 mb-2 uppercase tracking-tight font-semibold">Recommended Niches</p>
                      <div className="flex flex-wrap gap-1.5">
                        {RECOMMENDED_NICHES.filter((n) => !settings.agentNiches?.includes(n)).map((n) => (
                          <button
                            key={n}
                            onClick={() => updateSettings({ agentNiches: [...(settings.agentNiches || []), n] })}
                            className="px-2 py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-500 hover:text-[#00e6ff] text-[9px] rounded-xl border border-zinc-800/60 transition-all flex items-center gap-1"
                          >
                            <Plus className="w-2 h-2" />
                            {n}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider">Target Genres</label>
                    <div className="flex flex-wrap gap-2 mb-2">
                      {settings.agentGenres?.map((g) => (
                        <span
                          key={g}
                          className="px-2 py-1 bg-[#00e6ff]/10 text-[#00e6ff] text-[10px] rounded-lg border border-[#00e6ff]/20 flex items-center gap-1 group"
                        >
                          {g}
                          <button
                            onClick={() => updateSettings({ agentGenres: settings.agentGenres?.filter((t) => t !== g) })}
                            className="text-[#00e6ff] hover:text-red-400 transition-all"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                    <input
                      type="text"
                      placeholder="Add custom genre..."
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const val = e.currentTarget.value.trim();
                          if (val && !settings.agentGenres?.includes(val)) {
                            updateSettings({ agentGenres: [...(settings.agentGenres || []), val] });
                            e.currentTarget.value = '';
                          }
                        }
                      }}
                      className="w-full bg-zinc-900 border border-zinc-800/60 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-[#c5a062]/30"
                    />
                    <div className="pt-2">
                      <p className="text-[10px] text-zinc-500 mb-2 uppercase tracking-tight font-semibold">Recommended Genres</p>
                      <div className="flex flex-wrap gap-1.5">
                        {RECOMMENDED_GENRES.filter((g) => !settings.agentGenres?.includes(g)).map((g) => (
                          <button
                            key={g}
                            onClick={() => updateSettings({ agentGenres: [...(settings.agentGenres || []), g] })}
                            className="px-2 py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-500 hover:text-[#00e6ff] text-[9px] rounded-xl border border-zinc-800/60 transition-all flex items-center gap-1"
                          >
                            <Plus className="w-2 h-2" />
                            {g}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Saved Personalities */}
              <div className="space-y-4 pt-4 border-t border-zinc-800/50">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider">Saved Personalities</label>
                  {personalityName === null ? (
                    <button
                      onClick={() => setPersonalityName('')}
                      className="text-[10px] text-[#00e6ff] hover:text-[#33eaff] flex items-center gap-1 transition-colors"
                    >
                      <Save className="w-3 h-3" />
                      Save Current
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <input
                        autoFocus
                        type="text"
                        value={personalityName}
                        onChange={(e) => setPersonalityName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && personalityName.trim()) {
                            updateSettings({
                              savedPersonalities: [
                                ...(settings.savedPersonalities || []),
                                {
                                  id: `p-${Date.now()}`,
                                  name: personalityName.trim(),
                                  prompt: settings.agentPrompt || '',
                                  niches: settings.agentNiches || [],
                                  genres: settings.agentGenres || [],
                                },
                              ],
                            });
                            setPersonalityName(null);
                          }
                          if (e.key === 'Escape') setPersonalityName(null);
                        }}
                        placeholder="Personality name…"
                        className="text-[10px] bg-zinc-900 border border-zinc-700 rounded px-2 py-0.5 text-zinc-200 w-28 focus:outline-none focus:ring-1 focus:ring-[#00e6ff]/40"
                      />
                      <button
                        disabled={!personalityName.trim()}
                        onClick={() => {
                          if (!personalityName.trim()) return;
                          updateSettings({
                            savedPersonalities: [
                              ...(settings.savedPersonalities || []),
                              {
                                id: `p-${Date.now()}`,
                                name: personalityName.trim(),
                                prompt: settings.agentPrompt || '',
                                niches: settings.agentNiches || [],
                                genres: settings.agentGenres || [],
                              },
                            ],
                          });
                          setPersonalityName(null);
                        }}
                        className="text-[10px] text-emerald-400 hover:text-emerald-300 disabled:opacity-40 transition-colors"
                      >
                        <Check className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => setPersonalityName(null)}
                        className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-2 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                  {settings.savedPersonalities?.map((p) => (
                    <div key={p.id} className="flex items-center justify-between bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-3 group">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-white">{p.name}</span>
                        <span className="text-[10px] text-zinc-500">{p.niches.length} Niches • {p.genres.length} Genres</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => updateSettings({
                            agentPrompt: p.prompt,
                            agentNiches: p.niches,
                            agentGenres: p.genres,
                          })}
                          className="p-2 bg-[#00e6ff]/10 text-[#00e6ff] hover:bg-[#00e6ff]/20 rounded-lg transition-all"
                          title="Load Personality"
                        >
                          <FolderOpen className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => updateSettings({
                            savedPersonalities: settings.savedPersonalities?.filter((pers) => pers.id !== p.id),
                          })}
                          className="p-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {(!settings.savedPersonalities || settings.savedPersonalities.length === 0) && (
                    <div className="text-center py-4 border border-dashed border-zinc-800 rounded-xl">
                      <p className="text-xs text-zinc-500 italic">No saved personalities yet.</p>
                    </div>
                  )}
                </div>
              </div>

              <button
                onClick={() => {
                  // V080-DES-003: build the prompt against the user's
                  // CURRENT niches/genres (or curated defaults if they
                  // have nothing selected) so Reset doesn't quietly
                  // overwrite their personalisation with a hardcoded
                  // franchise list. The runtime call sites then append
                  // the live tag list on every request.
                  const niches = (settings.agentNiches && settings.agentNiches.length > 0)
                    ? settings.agentNiches
                    : [...RECOMMENDED_NICHES];
                  const genres = (settings.agentGenres && settings.agentGenres.length > 0)
                    ? settings.agentGenres
                    : [...RECOMMENDED_GENRES];
                  updateSettings({
                    agentPrompt: buildDefaultAgentPrompt({ niches, genres }),
                    agentNiches: niches,
                    agentGenres: genres,
                  });
                }}
                className="w-full py-3 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-xl font-bold transition-all border border-zinc-800/60 flex items-center justify-center gap-2 text-[10px] uppercase tracking-widest"
              >
                <RefreshCw className="w-3 h-3" />
                Reset to Default Agent Personality
              </button>
            </div>
          </div>
          </>
          )}

          {activeTab === 'desktop' && (
            <>
              {/* Desktop configuration — DesktopSettingsPanel auto-renders
                  nothing on web builds, so a "use the desktop app" hint is
                  rendered in its place when running in the browser. */}
              <DesktopSettingsPanel />
              {isDesktop === false && (
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <Monitor className="w-4 h-4 text-zinc-500" />
                    <p className="text-xs font-semibold text-white">Desktop-only</p>
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-relaxed">
                    The desktop app stores credentials in <code className="text-zinc-300">config.json</code>, manages the pi.dev sidecar, and ships with auto-update. Run the Tauri build to access these settings.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-6 border-t border-zinc-800 bg-zinc-950/50 flex items-center justify-between gap-3">
          <span
            className="text-[10px] text-zinc-500 font-mono select-text"
            title="MashupForge app version"
          >
            v{appVersion}
          </span>
          <button
            onClick={onClose}
            className="btn-blue-sm px-6 py-2 rounded-lg"
          >
            Done
          </button>
        </div>
      </motion.div>
    </div>
  );
}
