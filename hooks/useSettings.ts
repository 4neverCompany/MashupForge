'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
// BUG-DEV-012: persistence goes through `@/lib/persistence` (tauri-plugin-
// store in production, idb-keyval fallback in dev/test). The "IDB"
// references in the comments below stay accurate as a fallback path; on
// Tauri they really hit `%APPDATA%\com.4nevercompany.mashupforge\
// mashupforge.json` and survive folder moves.
import { get, set } from '@/lib/persistence';
import { type UserSettings, defaultSettings } from '../types/mashup';
import { applyV040AutoApproveMigration } from '../lib/pipeline-daemon-utils';

// Deep-merge a loaded payload into the current settings, preserving defaults
// for any fields that are missing or explicitly undefined in the payload.
// Nested objects (watermark, apiKeys) are merged one level deep so a partial
// save doesn't clobber defaults for fields that were never written.
export function mergeSettings(prev: UserSettings, patch: Partial<UserSettings>): UserSettings {
  // Strip top-level undefined values so they don't override existing defaults.
  const clean = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  ) as Partial<UserSettings>;
  const merged = { ...prev, ...clean };
  if (clean.watermark && typeof clean.watermark === 'object') {
    merged.watermark = { ...prev.watermark, ...clean.watermark };
  }
  if (clean.apiKeys && typeof clean.apiKeys === 'object') {
    merged.apiKeys = { ...prev.apiKeys, ...clean.apiKeys };
  }
  // TODO: if UserSettings gains additional nested-object fields beyond
  // watermark and apiKeys, add explicit deep-merge cases above — otherwise
  // they will silently shallow-merge and partial saves will clobber defaults.
  return merged;
}

// FEAT-002b S1: surface IndexedDB write failures so the SettingsModal
// can render a red error pill. Previously the debounced save catch
// silently swallowed errors (`/* silent */`) — quota exhaustion or
// origin storage being disabled left users typing into a void with
// no signal that nothing was being persisted.
export type SettingsSaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  | { kind: 'error'; message: string };

// ─── Storage contract (PROP-010 / FIX-102 — closed 2026-04-22) ─────────────
//
// IDB (`mashup_settings`) is the single canonical store for UserSettings.
// localStorage is NOT a parallel store — it is a one-way crash-recovery
// buffer for the 300ms debounce window:
//
//   1. Persist  → IDB only (debounced 300ms, line 101).
//   2. Unload   → beforeunload sync-writes localStorage as a safety net
//                 in case the tab closes before the debounce fires (line 123).
//   3. Load     → if localStorage has a value (= a previous unload happened
//                 mid-debounce, OR a legacy pre-PROP-010 install), migrate
//                 it into IDB and DELETE the localStorage entry. Then the
//                 store is back to canonical-IDB-only until the next unload.
//
// Do NOT make localStorage a continuous mirror. Earlier iterations did this
// and it doubled write churn (commit e8398d6 reverted it) plus created a
// real drift risk: if IDB-write succeeds but localStorage-write fails on
// quota, the next load reads stale localStorage and overwrites IDB.
// ──────────────────────────────────────────────────────────────────────────
export function useSettings() {
  const [settings, setSettings] = useState<UserSettings>(defaultSettings);
  const [isSettingsLoaded, setIsSettingsLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SettingsSaveState>({ kind: 'idle' });
  // V1.2.1: lazy load — see useImages.ts for the full rationale. The
  // Tauri plugin-store eagerly JSON.parse's the whole mashupforge.json
  // on first get(), so even reading just `mashup_settings` blocks the
  // studio mount for 30+ seconds when the file is 100+ MB. The studio
  // renders with defaultSettings until the load fires; the MainContent
  // view-change useEffect calls `requestSettingsLoad()` immediately so
  // the user only sees a brief "default state" before their actual
  // settings hydrate. AI generations, schedules, etc. use the loaded
  // settings as soon as they arrive (the hooks re-render).
  const [loadTriggered, setLoadTriggered] = useState(false);

  // Always-current ref used by the beforeunload flush below. Mirrored
  // via useEffect so the ref is up-to-date by the time the handler
  // fires, without mutating it during render (V105.1-REACT-19).
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // PROP-010: load path. Defensive `typeof === 'object'` guard rejects any
  // corrupted/non-object value left over from the pre-fix race that could
  // have written `undefined` into the store.
  useEffect(() => {
    if (!loadTriggered) {
      // react-hooks/set-state-in-effect: deferred via queueMicrotask
      // (project convention), stale-guarded against a loadTriggered
      // flip before the microtask fires.
      let stale = false;
      queueMicrotask(() => {
        if (!stale) setIsSettingsLoaded(true);
      });
      return () => { stale = true; };
    }
    let cancelled = false;
    const loadSettings = async () => {
      try {
        const storedSettings = localStorage.getItem('mashup_settings');
        if (storedSettings) {
          // V1.2.6-HOTFIX + V1.2.8: defensive check for the
          // v1.2.5 data-loss bug. The unmount/beforeunload flush
          // on useSettings was writing a PARTIAL settings object
          // (e.g. just the defaults + a few user-touched fields)
          // to localStorage. The next page's load then either
          //   (a) clobbered the store with the partial (losing
          //       watermark/creditCap/etc. that the user had
          //       configured but weren't in the partial), or
          //   (b) the user-configured fields were preserved but
          //       the flush kept firing and re-clobbering.
          //
          // The V1.2.8 fix: ALWAYS load from the store first
          // (it has the full data), then MERGE the localStorage
          // value on top of it (localStorage is just a patch for
          // in-flight changes that didn't reach the store). This
          // way the store's authoritative state is preserved and
          // any pending localStorage edits are still applied.
          let parsed: Partial<UserSettings> | null = null;
          try {
            parsed = JSON.parse(storedSettings) as Partial<UserSettings>;
          } catch {
            // bad JSON — clear and fall through
            localStorage.removeItem('mashup_settings');
          }

          if (parsed !== null) {
            // V1.2.8: detect the v1.2.5 bug artifact BEFORE
            // clobbering. If the localStorage value is missing
            // critical user-configured fields (watermark,
            // creditCap, defaultVideoModel, etc.) that the
            // store HAS, treat localStorage as a stale partial
            // snapshot. Apply only the fields it DOES contain;
            // ignore the rest.
            const idbSettings = await get('mashup_settings');
            const idbIsObj = idbSettings && typeof idbSettings === 'object';
            if (Object.keys(parsed).length > 0) {
              // Merge into the store value. localStorage is a
              // patch; store is authoritative for absent keys.
              const storeValue = (idbIsObj ? idbSettings : {}) as Partial<UserSettings>;
              // mergeSettings expects UserSettings-shaped input;
              // pass the defaultSettings as the base so the
              // type system is happy AND the merge preserves any
              // top-level default fields the store value may have
              // omitted.
              const merged = mergeSettings(
                mergeSettings(defaultSettings, storeValue),
                parsed,
              );
              await set('mashup_settings', merged);
              localStorage.removeItem('mashup_settings');
              if (!cancelled) setSettings(prev => applyV040AutoApproveMigration(mergeSettings(prev, merged)));
            } else {
              // empty object — clear and load from store
              localStorage.removeItem('mashup_settings');
              if (idbIsObj && !cancelled) {
                setSettings(prev => applyV040AutoApproveMigration(mergeSettings(prev, idbSettings as Partial<UserSettings>)));
              } else if (!cancelled) {
                setSettings(prev => applyV040AutoApproveMigration(prev));
              }
            }
          } else {
            const idbSettings = await get('mashup_settings');
            if (idbSettings && typeof idbSettings === 'object') {
              if (!cancelled) setSettings(prev => applyV040AutoApproveMigration(mergeSettings(prev, idbSettings as Partial<UserSettings>)));
            } else {
              if (!cancelled) setSettings(prev => applyV040AutoApproveMigration(prev));
            }
          }
        } else {
          const idbSettings = await get('mashup_settings');
          if (idbSettings && typeof idbSettings === 'object') {
            if (!cancelled) setSettings(prev => applyV040AutoApproveMigration(mergeSettings(prev, idbSettings as Partial<UserSettings>)));
          } else {
            // Fresh install with no saved settings still gets the explicit
            // auto-everywhere map written so the PipelinePanel checkbox grid
            // shows the active state immediately rather than waiting for
            // the user's first toggle to materialize the field.
            if (!cancelled) setSettings(prev => applyV040AutoApproveMigration(prev));
          }
        }
      } catch {
        // silent — settings fall back to defaults
      } finally {
        if (!cancelled) setIsSettingsLoaded(true);
      }
    };
    loadSettings();
    return () => { cancelled = true; };
  }, [loadTriggered]);

  // PROP-010: persist after every committed state change, debounced 300ms.
  // Debounce prevents an IDB write on every keystroke in text fields while
  // still guaranteeing the final value is persisted. The cleanup cancels any
  // pending timer so rapid updates coalesce into a single write.
  // First post-load render is the merged-from-storage commit, not a user
  // edit — skip flagging "Saving…" for it. Subsequent renders are real
  // changes and drive the saveState lifecycle.
  const skipFirstSaveRef = useRef(true);
  useEffect(() => {
    if (!isSettingsLoaded) return;
    if (skipFirstSaveRef.current) {
      skipFirstSaveRef.current = false;
      return;
    }
    setSaveState({ kind: 'saving' });
    const timer = setTimeout(() => {
      set('mashup_settings', settings).then(
        () => setSaveState({ kind: 'saved', at: Date.now() }),
        (err) => setSaveState({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Settings save failed',
        }),
      );
    }, 300);
    // V1.2.5-HOTFIX: when the component unmounts BEFORE the 300ms
    // debounce fires, write the latest value synchronously to
    // localStorage. The next session's load path migrates
    // localStorage → IDB. Without this, "Back" / client-side
    // navigation inside the SPA loses unsaved changes because
    // `beforeunload` doesn't fire on Next.js soft route changes.
    // Hard reload still goes through `beforeunload`; this
    // cleanup covers the soft-nav case.
    return () => {
      clearTimeout(timer);
      try {
        localStorage.setItem('mashup_settings', JSON.stringify(settingsRef.current));
      } catch { /* storage quota — silent */ }
    };
  }, [settings, isSettingsLoaded]);

  // Flush-on-unload safety net for the 300ms debounce window. Writes
  // synchronously to localStorage on beforeunload; the load path already
  // migrates localStorage → IDB on next session start, so no settings
  // change is lost even if the tab closes before the debounce fires.
  // Registered once (when isSettingsLoaded flips true) via empty-ish dep
  // array — settingsRef.current always holds the latest value so the
  // listener never needs to be re-registered.
  //
  // V1.2.6-HOTFIX: gate the listener on BOTH isSettingsLoaded AND
  // loadTriggered. Without loadTriggered, the listener was active
  // before the real settings had loaded, and the beforeunload flush
  // wrote the merged-defaults state (a small object with just
  // defaults) to localStorage. The next page's load then overwrote
  // the store with that partial default object, wiping user-configured
  // settings. By requiring loadTriggered=true, we only register the
  // listener when there's actually a loaded debounce to flush.
  useEffect(() => {
    if (!isSettingsLoaded || !loadTriggered) return;
    const flush = () => {
      try {
        localStorage.setItem('mashup_settings', JSON.stringify(settingsRef.current));
      } catch { /* storage quota — silent */ }
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, [isSettingsLoaded, loadTriggered]);

  // Stable identity across renders — useState's setSettings is itself
  // stable, so this useCallback can have an empty dep array. Stable
  // updateSettings lets downstream consumers safely include it in
  // useEffect/useCallback dep arrays without triggering re-runs every
  // render. PROP-014 needed this for persistCarouselGroup.
  const updateSettings = useCallback((
    newSettings: Partial<UserSettings> | ((prev: UserSettings) => Partial<UserSettings>),
  ) => {
    setSettings((prev) => {
      const patch = typeof newSettings === 'function' ? newSettings(prev) : newSettings;
      return mergeSettings(prev, patch);
    });
  }, []);

  // V1.1.1-CAMERA-ANGLE-CLEAR: explicit key-removal path. `mergeSettings`
  // intentionally strips `undefined` patches (PROP-010 contract — a
  // partial update that explicitly says "no value" is treated as
  // "don't touch this field"), so passing `{ cameraAngle: undefined }`
  // never actually clears the field. The CameraAnglePicker passes
  // `undefined` to mean "clear"; the SettingsModal wiring translates
  // that into a `clearSettings` call which actually drops the key.
  //
  // Multiple keys can be cleared in a single call so a future "Reset
  // all advanced settings" button can use the same primitive.
  const clearSettings = useCallback((keys: (keyof UserSettings)[]) => {
    setSettings((prev) => {
      const next = { ...prev } as Record<string, unknown>;
      for (const key of keys) {
        delete next[key as string];
      }
      return next as unknown as UserSettings;
    });
  }, []);

  return { settings, updateSettings, clearSettings, isSettingsLoaded, saveState, requestLoad: () => setLoadTriggered(true) };
}
