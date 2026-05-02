# nca Windows binary — bundled from source

**Date:** 2026-05-02
**Triage:** Developer
**Task id:** NCA-BUNDLE

## Update — 2026-05-02 (post-v0.9.26 build failure)

**The "build from source on the Windows runner" plan fails.** v0.9.26's
Tauri build (`gh run 25258406519`) crashed at the new "Build nca for
Windows" step with:

```
error[E0432]: unresolved import `tokio::net::UnixListener`
   --> crates\runtime\src\ipc.rs:4:23
    |
  4 | use tokio::net::{UnixListener, UnixStream};
    |                  ^^^^^^^^^^^^ no `UnixListener` in `net`
```

The `nca-runtime` crate imports `tokio::net::{UnixListener, UnixStream}`
**without a `#[cfg(unix)]` gate**. Tokio gates those types behind
`cfg(all(unix, feature = "net"))`, so on Windows the import resolves
to nothing and four downstream `error[E0277]` build errors cascade.

I verified this affects v0.2.0 too — same imports, same lack of
gate. nca is **fundamentally Unix-only across all releases**, not just
"missing a Windows release artifact." That's the real reason upstream
only publishes macOS + Linux binaries: their IPC layer (supervisor →
session daemon socket) hard-codes Unix-domain sockets. Windows would
need a named-pipe / `interprocess` crate / cfg-gated alternative
backend.

We cannot fix this from the MashupForge side without forking the
project, and a fork tracking upstream is more maintenance burden than
the bundle is worth.

### Revised plan (what's actually shipped)

`.github/workflows/tauri-windows.yml`:

- **"Build nca for Windows" step** now has `continue-on-error: true`
  + `id: nca_build`. It will still fail on every run until upstream
  adds Windows support — but it no longer blocks the Tauri build.
- **"Verify bundled nca" step** now gated on
  `steps.nca_build.outcome == 'success' || steps.cache-nca.outputs.cache-hit == 'true'`.
  Skips silently when the bundle isn't there.
- **New "Note nca bundle absence" step** prints a `::warning::` when
  the build fails and there's no cache, so the failure is visible in
  the run summary without breaking the run.

`scripts/tauri-server-wrapper.js` (unchanged from NCA-BUNDLE):

- The `pinBundledNca()` block already `existsSync`-guards the
  resource path. With no `nca.exe` at the resource location, it
  leaves `NCA_BIN` unset and `lib/nca-client.ts` falls back to the
  PATH lookup (`'nca'`).

`components/SettingsModal.tsx` (unchanged):

- The "Not Installed" branch already covers this — Windows users
  see the install instructions, the API-key paste form is hidden,
  and they're directed at the upstream releases page (where they'll
  find no Windows artifact, but at least the path is honest).

**Net effect on the Windows installer:** ships without bundled nca
until upstream adds Windows support. That is the same situation
Windows users have always been in; v0.9.26's fix-attempt just
revealed why.

### Forward path

If upstream adds a Windows IPC backend in a future release:

1. Bump `NCA_TAG` in the workflow to the new release.
2. Clear the `nca-windows-x86_64-v0.3.0` cache key (rename or delete).
3. The `Build nca for Windows` step will succeed, the cache will
   populate, the verify step will pass, and the `Note nca bundle
   absence` step will be skipped — the bundle just starts working.

If upstream publishes a Windows release artifact (no source build
needed), swap the `cargo build` step for a `gh release download` of
the asset. Same `continue-on-error` posture in the meantime.

## Original plan (preserved for context — superseded above)

## Symptom

Maurice on the Windows desktop build hit:

> Install nca → clicking does nothing
>
> "nca binary not callable. Ensure /usr/local/bin/nca exists (or set NCA_BIN to its path)."

The Settings → AI Agent "Not Installed" branch had an `Install nca`
button that linked to `https://github.com/madebyaris/native-cli-ai/releases`.
Three problems:

1. **Upstream publishes no Windows binary.** Survey of the nca repo's
   release history (v0.2.0 + v0.3.0): `nca-aarch64-apple-darwin.tar.gz`,
   `nca-x86_64-apple-darwin.tar.gz`, `nca-x86_64-unknown-linux-gnu.tar.gz`.
   No `*-windows-msvc.zip`, no `nca.exe`. Maurice's brief mentioned
   `winget install Aris.native-cli-ai` but that package doesn't exist
   either — `winget search Aris.native-cli-ai` returns nothing.
2. **External-link clicks were silently failing** in the Tauri webview
   (separate, downstream issue — the `<a target="_blank">` should have
   handed off to the system browser via plugin-opener; if it didn't,
   that's a Tauri allowlist concern not addressed here).
3. **Even if the link worked, there was nothing for the user to
   download.** They'd land on the GitHub releases page with no Windows
   asset.

## Decision

Bundle `nca.exe` inside the Tauri Windows installer. No external download
step, no winget package required, no manual PATH setup. nca is present
on first launch, the api-key paste form works without setup.

## How

### 1. Build from source on the runner (CI workflow)

`.github/workflows/tauri-windows.yml` adds two new steps after the
existing Rust toolchain setup, before `tauri build`:

- **Cache nca binary** — `actions/cache@v4` keyed on
  `nca-windows-x86_64-v0.3.0`. Subsequent runs skip the build entirely
  until we bump `NCA_TAG`.
- **Build nca for Windows** — `git clone --depth 1 --branch v0.3.0`,
  then `cargo build --release --locked -p nca-cli --target
  x86_64-pc-windows-msvc`. Output `nca.exe` is copied to
  `src-tauri/resources/nca/nca.exe`. Pinned to v0.3.0 so the build is
  reproducible; bumping nca = bumping the tag in the workflow + clearing
  the cache key.
- **Verify bundled nca** — runs `nca.exe --help` (no network) just to
  confirm the binary loads. Doesn't run `nca doctor` because the runner
  has no MINIMAX_API_KEY and we're only checking the binary, not the
  provider config.

### 2. Tauri config

`src-tauri/tauri.conf.json` already has `"resources": ["resources/**/*"]`.
The new `resources/nca/nca.exe` is picked up automatically. No config
change needed.

### 3. Sidecar wrapper hands off `NCA_BIN`

`scripts/tauri-server-wrapper.js` is the Node entry the Tauri Rust
launcher spawns. Added a small `pinBundledNca()` block that:

- Runs after the desktop config hydration but before
  `require('./server.js')`.
- Computes `path.join(__dirname, '..', 'nca', 'nca.exe')` —
  the wrapper sits at `<install-dir>/resources/app/start.js`, the
  bundled binary at `<install-dir>/resources/nca/nca.exe`, so the
  bundle is always one directory up + into `nca/`.
- `existsSync` guard, only sets `process.env.NCA_BIN` if the binary is
  present AND no user-supplied `NCA_BIN` already exists.

`lib/nca-client.ts` reads `process.env.NCA_BIN` dynamically (per the
NCA-INTEGRATION-DEV note about avoiding module-load capture), so the
env var injection takes effect on the very next `nca` spawn. No
client-side change required.

### 4. Settings UI copy update

`components/SettingsModal.tsx` "Not Installed" branch rewritten:
- Removed the `winget install Aris.native-cli-ai` hint (package
  doesn't exist).
- Removed the GitHub-releases link as the primary action (no Windows
  artifact to download).
- Replaced with two-clause copy: "If desktop, reinstall to restore the
  bundled binary. If web/dev, build nca from source." Frames the state
  as the rare exception bundling now makes it.

## Out of scope

- **macOS / Linux Tauri builds.** No CI workflow exists for those
  targets, so no bundling story is needed yet. nca's upstream releases
  (`*-apple-darwin.tar.gz`, `*-linux-gnu.tar.gz`) are usable directly
  on those platforms.
- **Auto-update of the bundled nca.** Pinning to v0.3.0 means a new
  nca release requires a MashupForge release to ship the upgrade. If
  upstream eventually publishes Windows binaries (or a winget package),
  we can switch to a `gh release download` step instead of cargo build.
- **The Tauri webview external-link bug.** `<a target="_blank">` not
  opening in the system browser is a separate concern — irrelevant
  once bundling removes the need for users to click those links at all.

## Files

- `.github/workflows/tauri-windows.yml` — Cache + Build + Verify steps.
- `scripts/tauri-server-wrapper.js` — `pinBundledNca()` block.
- `components/SettingsModal.tsx` — "Not Installed" copy.
- `.gitignore` — `src-tauri/resources/nca/` (runner-built artifact).
