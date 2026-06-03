'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { MashupProvider, useMashup } from './MashupContext';
import { ErrorBoundary } from './ErrorBoundary';
import { DesktopLoadingScreen } from './DesktopLoadingScreen';
import { PipelineResumePrompt } from './PipelineResumePrompt';
import { OnboardingWizard } from './onboarding/OnboardingWizard';
import { SetupUnfinishedPill } from './onboarding/SetupUnfinishedPill';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

const Sidebar = dynamic(
  () => import('./Sidebar').then((m) => m.Sidebar),
  { ssr: false },
);

const MainContent = dynamic(
  () => import('./MainContent').then((m) => m.MainContent),
  { ssr: false },
);

// FEAT-MMX-MUSIC-UI: floating Music + Video action group. Hides itself
// when the mmx CLI is unavailable on the server.
const MmxStudioPanel = dynamic(
  () => import('./mmx/MmxStudioPanel').then((m) => m.MmxStudioPanel),
  { ssr: false },
);

/** V050-DES-002 — first-run + pill state machine.
 *  Reads localStorage flags only (schema field is PROP). */
type OnboardingState =
  | { kind: 'loading' }
  | { kind: 'show-wizard'; initialStep: 1 | 2 | 3 }
  | { kind: 'show-pill'; lastCompletedStep: number }
  | { kind: 'hidden' };

function useOnboardingState(): [OnboardingState, (s: OnboardingState) => void] {
  const [state, setState] = useState<OnboardingState>({ kind: 'loading' });

  // V105.1-REACT-19: setState calls are deferred via queueMicrotask
  // (project convention) so the effect body only reads localStorage,
  // not local state in the body itself.
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const completed = localStorage.getItem('mashup.onboarded') === '1';
        if (completed) { setState({ kind: 'hidden' }); return; }

        const dismissed = localStorage.getItem('mashup.onboardingDismissedAt');
        if (dismissed) { setState({ kind: 'hidden' }); return; }

        const skippedAt = localStorage.getItem('mashup.onboardingSkippedAt');
        const progressRaw = localStorage.getItem('mashup.onboardingProgress');
        const progress = progressRaw ? JSON.parse(progressRaw) as { step?: 1 | 2 | 3; lastCompleted?: number } : null;

        if (skippedAt) {
          setState({ kind: 'show-pill', lastCompletedStep: progress?.lastCompleted ?? 0 });
        } else {
          setState({ kind: 'show-wizard', initialStep: progress?.step ?? 1 });
        }
      } catch {
        setState({ kind: 'show-wizard', initialStep: 1 });
      }
    });
  }, []);

  return [state, setState];
}

// FEAT-TRAY-AUTOSTART (2026-05-20): on first ever launch inside the
// Tauri desktop shell, enable OS-level autostart so the user gets the
// "background-poster" behavior by default. Subsequent launches respect
// whatever the user set in Settings → Auto-Start. The localStorage flag
// is the one-shot gate — never re-runs once flipped.
function useFirstLaunchAutostart() {
  useEffect(() => {
    const isTauri = typeof window !== 'undefined'
      && typeof (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined';
    if (!isTauri) return;

    const FLAG = 'mashup.autostartFirstRunDone';
    try {
      if (localStorage.getItem(FLAG) === '1') return;
    } catch {
      return; // private mode → don't risk re-enabling on every launch
    }

    void (async () => {
      try {
        const mod = await import('@tauri-apps/plugin-autostart');
        const already = await mod.isEnabled();
        if (!already) await mod.enable();
        localStorage.setItem(FLAG, '1');
      } catch {
        // Silent — Settings → Auto-Start is the manual fallback. We
        // intentionally don't set the flag on failure so a retry can
        // happen on next launch.
      }
    })();
  }, []);
}

function MashupApp() {
  const { isLoaded } = useMashup();
  const { isAuthenticated } = useAuth();
  const [onboarding, setOnboarding] = useOnboardingState();
  useFirstLaunchAutostart();

  if (isAuthenticated === null || !isLoaded) {
    return <DesktopLoadingScreen />;
  }

  if (isAuthenticated === false) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#050505]">
        <div className="flex flex-col items-center gap-5 text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#c5a062]/10 border border-[#c5a062]/30 flex items-center justify-center">
            <ShieldAlert className="w-8 h-8 text-[#c5a062]" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white mb-1">Access Restricted</h2>
            <p className="text-zinc-500 text-sm">Please log in to access MashupForge.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-950">
      <ErrorBoundary section="Sidebar">
        <Sidebar />
      </ErrorBoundary>
      <ErrorBoundary section="MainContent">
        <MainContent />
      </ErrorBoundary>
      <ErrorBoundary section="MmxStudioPanel">
        <MmxStudioPanel />
      </ErrorBoundary>
      <PipelineResumePrompt />

      {onboarding.kind === 'show-wizard' && (
        <OnboardingWizard
          initialStep={onboarding.initialStep}
          onComplete={() => setOnboarding({ kind: 'hidden' })}
          onSkip={(lastCompletedStep) => setOnboarding({ kind: 'show-pill', lastCompletedStep })}
        />
      )}

      {onboarding.kind === 'show-pill' && (
        <SetupUnfinishedPill
          lastCompletedStep={onboarding.lastCompletedStep}
          onResume={() => {
            try {
              const raw = localStorage.getItem('mashup.onboardingProgress');
              const progress = raw ? JSON.parse(raw) as { step?: 1 | 2 | 3 } : null;
              const initialStep = (progress?.step ?? Math.min(3, onboarding.lastCompletedStep + 1)) as 1 | 2 | 3;
              localStorage.removeItem('mashup.onboardingSkippedAt');
              setOnboarding({ kind: 'show-wizard', initialStep });
            } catch {
              setOnboarding({ kind: 'show-wizard', initialStep: 1 });
            }
          }}
          onDismissForever={() => {
            try { localStorage.setItem('mashup.onboardingDismissedAt', String(Date.now())); } catch { /* silent */ }
            setOnboarding({ kind: 'hidden' });
          }}
        />
      )}
    </div>
  );
}

export function MashupStudio() {
  return (
    <ErrorBoundary section="App" fullScreen>
      <MashupProvider>
        <MashupApp />
      </MashupProvider>
    </ErrorBoundary>
  );
}
