# STORY-061 Review — Test .msi installation on Windows

**Status:** HANDOFF PREPARED — blocked on Maurice manual test pass
**Agent:** Developer (handoff only; Maurice owns execution)
**Date:** 2026-04-15
**Classification:** routine (manual test by Maurice — per queue)
**Depends on:** STORY-060 (CI run 24425218168)

---

## Why this is a handoff, not an execution

The queue explicitly classifies STORY-061 as `routine (manual test
by Maurice)`. I cannot run a Windows installer from WSL: no `.msi`
execution, no Windows shell, no Windows Defender, no real Start
menu to verify. The developer-side work for this story is to make
sure Maurice has everything he needs to run the test in one
sitting, with no unanswered questions and no missing context.

That prep is done. Maurice's half takes ~20-30 minutes on a real
Windows PC.

## Prerequisite: CI artifact from STORY-060

The CI run triggered by STORY-060 must complete green before this
test can start.

- **Workflow run:** https://github.com/4neverCompany/MashupForge/actions/runs/24425218168
- **Commit tested:** `5195644` (HEAD at the time of STORY-060 push)
- **Expected artifacts:**
  - `mashupforge-windows-msi` (Wix-based `.msi`)
  - `mashupforge-windows-nsis` (`*-setup.exe` NSIS alternative)

Either installer is fine for STORY-061; pick the MSI as primary.

If the CI run failed, STORY-061 is blocked — triage the build
before running any on-host test.

## The test checklist (reuse STORY-004)

`docs/bmad/reviews/STORY-004.md` already contains a 6-test manual
checklist (Tests 1-6) keyed 1:1 to the Phase 1 acceptance criteria.
That checklist is exactly what STORY-061 needs to run, nothing more.

Summary of the six tests and what each proves about recent fixes:

| Test | Proves | Fix that unblocks it |
|---|---|---|
| **1. MSI installs cleanly** | Installer signing / SmartScreen / file tree | STORY-020 (branded icons visible in Add/Remove Programs) |
| **2. App launches; sidecar boots** | Rust launcher + Node sidecar pipeline | STORY-042 (branded loading screen instead of blank stub) |
| **2.5. No Defender firewall dialog** | Loopback binding enforced | STORY-041 (hard-pin HOSTNAME=127.0.0.1) |
| **3. config.json hydration** | `%APPDATA%\MashupForge\config.json` reads | STORY-032 (desktop Settings panel writes the same file) |
| **4. End-to-end image generation** | Leonardo API path works with hydrated key | — baseline |
| **5. Start pi from Settings, receive chat response** | Runtime pi install via npm → pi.cmd spawn | STORY-030 (quoted --prefix survives spaces in username); STORY-031 (humanized error if it fails) |
| **6. Second launch uses cached pi install** | `getPiPath()` resolution of cached pi.cmd | — baseline |

Test 2.5 is **new** — it wasn't in the original STORY-004
checklist because it was authored before STORY-041 landed. Per the
STORY-041 review artifact, insert it between Test 2 and Test 3:

> **Test 2.5 — No Defender dialog.** On first launch of the installed
> `.msi`, there is no "Allow MashupForge.exe through the firewall"
> dialog. If one appears, the loopback pin is broken — check the
> Tauri stdout log for `[tauri-wrapper] booting Next on 127.0.0.1:<port>`
> and confirm `HOSTNAME` is not being overridden downstream.

## Username-with-space edge case

STORY-030 fixed a real bug where `installPi()` would mangle
`--prefix` if the user's Windows username had a space
(`C:\Users\First Last\AppData\...`). Maurice's own Windows account
name should be checked — if it has a space, this test run is the
first real proof the fix holds. If his account name has no space,
the fix is only proven in theory until a user with a spaced name
hits the installer.

Worth noting in the test pass either way: "My username does/does
not have a space in it — STORY-030 regression coverage is
{covered / not covered} by this run."

## Failure reporting

If any test fails, record the failure with:

1. Test number (1 / 2 / 2.5 / 3 / 4 / 5 / 6)
2. Exact error message surfaced in the UI (screenshot is ideal)
3. Contents of `%APPDATA%\MashupForge\logs\` if logs exist
4. Tauri stdout if visible (may require running the `.exe` from a
   terminal rather than the Start menu shortcut)
5. Output of `POST /api/pi/install` if Test 5 fails — the
   `diagnostics` block now contains a humanized Windows error
   (STORY-031) which points at the likely cause directly

Append the failure report as a new section to this review artifact
and re-open the story in the queue by flipping `[x]` back to `[~]`
with a pointer to the failure report. Classify the follow-up bug
as routine or complex per the usual rubric.

## Exit criteria

All six tests (plus 2.5) green on a real Windows host → STORY-061
marked `[x]`, STORY-004 marked `[x]`, Phase 1 Windows build ships
to the user acceptance group.

Any test failing → file the failure report, classify the bug, loop
through the Developer autoloop until fixed, trigger STORY-060
again, re-run STORY-061.

## Handoff

- STORY-061 marked `[~]` in the queue with "blocked on Maurice
  manual test pass"
- STORY-004 remains `[~]` and will clear in the same Maurice session
  that closes STORY-061 (they share the same checklist)
- CI run URL in the queue entry so Maurice can find the artifact in
  one click
- No code changes, no commits required from the developer side
- I go idle. Next developer-side work on the Windows build is
  triage of any test failure Maurice reports.
