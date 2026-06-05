# QA Review Plan — Auto-Update Settings Feature

**Status:** PLAN (pre-implementation checklist)
**Agent:** QA (Quinn)
**Date:** 2026-04-27
**Waiting on:** `auto-update-backend.md` + `auto-update-design.md` stories to complete before full review

---

## Files to Review (when ready)

- `src-tauri/src/lib.rs` — updater plugin init
- `src-tauri/capabilities/default.json` — permission grants
- `src/components/Settings/AutoUpdateSettings.tsx` — UI component
- `src/store/` — settings persistence hook
- `src/app/settings/page.tsx` — settings page wiring
- `package.json` — new deps (`@tauri-apps/plugin-updater`, `@tauri-apps/plugin-dialog`)

---

## 1. Security Checks

### 1.1 Capabilities / Permissions
- [ ] `capabilities/default.json` contains exactly the required permissions — no more, no less:
  - `updater:allow-check`
  - `updater:allow-download`
  - `updater:allow-install`
  - `updater:allow-download-and-install`
- [ ] No wildcard permissions (`updater:*` or `*`) granted
- [ ] Permissions are scoped to the correct capability file (not a new blanket capability)

### 1.2 Pubkey / Signature Verification
- [ ] `tauri.conf.json` `pubkey` field is non-empty and has not been removed or blanked
- [ ] `createUpdaterArtifacts: true` remains in build config (`.sig` files must be generated)
- [ ] `dialog: false` is preserved — frontend controls update flow, not native dialog
- [ ] Update endpoint URL unchanged: `https://github.com/4neverCompany/MashupForge/releases/latest/download/latest.json`
- [ ] No hardcoded version strings or fallback URLs that bypass the signed endpoint

### 1.3 Plugin Init (Rust)
- [ ] `lib.rs` registers the updater plugin via `tauri_plugin_updater::Builder::new().build()` or equivalent — not skipped or conditional
- [ ] No `unsafe` blocks introduced in lib.rs around updater init
- [ ] Plugin is added before `.run()`, not after

### 1.4 Frontend Surface
- [ ] No updater API calls run without `await` (unhandled rejections could silently execute installs)
- [ ] No `check()` / `install()` calls reachable from unauthenticated surfaces or public routes
- [ ] Store values are read via the plugin-store API, not `localStorage` or cookies (no cross-origin leak surface)

---

## 2. UI/UX Tests

### 2.1 Toggle Rendering
- [ ] All three toggles render: **Auto-check on startup**, **Auto-download**, **Auto-install**
- [ ] Windows install mode dropdown renders with three options: `passive`, `basicUi`, `quiet`
- [ ] "Check Now" button is visible
- [ ] Default state on first install: `autoCheck: true`, `autoDownload: true`, `autoInstall: false`, `installMode: passive`

### 2.2 Toggle Behavior
- [ ] Each toggle is independently controllable (no coupled state — toggling one does not reset another)
- [ ] Auto-install toggle is **disabled / grayed** when Auto-download is off (can't install what isn't downloaded)
- [ ] Auto-download toggle is **disabled / grayed** when Auto-check is off (semantic dependency chain)
- [ ] Toggle visual state matches persisted value on re-render

### 2.3 Loading States
- [ ] "Check Now" button shows a loading spinner while `check()` is in flight
- [ ] Button is disabled during in-flight check (no double-tap)
- [ ] Status text cycles correctly: `"Checking..."` → `"Up to date"` / `"Update available: vX.Y.Z"`
- [ ] Download progress (if shown) updates incrementally, not just 0% → 100%

### 2.4 Update Available Card
- [ ] Card appears when `update !== null` after `check()`
- [ ] Card shows: version, release date, release notes (`update.body`)
- [ ] Card has a clear **Install** / **Dismiss** action
- [ ] Dismiss hides the card for the session (not permanently — next check should still show it)

---

## 3. Update Flow Tests

### 3.1 check() Path
- [ ] `check()` is called on startup only when `autoCheck === true`
- [ ] `check()` is NOT called on startup when `autoCheck === false`
- [ ] Manual "Check Now" triggers `check()` regardless of `autoCheck` setting
- [ ] `check()` errors are caught and displayed as user-visible error state (not a silent crash)

### 3.2 download() Path
- [ ] `download()` is called automatically after successful check only when `autoDownload === true`
- [ ] `download()` is not called when update is `null` (no update available)
- [ ] Download can be triggered manually from the update card when `autoDownload === false`
- [ ] Progress events from `download()` are forwarded to the UI

### 3.3 install() Path
- [ ] `install()` is called automatically after download only when `autoInstall === true`
- [ ] When `autoInstall === false`, user is prompted before install (uses `@tauri-apps/plugin-dialog confirm`)
- [ ] Windows `installMode` setting is passed to the install call (not hardcoded to `passive`)
- [ ] App restart prompt / behavior after install is correct (or documented as intentional if absent)

### 3.4 Sequencing
- [ ] `check()` must complete before `download()` starts — no race condition
- [ ] `download()` must complete before `install()` starts — no partial install
- [ ] Calling `downloadAndInstall()` (combined) is only used if separate download/install flow is not implemented; if used, confirm it respects `autoInstall: false` correctly

---

## 4. Edge Cases

### 4.1 Offline / Network Failure
- [ ] `check()` fails gracefully when offline — shows "Could not check for updates" message, does NOT crash
- [ ] App starts normally when `autoCheck: true` but network is unreachable
- [ ] Retry is not automatic (no infinite retry loop eating resources)

### 4.2 Update Check Returns No Update
- [ ] Status shows "Up to date" with last-checked timestamp
- [ ] `lastCheck` is written to store even when no update found
- [ ] No update card is shown

### 4.3 Update Check Fails (server error / malformed response)
- [ ] Error is caught and surfaced as non-blocking UI message
- [ ] Error does not leave the app in a broken state
- [ ] `lastCheck` is NOT updated on failed check (so user knows the last successful check time)

### 4.4 User Denies Install
- [ ] Dismissing the confirm dialog cancels install cleanly
- [ ] Downloaded file is not left as a zombie (or it's cleaned up on next launch)
- [ ] User can re-trigger install from the update card without re-downloading

### 4.5 Windows installMode Variations
- [ ] `passive` — silent install, app restarts automatically (default behavior)
- [ ] `basicUi` — Windows installer UI shown; confirm this doesn't cause a blank window
- [ ] `quiet` — completely silent; confirm no UAC prompt blocks on non-admin accounts
- [ ] `installMode` setting is only shown/active on Windows (hidden or disabled on macOS/Linux)

### 4.6 Concurrent Calls
- [ ] Multiple rapid "Check Now" clicks do not spawn multiple concurrent `check()` calls
- [ ] If a download is in progress and user triggers "Check Now" again, behavior is defined (block, or show progress)

---

## 5. Dark Theme

### 5.1 No Light-Theme Leaks
- [ ] All toggle switches use design-system dark variants (no `bg-white`, `bg-gray-100`, bare `border-gray-200`)
- [ ] Dropdown for installMode styled consistently with other dropdowns in the settings page
- [ ] Update available card uses dark surface tokens, not light card styles
- [ ] Loading spinner matches dark theme color palette

### 5.2 Design System Consistency
- [ ] Typography matches existing settings section headings and labels (font weight, size, color tokens)
- [ ] Toggle component reuses the existing toggle pattern (same component as other settings toggles, if one exists)
- [ ] Spacing / padding matches adjacent settings sections — no visual orphan
- [ ] Disabled state (grayed-out toggles for dependency chain) uses the design system's disabled token, not a custom opacity hack

### 5.3 Interaction States
- [ ] Focus ring visible and correct color on keyboard nav (not clipped or invisible on dark bg)
- [ ] Hover state on "Check Now" button consistent with other primary/secondary buttons in settings
- [ ] Error text (failed check) uses the design system's error color token

---

## 6. Settings Persistence

### 6.1 Store Integration
- [ ] Uses `@tauri-apps/plugin-store`, not `localStorage` or `sessionStorage`
- [ ] Store file is initialized with defaults on first launch (no undefined reads)
- [ ] Store is saved on every toggle change, not only on explicit "Save" action

### 6.2 Survive App Restart
- [ ] Toggle states match persisted values after full app quit + relaunch
- [ ] `installMode` persists across restarts
- [ ] `lastCheck` timestamp is displayed and survives restart
- [ ] New defaults do not overwrite existing saved values on app update

### 6.3 Store Errors
- [ ] If store read fails (corrupted file), app falls back to defaults gracefully — no crash
- [ ] Store write errors are caught and logged (not silently swallowed)

---

## Test Results (2026-04-27)

| Check | Result |
|---|---|
| `npm run test -- --run` | **824/824 PASS** |
| `npx tsc --noEmit` | **CLEAN** |
| Related tests | `tests/integration/desktop-update-check-acl.test.tsx` — 4 tests PASS |

Full review filed at: `docs/bmad/reviews/auto-update-qa-review.md`

---

## Gate Decision (Post-Implementation)

Will be filed to `docs/bmad/qa/auto-update-qa-review.md` after backend + design stories complete.

Expected confidence target: **0.85+** (PASS) given the well-scoped feature and existing plugin infrastructure.

Blocking criteria:
- Any permission wider than the four listed in §1.1
- Pubkey removed or bypassed
- Install triggered without user confirmation when `autoInstall: false`
- App crash on offline startup with `autoCheck: true`
- Light-theme leak in any dark-mode-only path
