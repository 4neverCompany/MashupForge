'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
// BUG-DEV-012: persistence goes through `@/lib/persistence` (tauri-plugin-
// store in production, idb-keyval fallback in dev/test). The "IDB"
// references in the comments below stay accurate as a fallback path; on
// Tauri they really hit `%APPDATA%\com.4nevercompany.mashupforge\
// mashupforge.json` and survive folder moves.
import { get, set } from '@/lib/persistence';
import { type UserSettings, type WatermarkSettings, defaultSettings } from '../types/mashup';
import { applySettingsMigrations } from '../lib/pipeline-daemon-utils';
import {
  shouldMigrateWatermark,
  migrateWatermarkToDisk,
} from '@/lib/watermarks/migrate';

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

  // V1.4.7-SETTINGS-WIPE: useSettings had the same wipe vector that PR #59
  // closed in useImages — the debounced store write (and BOTH localStorage
  // writers) were gated only on isSettingsLoaded, which the !loadTriggered
  // branch flips to true on Studio mount while `settings` is still
  // defaultSettings. Any settings commit before hydration finished then
  // persisted near-defaults over the user's stored settings, and the
  // unmount-cleanup poisoned localStorage with defaults that the next
  // load treats as "in-flight edits" and merges OVER the store (patch
  // wins) — the "watermark resets on reload" report.
  //
  //   - dirtyRef:        only updateSettings/clearSettings arm the
  //                      persist paths; hydration commits don't.
  //   - loadInFlightRef: true while the async load runs; the debounce
  //                      timer refuses to fire mid-hydration.
  //   - hydratedOnceRef: localStorage writers refuse until the real
  //                      settings have hydrated at least once — a
  //                      defaults-shaped snapshot must never become a
  //                      crash-recovery "patch".
  //   - pendingOpsRef:   mutations made before hydration are recorded
  //                      and replayed ON TOP of the hydrated state, so
  //                      neither side clobbers the other.
  const dirtyRef = useRef(false);
  const loadInFlightRef = useRef(false);
  const hydratedOnceRef = useRef(false);
  const pendingOpsRef = useRef<Array<
    | { type: 'patch'; patch: Partial<UserSettings> }
    | { type: 'clear'; keys: (keyof UserSettings)[] }
  >>([]);

  // Replay pre-hydration mutations on top of a hydrated base state.
  const replayPendingOps = useCallback((base: UserSettings): UserSettings => {
    let next = base;
    for (const op of pendingOpsRef.current) {
      if (op.type === 'patch') {
        next = mergeSettings(next, op.patch);
      } else {
        const clone = { ...next } as Record<string, unknown>;
        for (const key of op.keys) delete clone[key as string];
        next = clone as unknown as UserSettings;
      }
    }
    return next;
  }, []);

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
    // V1.4.7-SETTINGS-WIPE: close the persist gate while the real load
    // runs — isSettingsLoaded stayed true from the mount microtask
    // above, so a settings commit during the load window could persist
    // near-defaults over the store. Deliberately synchronous (the gate
    // must close in the same commit) — documented project exception,
    // same as the useImages load effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsSettingsLoaded(false);
    let cancelled = false;
    loadInFlightRef.current = true;
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
              // V1.6 marker-pair guard: if the snapshot carries
              // useDirectorPipeline but NOT directorPipelineUserSet
              // while the store HAS the marker, the snapshot's value
              // can only be a stale migration artifact — the sole
              // writer of the pair (the Settings toggle) stamps both
              // keys atomically. Without this, a one-commit-stale
              // crash-recovery snapshot could overwrite an explicit
              // Director opt-out AND inherit the store's marker,
              // durably recording a "user choice" the user never made.
              if (
                'useDirectorPipeline' in parsed
                && !('directorPipelineUserSet' in parsed)
                && storeValue.directorPipelineUserSet === true
              ) {
                delete parsed.useDirectorPipeline;
              }
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
              if (!cancelled) setSettings(prev => replayPendingOps(applySettingsMigrations(mergeSettings(prev, merged))));
            } else {
              // empty object — clear and load from store
              localStorage.removeItem('mashup_settings');
              if (idbIsObj && !cancelled) {
                setSettings(prev => replayPendingOps(applySettingsMigrations(mergeSettings(prev, idbSettings as Partial<UserSettings>))));
              } else if (!cancelled) {
                setSettings(prev => replayPendingOps(applySettingsMigrations(prev)));
              }
            }
          } else {
            const idbSettings = await get('mashup_settings');
            if (idbSettings && typeof idbSettings === 'object') {
              if (!cancelled) setSettings(prev => replayPendingOps(applySettingsMigrations(mergeSettings(prev, idbSettings as Partial<UserSettings>))));
            } else {
              if (!cancelled) setSettings(prev => replayPendingOps(applySettingsMigrations(prev)));
            }
          }
        } else {
          const idbSettings = await get('mashup_settings');
          if (idbSettings && typeof idbSettings === 'object') {
            if (!cancelled) setSettings(prev => replayPendingOps(applySettingsMigrations(mergeSettings(prev, idbSettings as Partial<UserSettings>))));
          } else {
            // Fresh install with no saved settings still gets the explicit
            // auto-everywhere map written so the PipelinePanel checkbox grid
            // shows the active state immediately rather than waiting for
            // the user's first toggle to materialize the field.
            if (!cancelled) setSettings(prev => replayPendingOps(applySettingsMigrations(prev)));
          }
        }
        // V1.6: hydratedOnceRef now means "hydration SUCCEEDED", not
        // "load attempt finished" — it only flips here, at the end of
        // the try block. After a FAILED load the state is still
        // defaults-shaped (now including Director ON), and arming the
        // persist gates would let any later edit write that payload
        // over the user's entire store — the V1.4.7 wipe family.
        hydratedOnceRef.current = true;
      } catch {
        // Failed hydration: keep the persist gates closed (debounce
        // write, cleanup snapshot, beforeunload flush all check
        // hydratedOnceRef) and surface the failure instead of
        // silently dropping every subsequent edit.
        if (!cancelled) {
          setSaveState({
            kind: 'error',
            message: 'Settings failed to load — changes are not being saved. Restart the app.',
          });
        }
      } finally {
        loadInFlightRef.current = false;
        if (!cancelled) setIsSettingsLoaded(true);
      }
    };
    loadSettings();
    return () => { cancelled = true; };
  }, [loadTriggered, replayPendingOps]);

  // V1.7.1-M3.2b-WATERMARK-DISK: once-per-session migration from the
  // legacy in-store data-URL watermark to a disk-backed file. Mirrors
  // the M3.2 (PR #77) once-per-session image-slim pattern. Gated on
  // hydration success + Tauri runtime + a `migratedFlags` marker so
  // the migration runs at most once per store.
  //
  // The migration is best-effort: a failed disk write leaves the
  // legacy data-URL alone and the user's watermark keeps working.
  // On success, we patch `settings.watermark` in place via the
  // normal `setSettings` path, which schedules a 300ms-debounced
  // persist — same plumbing every other edit uses.
  useEffect(() => {
    if (!isSettingsLoaded) return;
    if (!hydratedOnceRef.current) return;
    if (typeof window === 'undefined') return;
    const tauriInternals = (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    const tauriLegacy = (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    const isTauri = !!(tauriInternals || tauriLegacy);
    if (!isTauri) return;
    // Snapshot current settings via the ref so the migration effect
    // doesn't need to depend on the full settings object (which
    // would re-fire on every edit and re-run the migration guard).
    const current = settingsRef.current;
    if (!shouldMigrateWatermark(current, isTauri)) return;
    let cancelled = false;
    (async () => {
      const patch = await migrateWatermarkToDisk(current);
      if (cancelled || !patch || !patch.watermark) return;
      // V1.8.1: arm the persist gate. The migration patches settings via
      // setSettings below, but the 300ms-debounced store-write refuses
      // unless dirtyRef is set (only updateSettings/clearSettings arm it
      // — see the gate at the persist effect). Without this, the slim
      // {imageRef + asset URL} record stays in memory only: the store
      // KEEPS the ~10.7MB data-URL across sessions and this migration
      // re-runs every launch — defeating M3.2b's entire purpose (shrink
      // the store). Arming dirtyRef makes the slimmed watermark persist
      // exactly once, like every other settings edit.
      dirtyRef.current = true;
      // The spread of `patch.watermark` is `Partial<WatermarkSettings>`
      // (imageRef is optional), and merging it with `prev.watermark`
      // can leave every field as `... | undefined`. The setState
      // callback has to return the strict `UserSettings` shape, so
      // build it with explicit required-field defaults from `prev`.
      setSettings((prev) => {
        const prevWm: WatermarkSettings = prev.watermark ?? {
          enabled: false,
          image: null,
          position: 'bottom-right',
          opacity: 0.8,
          scale: 0.15,
        };
        const merged: WatermarkSettings = {
          enabled: patch.watermark!.enabled ?? prevWm.enabled,
          image: patch.watermark!.image ?? prevWm.image,
          position: patch.watermark!.position ?? prevWm.position,
          opacity: patch.watermark!.opacity ?? prevWm.opacity,
          scale: patch.watermark!.scale ?? prevWm.scale,
          imageRef: patch.watermark!.imageRef ?? prevWm.imageRef,
        };
        return { ...prev, watermark: merged };
      });
    })();
    return () => { cancelled = true; };
  }, [isSettingsLoaded]);

  // PROP-010: persist after every committed state change, debounced 300ms.
  // Debounce prevents an IDB write on every keystroke in text fields while
  // still guaranteeing the final value is persisted. The cleanup cancels any
  // pending timer so rapid updates coalesce into a single write.
  //
  // V1.4.7-SETTINGS-WIPE: gated on loadTriggered + isSettingsLoaded +
  // dirtyRef (real user edit pending). Hydration commits don't arm it,
  // so the (former) skipFirstSaveRef "skip the post-load echo" hack is
  // no longer needed — any run of this effect IS a pending save.
  useEffect(() => {
    if (!loadTriggered || !isSettingsLoaded) return;
    if (!dirtyRef.current) return;
    setSaveState({ kind: 'saving' });
    const timer = setTimeout(() => {
      // Belt-and-suspenders: refuse to fire mid-hydration regardless
      // of React's effect/cleanup ordering.
      if (loadInFlightRef.current) return;
      if (!hydratedOnceRef.current) {
        // Load finished but hydration FAILED (V1.6): don't leave the
        // user staring at a perpetual "saving…" pill — say why.
        setSaveState({
          kind: 'error',
          message: 'Settings failed to load — changes are not being saved. Restart the app.',
        });
        return;
      }
      set('mashup_settings', settings).then(
        () => {
          // V1.6: the canonical write supersedes any crash-recovery
          // snapshot the debounce-cleanup wrote earlier. Remove it so
          // a stale (one-commit-old) snapshot can never outrank this
          // state as an "in-flight patch" on the next load — the
          // mechanism that could resurrect a migration-fabricated
          // Director=true over a just-persisted explicit opt-out.
          try { localStorage.removeItem('mashup_settings'); } catch { /* ignore */ }
          setSaveState({ kind: 'saved', at: Date.now() });
        },
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
    //
    // V1.4.7-SETTINGS-WIPE: only once hydrated. Before hydration,
    // settingsRef.current is defaults-shaped; writing it here poisoned
    // localStorage, and the next load's merge let that snapshot WIN
    // over the store (patch semantics) — the "watermark resets on
    // reload" bug.
    return () => {
      clearTimeout(timer);
      if (!hydratedOnceRef.current || loadInFlightRef.current) return;
      try {
        localStorage.setItem('mashup_settings', JSON.stringify(settingsRef.current));
      } catch { /* storage quota — silent */ }
    };
  }, [settings, isSettingsLoaded, loadTriggered]);

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
      // V1.4.7-SETTINGS-WIPE: only flush a REAL pending edit of the
      // hydrated state. A defaults-shaped snapshot (pre-hydration) or
      // a no-edit session must never land in localStorage — the next
      // load treats localStorage as an in-flight patch that outranks
      // the store.
      if (!dirtyRef.current || !hydratedOnceRef.current) return;
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
      // V1.4.7-SETTINGS-WIPE: record pre-hydration edits so the load
      // path can replay them ON TOP of the hydrated state (instead of
      // the hydration commit silently reverting them). Recording the
      // RESOLVED patch is idempotent under StrictMode double-invoke.
      if (!hydratedOnceRef.current) {
        pendingOpsRef.current.push({ type: 'patch', patch });
      }
      return mergeSettings(prev, patch);
    });
    // A real user edit: arm the persist paths and make sure the store
    // hydrates NOW so the eventual write contains the full settings,
    // not defaults + this one field.
    dirtyRef.current = true;
    setLoadTriggered(true);
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
      // V1.4.7-SETTINGS-WIPE: see updateSettings — replayed after
      // hydration so the cleared key stays cleared.
      if (!hydratedOnceRef.current) {
        pendingOpsRef.current.push({ type: 'clear', keys });
      }
      const next = { ...prev } as Record<string, unknown>;
      for (const key of keys) {
        delete next[key as string];
      }
      return next as unknown as UserSettings;
    });
    dirtyRef.current = true;
    setLoadTriggered(true);
  }, []);

  return { settings, updateSettings, clearSettings, isSettingsLoaded, saveState, requestLoad: () => setLoadTriggered(true) };
}
