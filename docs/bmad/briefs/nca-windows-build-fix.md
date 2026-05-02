# Brief: Fix v0.9.26 Tauri Windows Build Failure

## Problem

v0.9.26 build fails with:
```
error[E0432]: unresolved imports `tokio::net::UnixListener`, `tokio::net::UnixStream`
  --> crates/runtime/src/ipc.rs:4:18
```
nca v0.3.0's `nca-runtime` crate uses Unix domain sockets (tokio::net::UnixListener/UnixStream) which don't exist on Windows. The "Build nca for Windows" step in tauri-windows.yml tries to compile nca from source, which fails.

The workflow already has `continue-on-error: true` on the build step, but the PowerShell verification script (`if (-not (Test-Path $exe)) { throw "nca.exe not produced at $exe" }`) still throws an unhandled exception that makes the step report as failed. The step's PowerShell script needs `continue-on-error: true` as well.

## Scope

1. Fix the "Build nca for Windows" step in `.github/workflows/tauri-windows.yml` — add `continue-on-error: true` to the step
2. Fix the "Verify bundled nca" step — add `continue-on-error: true` to it as well
3. The NCA-BUNDLE discovery doc at `docs/bmad/discoveries/NCA-WINDOWS-BUNDLE-2026-05-02.md` confirms upstream has no Windows support — no changes to nca source needed
4. After fix, CI should succeed and the Tauri build ships without bundled nca (the existing graceful degradation handles this)

## GitHub Tasks (Dev only, not Hermes)

- Commit the workflow fix to `origin/main`
- Push
- Trigger `workflow_dispatch` on the Tauri Windows Build to confirm it passes
- The release tag `v0.9.27` will be cut AFTER the build succeeds

## Priority

High — the desktop installer is broken.
