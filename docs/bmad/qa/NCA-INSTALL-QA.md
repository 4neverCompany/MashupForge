# QA Review — NCA-INSTALL-QA

**Status:** CONCERNS (0.81) — W-1 must fix before merge
**Agent:** QA (Quinn)
**Date:** 2026-05-02
**Commits reviewed:**
- `f9c3b64` — feat(nca): add /api/nca/models route (NCA-INSTALL-DEV)
- `4b367be` — feat(nca): add install flow UX to settings (NCA-INSTALL-DESIGN)
**Brief:** `docs/bmad/briefs/nca-install-flow.md`

## Files Reviewed

- `app/api/nca/models/route.ts` (new, 119 lines)
- `components/SettingsModal.tsx` (modified — ncaSetupBlock state split, model picker, label fixes)

## Acceptance Criteria vs. Findings

| # | Criterion | Result |
|---|-----------|--------|
| AC1 | Not Installed state shows Install button + winget hint, hides API key form | ⚠️ PARTIAL — correct content, but duplicate render (W-1) |
| AC2 | Install button opens GitHub releases in external tab | ✅ PASS |
| AC3 | Not Authenticated state shows API key form + platform link | ✅ PASS |
| AC4 | Authenticated state shows model picker from GET /api/nca/models | ✅ PASS |
| AC5 | Model selection saves via POST /api/nca/setup with `{ model }` | ✅ PASS |
| AC6 | "Open nca CLI" button labeled correctly (not "MMX CLI") | ✅ PASS |
| TS | `tsc --noEmit` clean | ✅ PASS |
| Tests | vitest — 30 failures pre-exist at `b62e6d9`, not introduced by these commits | ✅ PASS |

## Detailed Findings

### AC1 — Not Installed state

`ncaIsNotInstalled = ncaStatus == null || !ncaStatus.available` (line 421). ✅

When `ncaIsNotInstalled === true`, `ncaSetupBlock` renders:
- `<a href="https://github.com/madebyaris/native-cli-ai/releases" target="_blank">Install nca</a>` (line 433–440) ✅
- Winget one-liner + POSIX path hint (lines 441–445) ✅
- API key form is in the `else` branch — correctly hidden (line 447+) ✅

**Content is correct. But see W-1 — the block renders twice when `activeAiAgent === 'nca'`.**

### AC2 — Install button target

```tsx
href="https://github.com/madebyaris/native-cli-ai/releases"
target="_blank"
rel="noopener noreferrer"
```
Opens in a new tab with noreferrer. ✅

### AC3 — Not Authenticated state

`else` branch of `ncaIsNotInstalled` (lines 447–502):
- Password input with label "MiniMax API key" ✅
- Save button with `ncaBusy`-gated disabled state ✅
- Platform link: `https://platform.minimax.io/` → "Get one at platform.minimax.io →" ✅

### AC4 — Model picker from /api/nca/models

`useEffect` dep on `ncaStatus?.authenticated` (line 338): fires when auth flips true, fetches
`/api/nca/models`, maps `provider_models` into `NcaModel[]`, stores in `ncaModels`. ✅

Picker at line 942–991:
- Grouped by `provider` via `reduce` ✅
- Gold-bordered radio for the current selection (`ncaStatus.model === m.model`) ✅
- `ncaModelSaving` per-row guard: `opacity-50 pointer-events-none` while a different row saves ✅
- `disabled={!!ncaModelSaving}` on the `<input>` ✅
- `saving…` inline indicator on the in-flight row ✅

### AC5 — Model save via /api/nca/setup

`handleNcaModelSelect` (lines 345–366):
```typescript
const res = await fetch('/api/nca/setup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model }),
});
```
`{ model }` only — no apiKey — matches the setup route's probe-and-persist shape. ✅
On success: `refreshNcaStatus()` called → green "ready (model)" line updates immediately. ✅
On failure: `setNcaError(data.error || 'Failed to save model selection')`. ✅
`ncaModelSaving` guard prevents overlapping saves (`if (ncaModelSaving) return`). ✅

### AC6 — "Open nca CLI" label

`SettingsModal.tsx:999`:
```tsx
{ncaBusy ? 'Opening…' : 'Open nca CLI to change provider/model'}
```
✅ — no "MMX" remaining in user-visible text in the nca branch.

Also confirmed:
- Line 510: `"nca authenticated. Pick a provider/model below or open the terminal."` (replaces old "MMX authenticated...") ✅
- Line 1011: `"nca setup — action required"` ✅

### /api/nca/models route

- `GET`, `runtime = 'nodejs'` ✅
- Spawns `nca models --json`, discards stderr, collects stdout ✅
- 503 on spawn failure (binary not found) ✅
- 500 on non-zero exit ✅
- 500 on non-JSON stdout ✅
- Passes parsed response through verbatim with `Cache-Control: no-store` ✅
- `ncaBin()` reads `NCA_BIN` env dynamically (no module-load capture). ✅

Minor inconsistency: the route's local `ncaBin()` falls straight to `'nca'` PATH lookup when
`NCA_BIN` is unset, while `lib/nca-client.ts`'s `ncaBin()` also checks for `/usr/local/bin/nca`
on POSIX first. On a system where `/usr/local/bin/nca` exists but isn't in PATH, this route
would fail while the client succeeds. See INFO I-1.

### Test suite

First run: 30/987 failures across 6 files (GalleryFilterBar, CollectionModal-suggest, and others).  
Re-verified at parent commit `b62e6d9`: **same 30 failures**. Pre-existing flaky suite issue,
not introduced by these commits. ✅

## Findings

### Critical

_None._

### Warnings (must fix before merge)

**[WARNING W-1] Duplicate `ncaSetupBlock` when `activeAiAgent === 'nca'` and nca is not set up.**

`SettingsModal.tsx:912`:
```tsx
{activeAiAgent !== 'mmx'
  && (ncaStatus == null || !ncaStatus.available || !ncaStatus.authenticated) && (
  <div className="pt-2">{ncaSetupBlock}</div>
)}
```

When a user has selected nca as their active provider (`activeAiAgent === 'nca'`) but hasn't
yet authenticated, both render sites show `ncaSetupBlock` simultaneously:

1. **Hoisted CTA** (line 912–914): fires because `'nca' !== 'mmx'` = `true`
2. **Active-agent panel** (line 925–928): fires because `activeAiAgent === 'nca'`

Result: the "Not Installed" Install button and the "Not Authenticated" API-key form appear
**twice on screen** — the same duplicate-panel concern that was explicitly prevented for MMX
in the MMX-AGENT-CARD-UX-VISUAL-PASS brief (`avoids the duplicate-MMX-panel concern`).

The comment on lines 907–910 says "Hides itself once MMX is the active agent" — but the guard
was not updated when the provider was renamed from mmx to nca, so it now fails to hide when
`activeAiAgent === 'nca'`.

**Fix:**
```diff
- {activeAiAgent !== 'mmx'
+ {activeAiAgent === 'pi'
```
This restores the mutual-exclusion invariant: the hoisted CTA is only visible when pi is the
active agent (so nca setup is accessible without switching to it), and the active-agent panel
owns the surface once `activeAiAgent === 'nca'` or `'mmx'`.

Update the comment on line 907 to read "Hoisted CTA: rendered when nca is not the active agent"
to match the new guard.

### Info

**[INFO I-1] `/api/nca/models`'s local `ncaBin()` omits the POSIX `/usr/local/bin/nca` fallback.**

The route's `ncaBin()` (line 25–27) returns `process.env.NCA_BIN || 'nca'` — PATH lookup only.
`lib/nca-client.ts`'s `ncaBin()` also probes `/usr/local/bin/nca` before falling back to PATH.
On a system where `/usr/local/bin/nca` exists but the directory is not in PATH (unusual but
possible), `GET /api/nca/models` would return 503 while `lib/nca-client.ts` calls succeed.
Consider exporting `ncaBin()` from `lib/nca-client.ts` and importing it in both route files.

**[INFO I-2] Comment block lines 899–910 is stale — still refers to "MMX".**

The outer comment (line 899–906) mentions "install/auth MMX", "api/mmx/status probe", and
"the user can install/auth MMX". The inner comment (907–910) says "rendered when MMX is not
the active agent". All of these should reference nca. No functional impact, but misleading
for future maintainers.

**[INFO I-3] `ncaModels` is never cleared when `ncaStatus` drops back to unauthenticated.**

If a user removes their API key (e.g., via `/api/desktop/config` PATCH), `ncaStatus.authenticated`
flips false, but `ncaModels` retains the previously fetched list. The picker is only shown inside
the `authenticated === true` branch so stale models are never displayed — no UX impact. But a
future refactor that renders the picker earlier could surface stale data. Low risk, noted for
completeness.

## Scope Check

- [IN-SCOPE] `app/api/nca/models/route.ts` — reviewed ✅
- [IN-SCOPE] `components/SettingsModal.tsx` — ncaSetupBlock state split, model picker, label fixes — reviewed ✅
- [OUT-OF-SCOPE] `app/api/nca/setup/route.ts` — no changes in this commit; handles `{ model }` body correctly per prior review (NCA-INTEGRATION-QA) ✅

## Gate Decision

**[CONCERNS — 0.81]** — 5 of 6 functional criteria pass exactly per spec. W-1 (duplicate
`ncaSetupBlock`) is a visible UX regression triggered when the user selects nca as active agent
before authenticating — the setup block renders twice, producing a doubled "Install nca" button
and form. The fix is a one-character guard change (`!== 'mmx'` → `=== 'pi'`). All other
criteria (route, model picker, model save, labels, tsc, tests) are correct.

**Merge acceptable with W-1 patched. It is the only deviation from spec.**
