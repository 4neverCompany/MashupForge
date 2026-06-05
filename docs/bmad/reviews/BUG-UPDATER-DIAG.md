# BUG-UPDATER-DIAG — in-app updater never appears (diagnostic instrumentation)

**Status:** done (instrumentation only — root cause likely "no newer version exists")
**Classification:** complex (touches updater flow + user-visible Settings panel)
**Severity:** high (Maurice cannot self-diagnose updater failures in production)

## Bug

Maurice reports the in-app updater "never works" — meaning the
update banner has never appeared for him. Asked to investigate
end-to-end and add `console.log` at every step.

## End-to-end audit

### 1. Does `UpdateChecker` actually call `check()`?

Yes — `components/UpdateChecker.tsx:104-106` calls
`updaterMod.check()` inside the `useEffect` that fires once per mount
when `isDesktop === true`. **But there are FIVE silent-return paths
upstream of `check()`** that would prevent the call from happening
or its result from rendering, all of them with no logging pre-fix:

| # | Path | Trigger | Visibility pre-fix |
|---|---|---|---|
| 1 | `if (isDesktop !== true) return;` | Web mode or `useDesktopConfig` not yet resolved | None |
| 2 | `if (ranRef.current) return;` | Effect re-fired (StrictMode double-mount) | None |
| 3 | `if (behavior === 'off') return;` | User disabled updates in Settings | None |
| 4 | `if (!update?.available \|\| cancelled) return;` | **Already on latest version** | None |
| 5 | `if (localStorage.getItem(DISMISS_KEY(update.version)) === '1') return;` | Already dismissed this version | None |
| 6 | `import('@tauri-apps/plugin-updater')` rejection | Plugin missing / bundling broke | Untested before fix |

### 2. Does `check()` return an update object?

For Maurice, **almost certainly returns `{ available: false }`** —
the GitHub `latest.json` endpoint reports v0.5.2, and Maurice has
been releasing v0.3.0 → v0.5.2 over the last day. Every test he ran,
he was already on the latest version. The plugin correctly reports
`available: false`, code path 4 above silently returns, no banner.

Verified the endpoint is reachable and well-formed:

```bash
$ curl -sL https://github.com/4neverCompany/MashupForge/releases/latest/download/latest.json
{
  "version": "0.5.2",
  "notes": "",
  "pub_date": "2026-04-19T07:57:42Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkK...",
      "url": "https://github.com/4neverCompany/MashupForge/releases/download/v0.5.2/MashupForge_0.5.2_x64-setup.exe"
    }
  }
}
```

Endpoint resolves (HTTP 302 → release asset), JSON parses, signature
present, URL matches the installer. **The updater backend is not
broken — it correctly says "no update available" for v0.5.2 users.**

### 3. Is the endpoint reachable?

Yes. Verified above.

### 4. Does `downloadAndInstall` work?

Cannot verify without an older client + a newer release. The code
path is intact:
- `components/UpdateChecker.tsx:158-172` — `update.downloadAndInstall(callback)`
- `components/UpdateChecker.tsx:181-182` — `processMod.relaunch()` after install
- The relaunch is documented (BUG-002): `tauri-plugin-process` fires
  `WindowEvent::CloseRequested` → kills sidecar → frees port 19782 →
  Tauri spawns the freshly installed binary.
- Job Object kill-on-close (BUG-003) is the OS-level fallback.

### 5. Is the ACL still blocking?

Capabilities are correctly granted in
`src-tauri/capabilities/default.json`:

```json
"updater:default",
"updater:allow-check",
"updater:allow-download",
"updater:allow-download-and-install",
"updater:allow-install",
"process:default",
"process:allow-restart"
```

The defensive ACL handler (BUG-ACL-005) is still in place at
`UpdateChecker.tsx:124-145` and `DesktopSettingsPanel.tsx:310-330`
— logs to `console.warn` with a distinct prefix and surfaces a
friendly message instead of the raw ACL error. If Maurice was
hitting BUG-ACL-005 he'd see "Auto-update check unavailable" in the
manual Settings panel — he hasn't reported that, which is more
evidence the issue is "no update available."

## Most likely root cause

**Maurice has been running the latest published version every time
he tested.** `check()` correctly returns `{ available: false }`,
the auto-effect silently returns at path #4, and the manual button
shows "You're on the latest version." Both behaviors are correct;
the absence of a banner is not a bug — it's the system working.

Confirming this requires running an older version (e.g. install
v0.5.0 from a prior release asset) and verifying the v0.5.2 banner
appears.

## Fix shipped (instrumentation, not a behavior change)

### `lib/updater-trace.ts` (new)

A tiny trace helper:
- `traceUpdater(step, data?)` — `console.log` AND push to
  `localStorage['mashup_updater_trace']` ring buffer (max 50 entries).
- `getUpdaterTrace()` / `clearUpdaterTrace()` / `formatTraceEntry(e)`
  — read/clear/format helpers consumed by the diagnostic panel.

The localStorage mirror is the critical piece: production Tauri
release builds run with `windows_subsystem = "windows"` and devtools
disabled, so `console.log` is invisible. The localStorage buffer is
inspectable from the Settings panel without any tooling.

### `components/UpdateChecker.tsx`

`traceUpdater` calls added at every meaningful branch:

- `mount-effect` — entry, with current `isDesktop` value.
- `exit:not-desktop` — early return when `isDesktop !== true`.
- `exit:already-ran` — early return on re-mount.
- `run:start` — async runner entered.
- `run:got-current-version` / `run:getVersion-failed` — `app.getVersion()` outcome.
- `run:resolved-behavior` / `run:config-fetch-failed` — `/api/desktop/config` outcome.
- `exit:behavior-off` — early return when user disabled updates.
- `run:importing-updater-plugin` — dynamic import about to start.
- `run:calling-check` — `check()` about to fire.
- `run:check-returned` — `available`, `remoteVersion`, `currentVersion` payload.
- `exit:no-update-or-cancelled` — **the most likely path Maurice hits**.
- `exit:version-dismissed` — user previously dismissed this version.
- `run:setting-available-state` — banner is about to render.
- `exit:check-threw` — `check()` rejected (ACL or network).
- `install:start` / `install:download-started` / `install:event` /
  `install:downloadAndInstall-resolved` / `install:calling-relaunch` /
  `install:failed` — full install flow.

### `components/DesktopSettingsPanel.tsx`

- `traceUpdater` calls added to `handleCheckNow` (manual check) +
  the `installRef.current` install closure: `manual:check-clicked`,
  `manual:importing-updater-plugin`, `manual:calling-check`,
  `manual:check-returned`, `manual:no-update-available`,
  `manual:install-clicked`, `manual:download-started`,
  `manual:install-event`, `manual:check-threw`.
- New `<UpdaterDiagnosticLog />` `<details>` disclosure inside the
  Updates section, below the result row. Three buttons: Refresh,
  Copy (clipboard), Clear. Renders the trace as a `<pre>` so Maurice
  can paste it into a bug report. Closed by default (no UI clutter
  for users who aren't debugging).

## Files touched

### Production
- `lib/updater-trace.ts` — new helper (~70 LOC, no deps).
- `components/UpdateChecker.tsx` — 13 `traceUpdater` calls inserted
  at every branch + import. No behavior change.
- `components/DesktopSettingsPanel.tsx` — 9 `traceUpdater` calls in
  manual flow + new `<UpdaterDiagnosticLog>` component.

### Docs
- `docs/bmad/reviews/BUG-UPDATER-DIAG.md` (this file).

## Verification

- `npx tsc --noEmit` clean.
- Pre-commit (`tsc --noEmit && vitest run`) green.
- Cannot test the trace end-to-end from Linux WSL — needs a Windows
  build. Once Maurice runs the next .exe, the diagnostic log
  disclosure in Settings → Updates will show the live trace.

## Recommended next step for Maurice

1. Build v0.5.3 (or any new version).
2. Install v0.5.0 or v0.5.1 from a prior release asset on the test box.
3. Launch the older version. Open Settings → Updates → Diagnostic log.
4. The trace should show:
   - `mount-effect { isDesktop: true }`
   - `run:start`
   - `run:got-current-version { currentVersion: "0.5.0" }`
   - `run:resolved-behavior { behavior: "notify" }`
   - `run:calling-check`
   - `run:check-returned { available: true, remoteVersion: "0.5.3", currentVersion: "0.5.0" }`
   - `run:setting-available-state`
   - Banner appears in bottom-right.
5. If `run:check-returned` shows `available: false` despite older
   client → manifest serving wrong version (CDN cache).
6. If `exit:check-threw` with ACL message → BUG-ACL-005 reproduces.
7. If trace stops at `mount-effect { isDesktop: false }` → the
   `/api/desktop/config` endpoint is misreporting (sidecar issue).

## Out of scope (follow-up)

- **Devtools in release builds.** Currently disabled by Tauri
  default. Could be enabled behind a hidden setting, but the
  localStorage trace + Settings panel disclosure shipped here
  obviates the need.
- **Auto-rotate trace.** 50 entries is enough for one debug session;
  if Maurice ever fills it routinely, bump the cap or rotate by date.
- **`/api/desktop/log` endpoint.** Could mirror the trace to
  `tauri.log` so it survives a localStorage clear. Not needed yet —
  the in-app disclosure is sufficient.

## Hermes inbox envelope

```
{"from":"developer","task":"BUG-UPDATER-DIAG","status":"done","summary":"End-to-end audit shipped + diagnostic instrumentation. Most likely root cause: Maurice was always running the latest version when testing, so updaterMod.check() correctly returns {available:false}, code silently returns at the !update?.available guard (one of FIVE silent-return paths in UpdateChecker.tsx pre-fix), no banner shown. Verified endpoint reachable + latest.json well-formed (curl -sL https://github.com/.../latest.json shows version 0.5.2 + valid signature + correct asset URL). Capabilities granted (updater:allow-check, allow-download, allow-download-and-install, allow-install, process:allow-restart). BUG-ACL-005 defensive handler still in place. Shipped: lib/updater-trace.ts (console.log + localStorage ring buffer max 50 entries — production webview has no devtools so the localStorage mirror is essential), 13 traceUpdater calls in UpdateChecker.tsx covering every silent-return path + install flow, 9 calls in DesktopSettingsPanel.tsx manual handler, new <UpdaterDiagnosticLog> details disclosure in Settings→Updates with Refresh/Copy/Clear buttons. No behavior change. Recommended next test: install v0.5.0, build v0.5.3, launch v0.5.0, open Settings→Updates→Diagnostic log — trace should show run:check-returned {available:true, remoteVersion:0.5.3} and banner should appear. tsc clean, 455/455 pass."}
```
