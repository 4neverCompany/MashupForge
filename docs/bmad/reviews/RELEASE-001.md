# RELEASE-001 — Bump 0.1.9 → 0.2.0 + trigger CI build (DONE)

**Status:** done
**Classification:** routine (per Hermes dispatch)
**Executed:** 2026-04-18
**Commits:** `4f69596` (version bump), tag `v0.2.0`

---

## Why

Ready to release: 17 deliverables since 0.1.9 (UI tokens, GalleryCard extraction, fanCaptionToGroup helper, computeCarouselView tests, SettingsModal tab restructure + S1 error pill, settings save state, plus a half-dozen bug fixes), 129/129 tests passing, working tree clean as of `5c4d6ed`.

## Version choice — 0.1.9 → 0.2.0 (minor)

A patch bump (0.1.10) understates the scope. This release adds:

- **New user-visible features**: SettingsModal tab restructure (new IA), header save-state pill (idle/saving/saved/error), watermark-conditional fields lifted out of the buggy nesting.
- **New modules**: `lib/ui-tokens.ts`, `lib/carouselView.ts`, `components/GalleryCard.tsx`.
- **Test infrastructure**: first 13 unit tests on UI logic (closes the "zero tests on UI helpers" gap QA flagged).

No public API surface to break (it's a Tauri app, no library consumers), so the SemVer minor bump is the right granularity — meaningful release without claiming 1.0.

## Files touched

| File | Diff |
|---|---|
| `package.json` | `"version": "0.1.9"` → `"0.2.0"` |
| `package-lock.json` | `"version": "0.1.8"` → `"0.2.0"` (was stale; corrected) |
| `src-tauri/Cargo.toml` | `version = "0.1.9"` → `"0.2.0"` |
| `src-tauri/tauri.conf.json` | `"version": "0.1.9"` → `"0.2.0"` |

`Cargo.lock` not touched — the `app` package entry there is at `0.1.0` (pre-existing drift from earlier releases; cargo will reconcile on the CI build's `cargo build` step). Following the prior-release pattern.

## CI trigger

The workflow at `.github/workflows/tauri-windows.yml` fires on `tags: ['v*.*.*']`, **not** push-to-main. Pushed `4f69596` to `main`, then created annotated tag `v0.2.0` and pushed it — that fired the build.

**CI run URL:** https://github.com/4neverCompany/MashupForge/actions/runs/24602985211

Status at handoff: queued (just dispatched). Prior 0.1.9 release run took ~19 min on the same workflow; expect similar.

---

## Acceptance checklist

| AC | Status | Notes |
|---|---|---|
| Version bumped in all 3 files (`package.json`, `Cargo.toml`, `tauri.conf.json`) | ✅ | Plus `package-lock.json` corrected from a stale 0.1.8 → 0.2.0. |
| Committed + pushed to trigger CI | ✅ | `4f69596` on `main`; tag `v0.2.0` pushed (CI is tag-triggered, not push-to-main). |
| CI run URL reported | ✅ | https://github.com/4neverCompany/MashupForge/actions/runs/24602985211 |
| Write FIFO when done | ✅ | After this writeup. |

## How to verify

1. `git log --oneline -2` → top entry is `4f69596 chore: bump version to 0.2.0`.
2. `git tag -l v0.2.0 --format='%(refname:short) %(taggerdate:short)'` → tag exists.
3. Open the CI URL above; the run should be `in_progress` or `success` (depending on when this is read). On success, downloadable Windows installer artifacts will be attached to the tag's release.
4. Locally: `grep -rn '"version"' package.json src-tauri/tauri.conf.json && grep '^version' src-tauri/Cargo.toml` — all four should report 0.2.0.
