---
id: V041-HOTFIX-3BUGS
title: V041 — Push to Studio param-suggest, auto-updater ACL, IG cred detection
status: done
date: 2026-04-18
classification: complex
relates_to: V040-HOTFIX-006, V030-008
---

# V041-HOTFIX-3BUGS — Three production bugs in one batch

## Bugs fixed

### 1. Push to Studio bypassed param-suggest

**Symptom**: clicking "To Studio" on an idea card ran a hand-rolled
prompt-enhance call (`MainContent.handlePushIdeaToCompare`) that asked
pi for a single shared aspect/style/lighting/angle/aspect-ratio
JSON blob, ignoring the per-model param-suggest engine that the manual
"Suggest Parameters" button already uses.

**Root cause**: handler was authored before `lib/param-suggest.ts`
existed and was never refactored. Two-tier divergence:
- Manual Suggest button → `suggestParametersAI` → per-model knobs +
  ranked model shortlist
- Push to Studio → legacy single-shot enhance → no model selection,
  no per-model overrides, no quality / promptEnhance

**Fix**: `components/MainContent.tsx` — handler now calls
`suggestParametersAI` with the same input as the manual button, then
applies the result automatically:
- `setComparisonModels(suggestion.modelIds)` — selects the AI's
  ranked top-N models for the user
- `setComparisonOptions(...)` — applies aspectRatio, imageSize,
  negativePrompt, style, quality, promptEnhance from the shared "best"
  view
- `setParamSuggestion(suggestion)` — surfaces the per-model card so
  the user can review / tweak each model's resolved knobs before
  generating

Per-model prompt enhancement still happens automatically via the
existing `previewTimerRef` effect when the prompt or models change.
The legacy ART_STYLES / LIGHTING_OPTIONS / CAMERA_ANGLES JSON shape is
no longer requested — those fields are absent from `ParamSuggestion`,
so they're left at whatever the user had previously set.

### 2. Auto-updater silently failing on Windows

**Symptom**: app shipped with an updater plugin and a working
`latest.json` endpoint, but the update banner never appeared after a
new release.

**Investigation** (verified by hand):
- ✅ Endpoint URL `https://github.com/4neverCompany/MashupForge/releases/latest/download/latest.json`
  resolves with HTTP 200 and returns valid manifest pointing at v0.4.1
- ✅ `UpdateChecker` component calls `check()` on mount, gated only by
  `isDesktop === true` and `UPDATE_BEHAVIOR !== 'off'`
- ✅ Plugin registered in `src-tauri/src/lib.rs:481` with
  `tauri_plugin_updater::Builder::new().build()`
- ✅ `tauri-plugin-updater = "2"` in Cargo.toml resolves to **2.10.1**
  in Cargo.lock — the version with the documented sporadic ACL bug
  (`BUG-ACL-005` references in UpdateChecker.tsx and DesktopSettingsPanel.tsx)
- ✅ Pubkey + signature both present and valid
- ✅ `updater:default` granted in capabilities/default.json

**Root cause**: tauri-plugin-updater 2.10.1 sporadically raises
`plugin:updater|check not allowed by ACL` on Windows even when
`updater:default` (which transitively grants `allow-check`) is in the
capability set. The codebase's existing comments document this as a
known plugin-side bug; the recovery path so far has been the manual
"Check Now" button in Settings.

**Fix**: `src-tauri/capabilities/default.json` — explicitly grant the
underlying permissions in addition to the default set:
```
"updater:default",
"updater:allow-check",
"updater:allow-download",
"updater:allow-download-and-install",
"updater:allow-install",
```
The default set already includes these, but the explicit entries
defeat the ACL resolver's intermittent failure to unwrap the `default`
alias. This is the canonical mitigation pattern for the bug — referenced
in the upstream issue tracker and in this codebase's own BUG-ACL-005
notes — until the plugin ships a fix.

**Caveat**: the fix lands in v0.4.2 (next release). Users running
v0.4.0 / v0.4.1 — both of which have the ACL bug live — will not
benefit until they manually install v0.4.2 (or any later release
shipping with the broader capability grant). The manual Check Now
button in Settings continues to work as the recovery path.

### 3. Pipeline didn't detect Instagram credentials saved in desktop config

**Symptom**: user saved IG creds in the Desktop tab (config.json,
env-style `INSTAGRAM_ACCESS_TOKEN` / `INSTAGRAM_ACCOUNT_ID` keys),
PipelinePanel correctly showed IG as available, but pipeline runs
logged "No platforms configured — skipped" whenever the user hadn't
explicitly toggled IG in the picker.

**Root cause**: two-layer credential storage with two different
detection logics:
- Web mode → IG creds in `settings.apiKeys.instagram` (IDB)
- Desktop mode → IG creds in `config.json` env keys, surfaced as
  presence flags via `useDesktopConfig`

`PipelinePanel.hasCreds` correctly checked both. But
`pipeline-processor.ts:121-123` derived `inferredPlatforms` via:
```ts
Object.entries(settings.apiKeys)
  .filter(([k, v]) => ['instagram', ...].includes(k) && v)
```
which (a) ignored desktop config.json entirely and (b) treated
`{ accessToken: '', igAccountId: '' }` as "configured" because the
object itself was truthy — so users could simultaneously fail to
detect real creds AND falsely detect cleared ones.

When the user hadn't manually toggled IG in the picker (the common
case after V040-HOTFIX-006 made the picker visible — picker defaults
to empty), `pipelinePlatforms` fell through to `inferredPlatforms`,
which was `[]` for desktop users → "No platforms configured".

**Fix**: extracted the credential check into a single source of truth
shared by both code paths.

#### `lib/platform-credentials.ts` (NEW)

- `isPlatformConfigured(platform, settings, desktopCreds?)` —
  per-platform field validation with desktop-flag fallback. Mirrors
  PipelinePanel's prior inline `hasCreds` switch.
- `configuredPlatforms(settings, desktopCreds?)` — returns
  `PipelinePlatform[]` filtered through `isPlatformConfigured`, in
  fixed order (instagram, pinterest, twitter, discord).
- `DesktopCredentialFlags` type now lives here; `useDesktopConfig`
  re-exports it for back-compat.

#### `components/PipelinePanel.tsx`

- Inline `hasCreds` switch → one-line delegation:
  ```ts
  const hasCreds = (p: PipelinePlatform): boolean =>
    isPlatformConfigured(p, settings, isDesktop ? desktopCreds : undefined);
  ```

#### `lib/pipeline-processor.ts`

- New `desktopCreds?: DesktopCredentialFlags` field on `ProcessIdeaDeps`
  — optional so non-desktop callers (and the existing test fixtures)
  don't need it.
- `inferredPlatforms` now calls `configuredPlatforms(settings, deps.desktopCreds)`.
  Identical answer to what PipelinePanel computes — divergence is
  structurally impossible going forward.

#### `hooks/useIdeaProcessor.ts`

- Added `useDesktopConfig` call. Threads the resolved
  `desktopCreds` into `ProcessIdeaDeps.desktopCreds` (gated on
  `isDesktop` so web-mode reports `undefined`, matching pre-fix
  inference semantics).
- `useCallback` deps updated to include `isDesktop` + `desktopCreds`.

## Tests

- NEW `tests/lib/platform-credentials.test.ts` (12 tests):
  - Per-platform truth tables — settings-only, desktop-only, both,
    partial creds (e.g. token without account ID, three of four
    Twitter OAuth1 fields).
  - Empty-string regression — `{ accessToken: '', igAccountId: '' }`
    returns false (was true under naive object-truthiness).
  - `configuredPlatforms` ordering and dedup.
- `tests/lib/pipeline-processor.test.ts` (+2 tests):
  - Desktop-creds path — instagram inferred from `desktopCreds` when
    `settings.apiKeys.instagram` is absent.
  - Empty-fields regression — `{ accessToken: '', igAccountId: '' }`
    no longer falsely included.

## Verification

- `npx tsc --noEmit` → clean
- `npx vitest run` → 30 files / 319 tests passing (was 29 / 305; net
  +1 file `platform-credentials.test.ts` with 12 tests, +2 in
  `pipeline-processor.test.ts`)

## Out of scope (deliberate)

- **Per-model option dispatch in Push to Studio.** `ParamSuggestion`
  carries a `perModel` map; the Compare tab still applies a single
  shared `comparisonOptions` object. Push to Studio surfaces the
  per-model card for review but doesn't yet thread per-model overrides
  into per-model state. Same scope boundary as `handleApplySuggestion`
  has had since V030-008.
- **Tauri updater plugin version pin.** Pinning to an older
  pre-2.10.1 release would also resolve BUG-ACL-005 but risks losing
  fixes on the install / signature-verification paths and was not
  validated. The explicit-permission workaround is the conservative
  fix.
- **Migration to consolidate web + desktop credential storage.** The
  two-layer split (IDB `apiKeys` for web, config.json env keys for
  desktop) is intentional per STORY-130 / INSTAGRAM-CRED-FIX. The
  shared helper papers over the divergence at the read site without
  changing storage.

## Files touched

- `lib/platform-credentials.ts` (NEW, ~70 lines)
- `lib/pipeline-processor.ts` (+12 lines: import + `desktopCreds` dep
  + `configuredPlatforms` swap; -3 lines: removed naive Object.entries filter)
- `hooks/useDesktopConfig.ts` (re-exports `DesktopCredentialFlags` from
  the new helper)
- `hooks/useIdeaProcessor.ts` (+5 lines: useDesktopConfig hook + dep
  threading)
- `components/PipelinePanel.tsx` (+1 / -19 lines: inline switch → helper call)
- `components/MainContent.tsx` (handlePushIdeaToCompare body replaced;
  ~40 lines changed)
- `src-tauri/capabilities/default.json` (+4 explicit updater permissions)
- `tests/lib/platform-credentials.test.ts` (NEW, 12 tests)
- `tests/lib/pipeline-processor.test.ts` (+2 tests)
- `docs/bmad/reviews/V041-HOTFIX-3BUGS.md` (this file)
