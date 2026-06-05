# STORY-060 Review — Trigger GitHub Actions Windows build

**Status:** DONE (CI run queued)
**Agent:** Developer
**Date:** 2026-04-15
**Classification:** routine
**CI run:** https://github.com/4neverCompany/MashupForge/actions/runs/24425218168

---

## Action taken

Pushed 15 local commits from `main` to `origin/main`. The
`tauri-windows.yml` workflow triggers on every push to `main` (plus
`v*.*.*` tags and `workflow_dispatch`), so the push automatically
queued a new build.

```
$ git push origin main
To https://github.com/4neverCompany/MashupForge.git
   c730d3d..5195644  main -> main
```

Prior history was 15 commits behind `origin/main` because multiple
Developer sessions had been committing locally without pushing.
Rather than running `gh workflow run tauri-windows.yml` against the
stale remote HEAD — which would have produced a `.msi` without the
recent fixes — the push ensures CI builds from the current tip.

## What HEAD `5195644` carries into the build

The new `.msi` artifact will include every fix landed in this batch.
In rough order (oldest to newest):

- **`aa9e007`** STORY-010 — pipeline card brand polish
- **`8bd7725`** STORY-011 — Electric Blue progress bar shimmer
- **`490464d`** STORY-012 — mobile-responsive pipeline
  (390 / 768 / 1024 breakpoints)
- **`8b57b80`** STORY-024 — branded desktop splash screen
- **`02f9290`** STORY-025 — branded toast notification system
- **`9381f62`** STORY-020 — 4neverCompany emerald-starburst icons
- **`b926ef6`** STORY-030 — quote `--prefix` arg to fix Windows
  paths-with-spaces in `installPi()`
- **`1e0d53d`** STORY-031 — humanize Windows install errors
  (`EACCES` / `ENOENT` / `EINVAL` / `ENOSPC` / `ETIMEDOUT`)
- **`5e8b52a`** STORY-032 — desktop Settings panel with
  `config.json` read/write
- **`1a3b9ed`** STORY-042 — branded loading screen
- **`fde3e75`** STORY-040 — build script static validation
  (review-only, no behavior change)
- **`a92b9b2`** STORY-043 — branded error boundary
- **`27a4efe`** STORY-041 — hard-pin sidecar to 127.0.0.1 to avoid
  Windows Defender Firewall prompt on first launch
- **`ebd1364`** STORY-050 — brand-token focus rings
- **`5195644`** STORY-021 — close window title story (docs-only)

Every Windows-specific bug the Phase 1 runtime-install path could
reasonably trip over is now patched. This build is the
"all-fixes-in" artifact Maurice's STORY-061 manual test pass should
run against.

## Run monitoring

- **Workflow:** `tauri-windows`
- **Run ID:** `24425218168`
- **Commit:** `5195644 docs(bmad): STORY-021 — close as done (Option A, Maurice 2026-04-15)`
- **Status at push:** queued
- **Expected duration:** ~20-25 min (recent runs: 21m34s, 23m27s)
- **Expected artifacts:**
  - `mashupforge-windows-msi` (Wix `.msi`)
  - `mashupforge-windows-nsis` (`*-setup.exe`)
- **Cancel-in-progress:** concurrency group
  `tauri-windows-refs/heads/main` is configured to cancel an
  in-flight build if a new commit lands on `main`. No further
  pushes expected before completion.

## If the build fails

The Windows build has been passing on recent commits (the last two
runs on `main` were both green), so a failure here would most
likely point at one of the newly landed changes. Triage order:

1. **Rust compile error** → check STORY-042 (loading screen) or
   STORY-043 (error boundary) if either touched `src-tauri/src/lib.rs`
2. **`npm ci` / TypeScript error** → check STORY-012 (mobile
   responsive) or STORY-032 (desktop Settings) — those touched the
   largest number of frontend files
3. **Tauri bundle step** → check `src-tauri/tauri.conf.json` or
   `src-tauri/icons/` integrity from STORY-020
4. **Next standalone build** → check `next.config.ts` unchanged and
   `output: 'standalone'` still present
5. **WiX / NSIS packaging** → rare, usually a tauri-action version
   mismatch; not expected

A failure report would go to `docs/bmad/reviews/STORY-060-failure.md`
with the `gh run view 24425218168 --log-failed` tail and a
classification (routine revert vs. complex lift).

## Handoff to STORY-061

STORY-061 is the manual installation test, owned by Maurice on a
real Windows host. Once this CI run completes:

1. **Download the artifact.** From the Actions run page →
   "Artifacts" section → `mashupforge-windows-msi`. Unzip.
2. **Run the STORY-004 manual test checklist** at
   `docs/bmad/reviews/STORY-004.md`. The checklist has 6 tests
   (install → launch → config hydration → image gen → pi start →
   cache reuse). Every one of them should now pass — STORY-030
   unblocks users whose username has a space, STORY-031 gives
   actionable errors if something goes wrong, STORY-041 silences
   the Defender prompt.
3. **Plus the new Test 2.5** documented in STORY-041's review —
   confirm no "Allow this app through the firewall" dialog on
   first launch.

If any test fails, record the failure mode in the STORY-061 review
artifact and report back via FIFO. Most failures at this point are
likely to be desktop-UX issues (icon alignment, splash screen
glitches, toast positioning) rather than architectural bugs — the
architecture was validated in STORY-004 pre-flight and again in
STORY-040.

## Handoff

- 15 commits pushed to `origin/main` (`c730d3d..5195644`)
- CI run `24425218168` queued against the new HEAD
- Queue entry will be marked `[x]` with a pointer to this artifact
  and the run URL
- STORY-061 remains `[ ]` until Maurice runs the manual test pass
  and records results
