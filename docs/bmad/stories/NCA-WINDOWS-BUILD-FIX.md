# Story: NCA-WINDOWS-BUILD-FIX

## Brief

Fixes the broken Tauri Windows CI build caused by nca v0.3.0 not compiling on Windows.

## Tasks

### NCA-WINDOWS-BUILD-FIX-001: Add continue-on-error to Build nca step

**File:** `.github/workflows/tauri-windows.yml`
**Section:** "Build nca for Windows" step
**Change:** Add `continue-on-error: true` to the step

Current step:
```yaml
      - name: Build nca for Windows
        id: nca_build
        if: steps.cache-nca.outputs.cache-hit != 'true'
        continue-on-error: true   # ← ALREADY HAS THIS
        shell: pwsh
        env:
          NCA_TAG: v0.3.0
        run: |
          ...
          cargo build --release --locked -p nca-cli --target x86_64-pc-windows-msvc
          $exe = Join-Path $src "target\x86_64-pc-windows-msvc\release\nca.exe"
          if (-not (Test-Path $exe)) { throw "nca.exe not produced at $exe" }  # ← PROBLEM: throws even with continue-on-error
```

**Fix:** The build step already has `continue-on-error: true` — the issue is the PowerShell script throws AFTER cargo returns. Need to either:
- Option A: Wrap the `if (-not (Test-Path $exe))` check in the PowerShell script with `if ($LASTEXITCODE -eq 0 -and -not (Test-Path $exe))` so it only throws if cargo actually succeeded
- Option B: Move the `throw` outside the `try`/`finally` or restructure so it doesn't throw on a non-fatal condition

The real issue: cargo itself fails (returns non-zero), `continue-on-error: true` catches that, but then the PowerShell `throw` in the script fires AFTER cargo and propagates as an unhandled exception. Actually looking at the CI log more carefully:

```
##[error]Process completed with exit code 1.
```

This came from the PowerShell throw at line 9, which fires because `nca.exe` wasn't produced (cargo failed). Since the step already has `continue-on-error: true`, the `throw` must be happening INSIDE the step's script block. The solution is Option A: only throw if cargo actually succeeded.

### NCA-WINDOWS-BUILD-FIX-002: Add continue-on-error to Verify bundled nca step

**File:** `.github/workflows/tauri-windows.yml`
**Section:** "Verify bundled nca" step
**Change:** Add `continue-on-error: true`

Current step:
```yaml
      - name: Verify bundled nca
        if: steps.nca_build.outcome == 'success' || steps.cache-nca.outputs.cache-hit == 'true'
        shell: pwsh
        run: |
          $nca = Join-Path $env:GITHUB_WORKSPACE "src-tauri\resources\nca\nca.exe"
          if (-not (Test-Path $nca)) { throw "nca.exe missing at $nca — bundling step failed" }
```

**Fix:** Add `continue-on-error: true` — this step should not block the build if nca is absent.

## Verification

After fix:
1. Push to main
2. Trigger Tauri Windows Build via workflow_dispatch with release_tag: v0.9.27
3. Build completes successfully (Tauri NSIS .exe produced)
4. nca is NOT bundled (graceful degradation — existing Settings UI handles this)
