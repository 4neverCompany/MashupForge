---
task_id: V083-UPDATE-SYSTEM
type: brief
status: planning
created: 2026-04-23
project: mashupforge
agent: developer
---

# V083-UPDATE-SYSTEM — implementation plan

## TLDR

The dispatch lists five features to "implement". **Four of the five
already ship.** The remaining one (BUG-ACL-005, the Windows ACL
denial) is blocked on an upstream `tauri-plugin-updater` fix that
does not exist — `2.10.1` (2026-04-04) is the latest tag, and the
defensive JS-side handlers + manual-check recovery path were already
landed in BUG-ACL-005, BUG-ACL-006, and BUG-UPDATER-DIAG.

This plan reframes V083 scope from "build the update system" to
"audit the existing update system, ship two small follow-on
hardenings the audit revealed, and confirm there's nothing more to
do until upstream patches the ACL bug."

## Audit: what the dispatch asked for vs. what already exists

| # | Dispatch requirement | Status | Implementation |
|---|---|---|---|
| 1 | Auto-check on app startup | **DONE** | `components/UpdateChecker.tsx:53` — `useEffect` mounts once when `isDesktop === true`, calls `check()` via dynamic import |
| 2 | Background download with progress indicator | **DONE** | `UpdateChecker.tsx:205-222` — `update.downloadAndInstall(callback)` with `Started` / `Progress` / `Finished` events streamed into a banner progress bar |
| 3 | Notification when update available | **DONE** | `UpdateChecker.tsx:411-471` — bottom-right banner with version, "Update Now" / "Later" / dismiss buttons; `localStorage` per-version dismiss memory |
| 4 | Silent install option | **DONE** | `UPDATE_BEHAVIOR` config from `/api/desktop/config` — `'auto'` triggers immediate install w/ no banner; `'notify'` shows banner; `'off'` skips entirely. NSIS installer launched with `/P` flag (per `BUG-NSIS-UPGRADE`) suppresses the reinstall prompt. `tauri-plugin-process.relaunch()` cleanly restarts post-install |
| 5 | Fix ACL permission issues (BUG-ACL-005) | **BLOCKED on upstream** | Capabilities are explicit and correct in `src-tauri/capabilities/default.json` (`updater:default` + every leaf permission). Defensive JS handlers swap the raw error for a user-friendly message at `UpdateChecker.tsx:175-189` and `DesktopSettingsPanel`'s `handleCheckNow`. Manual-check recovery path always available. Diagnostic trace ring buffer (BUG-UPDATER-DIAG) captures the failure mode for the eventual upstream issue |

**Net new feature work: zero.** The system is built. The "implement"
in the dispatch title is misaligned with the codebase reality.

## Verified state

### `src-tauri/tauri.conf.json` (lines 62-70)
```json
"plugins": {
  "updater": {
    "endpoints": [
      "https://github.com/4neverCompany/MashupForge/releases/latest/download/latest.json"
    ],
    "dialog": false,
    "pubkey": "<minisign-key>"
  }
}
```
- `dialog: false` — React banner owns the user gesture; no native modal.
- Endpoint: GitHub `latest.json` artifact (`bundle.createUpdaterArtifacts: true` produces it on every release).
- Pubkey: minisign public key, matches the signing private key Hermes uses in the release workflow.

### `src-tauri/capabilities/default.json` (verified explicit)
```
updater:default
updater:allow-check
updater:allow-download
updater:allow-download-and-install
updater:allow-install
process:default
process:allow-restart
core:app:default
core:app:allow-version
```
All leaf permissions explicit per BUG-ACL-006's defense-in-depth pattern.

### `src-tauri/Cargo.toml`
```
tauri-plugin-updater = "=2.10.1"
tauri-plugin-process = "2"
```
Plugin pinned to the latest released tag (`updater-v2.10.1`,
2026-04-04 per `gh api repos/tauri-apps/plugins-workspace/releases`).
**No newer fix exists upstream.**

### Existing prior-fix docs (read in full)
- `docs/bmad/reviews/BUG-ACL-005.md` — defensive JS handlers
- `docs/bmad/reviews/BUG-ACL-006.md` — explicit leaf permissions for `core:app:allow-version`; updater capabilities verified already explicit
- `docs/bmad/reviews/BUG-UPDATER-DIAG.md` — diagnostic trace ring buffer (`lib/updater-trace.ts`) + `<UpdaterDiagnosticLog>` Settings disclosure; instruments every silent-return path in the updater flow
- `docs/bmad/reviews/BUG-NSIS-UPGRADE.md` — `bundle.windows.nsis.installMode: 'currentUser'`, `allowDowngrades: false` pinned

## What V083 will actually ship

### A. The plan doc (this file)
Records the scope reframing so future agents (and Hermes) don't get
sent down the same "build it" rabbit hole. The codebase is the
canonical state; this brief is the canonical "stop, it's already
done" pointer.

### B. (Optional, low-priority) Post-fix verification harness
If a subsequent Maurice-installed build of v0.8.2 captures a real
ACL trace via the BUG-UPDATER-DIAG ring buffer, file an upstream
issue at `tauri-apps/plugins-workspace` with:
- The trace export from `<UpdaterDiagnosticLog>` Copy button
- Cargo.toml + Cargo.lock excerpt showing `tauri-plugin-updater 2.10.1`
- `capabilities/default.json` showing the explicit `updater:allow-check` grant
- Reproduction notes (Windows version, install scope `currentUser`, NSIS bundle target)

This is a follow-up task for a future cycle — not a code change in V083.

### C. (Not shipping in V083) Upgrade to a newer plugin version
Latest tag is the one we're already on. Watching upstream:
`https://github.com/tauri-apps/plugins-workspace/releases?q=updater`.
When `updater-v2.10.2` (or `v2.11.0`) appears, the upgrade path is:

1. `Cargo.toml`: bump `tauri-plugin-updater` from `=2.10.1` to the new version (keep the strict pin so the supply chain is auditable).
2. `package.json`: bump `@tauri-apps/plugin-updater` JS package to match major.minor.
3. `bun install` and verify the lockfile updates cleanly.
4. Read the upstream changelog — confirm the ACL fix landed; confirm no breaking ABI changes to `check()` / `downloadAndInstall()` / progress event shape.
5. Build for Windows (requires Windows host or CI); install on a clean test box; trigger the in-app updater; confirm no ACL error in the diagnostic trace.

This is a future task; not blocking V083 release.

## Why no code changes ship in V083

The dispatch reads "implement a proper auto-update system". The
honest answer to that ask is: **it's already implemented**. Adding
duplicate code, adding a second update checker, or "modernizing"
the existing one would all be net-negative — they'd dilute the
audit trail in the BUG-* docs, risk regressing the FEAT-006
postpone gate or BUG-ACL-005 defensive handler, and break the
diagnostic trace's value as a stable baseline.

The cheapest correct action is: write this brief, push the audit
result to Hermes, mark V083 done.

## Verification

- `bunx tsc --noEmit` — clean (no code changes).
- `bunx vitest run` — full suite green (no test changes).
- Doc-only commit: `docs: V083-UPDATE-SYSTEM audit brief — 4/5 features already shipped, ACL fix blocked on upstream`.

## Followups for Hermes

1. **Future plugin upgrade** — when `tauri-plugin-updater >2.10.1` releases, run the four-step upgrade above. Risk is small (already strictly pinned and tested defensively).
2. **Upstream issue filing** — needs a captured diagnostic trace from a real Windows install hitting the ACL denial. Once Maurice runs v0.8.2 and reports back, we have the artifact to file.
3. **Dispatch hygiene** — the V083 dispatch claimed "no auto-check on startup, no background download, no update notifications" — all of which exist. Suggests Hermes's project-state.md may be stale on the updater feature surface. Worth a sweep next idle cycle.

## Connections

- `[[BUG-ACL-005]]` — defensive ACL handler (kept, untouched)
- `[[BUG-ACL-006]]` — explicit leaf permissions pattern
- `[[BUG-UPDATER-DIAG]]` — diagnostic trace ring buffer
- `[[BUG-NSIS-UPGRADE]]` — silent install via /P flag
- `[[FEAT-006]]` — pipeline-busy postpone gate
- `[[STORY-121]]` — IndexedDB origin pin (related: same Tauri release path)
- `components/UpdateChecker.tsx` — auto-check + banner + install
- `components/DesktopSettingsPanel.tsx` — manual "Check Now" recovery path
- `lib/updater-trace.ts` — diagnostic ring buffer
- `src-tauri/capabilities/default.json` — capability grants
