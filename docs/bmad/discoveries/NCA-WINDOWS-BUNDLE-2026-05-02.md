# nca Windows binary — bundled from source

**Date:** 2026-05-02
**Triage:** Developer
**Task id:** NCA-BUNDLE

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
