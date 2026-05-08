# Settings/Providers/Instagram "v0.9.28 regression" — BLOCKED (premises wrong)

**Status:** BLOCKED — will not execute as written
**Reviewed:** 2026-05-05 by Developer
**Source report:** `/tmp/bug-report.md`

## TL;DR

The bug report claims three P0 regressions introduced by `abe91e1` (NCA-CHAT-DEBUG, the v0.9.28 release) and asks for fixes in v0.9.29. None of the three claims survive verification:

1. **Issue 1 — "No key input fields":** the inputs are still present and rendering. The cited refactor *moved* one input, did not remove any.
2. **Issue 2 — "CLI setup conflict":** mutual exclusion has never been implemented. This is a new UX feature request, not a regression.
3. **Issue 3 — "Instagram scheduled posts":** no Instagram or scheduling code changed in the v0.9.27..v0.9.29 window. Cannot be a regression of those tags.

Applying "fixes" to phantom regressions would churn working code. Need a clarification from Hermes / reporter before touching anything.

## Verification

### Issue 1 — API key inputs are present

Inputs currently rendered in `components/SettingsModal.tsx` on `HEAD`:

| Field | Line | Tab | Gating |
|---|---|---|---|
| MiniMax API key (NCA) | 473 | AI Engine → NCA card | When nca authenticated |
| Leonardo API Key | 656 | API Keys | `isDesktop === false` |
| Instagram IG Account ID | 691 | API Keys | `isDesktop === false` |
| Instagram Access Token | 699 | API Keys | `isDesktop === false` |
| Pinterest Access Token | 728 | API Keys | `isDesktop === false` |
| Pinterest Board ID | 746 | API Keys | `isDesktop === false` |

In **desktop mode** the API Keys tab intentionally shows only a hint pointing the user to the **Desktop tab**, where `DesktopSettingsPanel.tsx` owns these credentials and writes them to `config.json`. This is an existing design decision documented inline (FEAT-002b, STORY-130, INSTAGRAM-CRED-FIX comments) and predates the refactor.

`abe91e1` diff over `components/SettingsModal.tsx`:

- 1 `<input>` line removed, 1 `<input>` line added — **net zero**
- The change renamed `ncaSetupBlock` → `ncaInstallBlock` and **relocated** the NCA API-key input from below the card grid into the NCA card itself
- File-level stat `316` reads as the bar character count in `git show --stat`, not "316 lines removed". Real diff is **+173/−173**.

If the report meant "the API Keys tab in desktop mode looks empty," that's a separate UX issue (the "Managed in Desktop Configuration" hint is intentional). Send a Brief, not a regression report.

### Issue 2 — CLI mutual exclusion was never implemented

The report itself states: "Currently both setup flows can run concurrently." That describes the existing behavior, not a regression. Mutual exclusion would be a new feature spanning `ncaStatus` / `piStatus` setup state machines and would need its own design pass (state model, who wins ties, abort semantics).

### Issue 3 — Instagram/scheduling untouched in v0.9.28/v0.9.29

`git diff v0.9.27..v0.9.29 --stat` shows the only files modified are:

```
CHANGELOG.md
components/SettingsModal.tsx
lib/nca-client.ts
package.json
src-tauri/Cargo.lock
src-tauri/Cargo.toml
src-tauri/tauri.conf.json
tests/lib/nca-client-auth.test.ts
tsconfig.json
```

No file under `app/api/social/`, `app/api/queue/schedule/`, or any Instagram code path is in that diff. Whatever the user is seeing with scheduled IG posts cannot have been "introduced in v0.9.28/v0.9.29" — it predates the window or is environmental. Need a real repro (browser console, network log, or screen recording) to investigate.

## What I need from Hermes / the reporter

For each of the three issues, one of:

1. **A repro that contradicts the verification above** — exact device/build (web vs desktop), screenshot showing the empty Settings tab, console log showing the failed save. If desktop: which tab did you open? API Keys (intentionally minimal in desktop) or Desktop (where the inputs live)?
2. **A reframe** — "this isn't a regression, it's a UX/feature request" — promote to a Brief and prioritize independently.
3. **Close** — accept that the report was based on a misread of the `git show --stat` output.

## What I will NOT do

- Edit `SettingsModal.tsx` to "re-add" inputs that aren't missing
- Implement mutual exclusion as a P0 hotfix without a design pass
- Touch scheduling code without evidence the regression is real and in-window
