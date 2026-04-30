# QA Review — MMX-CARD-VPASS-QA

**Status:** CONCERNS
**Agent:** QA (Quinn)
**Date:** 2026-04-30
**Commits:** `0fc1321` (visual pass) · `d522b6f` (brief)
**Decisions doc:** `design/MMX-AGENT-CARD-UX-VISUAL-PASS.md`

## Files Reviewed

- `components/SettingsModal.tsx`
  - `mmxSetupBlock` definition (lines 306–400)
  - `postMmxSetup` / `handleMmxApiKeySave` / `handleMmxSetup` / `refreshMmxStatus` / `mmxJustAuthed` auto-clear (lines 167–254)
  - `handleMmxCardClick` (lines 667–685)
  - Hoisted CTA render site (lines 790–798)
  - Active-agent panel render site (lines 800–861)

## Verify Criteria vs. Findings

| # | Criterion | Result |
|---|-----------|--------|
| V1 | Hoisted CTA renders only when MMX is NOT the active agent; never both simultaneously | ✅ PASS |
| V2 | `mmxSetupBlock` bit-identical in both render sites (single JSX variable) | ✅ PASS |
| V3 | State-aware caption matches spec table; OAuth link copy correct | ⚠️ CONCERNS — see W-A |
| V4 | Authenticated state shows ready line + version + reconfigure link; link fires `handleMmxSetup` | ✅ PASS |
| V5 | Success path: `Saving…`, input clears, re-probe, badge fires, 3.5s auto-clear | ✅ PASS |
| V6 | Error path: input retains value, `role="alert"`, persists until next attempt, no success badge | ✅ PASS |
| V7 | Double-click guard: `mmxBusyRef` + `disabled={mmxBusy}` prevent duplicate POST | ✅ PASS |
| V8 | Loading-window card click fires `handleMmxSetup` (W-1 reversal per `75e0c85`) | ✅ PASS |
| V9 | Empty `version` renders `✓ MMX is authenticated and ready.` — no `(null)` or `(undefined)` | ✅ PASS |
| V10 | Pi.dev panel unchanged — no MMX state leakage | ✅ PASS |
| TS | `tsc --noEmit` clean | ✅ PASS |
| Tests | 987/987 passing | ✅ PASS |

## Findings

### Critical (must fix before merge)
_None._

### Warnings (should fix)

- **[WARNING W-A] `(OAuth)` rendered as `(oauth)` — `toLowerCase()` over-normalises the acronym.**

  `SettingsModal.tsx:384`:
  ```tsx
  {mmxBusy ? 'Opening…' : `or ${mmxOauthLabel.toLowerCase()}`}
  ```
  `mmxOauthLabel` is defined (lines 326–328) as `'Sign in via terminal (OAuth)'` / `'Install + sign in via terminal (OAuth)'` — capitalised correctly. `.toLowerCase()` was intended to sentence-case the first letter (`Sign` → `sign`) but downcases the entire string, collapsing `(OAuth)` to `(oauth)`. The brief's V3 table and the inline comment block at lines 314–318 both use `(OAuth)`.

  OAuth (OAuth 2.0) is a proper protocol name; lowercasing it is incorrect branding.

  **One-line fix** — replace `.toLowerCase()` with first-char lowercase only:
  ```diff
  - {mmxBusy ? 'Opening…' : `or ${mmxOauthLabel.toLowerCase()}`}
  + {mmxBusy ? 'Opening…' : `or ${mmxOauthLabel.charAt(0).toLowerCase()}${mmxOauthLabel.slice(1)}`}
  ```
  Renders `or sign in via terminal (OAuth)` and `or install + sign in via terminal (OAuth)` — matching the brief and the comment block exactly.

### Info

- **[INFO I-1] `handleMmxCardClick` unconditionally fires `handleMmxSetup` (by design).**
  Since commit `96d271e` the MMX card always opens the tmux CLI on click, even when already authenticated. The comment in the click handler (lines 668–673) documents the rationale. The card also carries `aria-pressed={selected}` (line 690), which semantically implies a toggle rather than an "open" action — minor ARIA mismatch, acceptable for the scope of this pass. Noted for a follow-up accessibility polish.

- **[INFO I-2] `mmxSetupBlock` is a JSX element, not a function — correct given mutual exclusion.**
  Because the hoisted CTA (`activeAiAgent !== 'mmx'`) and the active-agent panel (`activeAiAgent === 'mmx'`) are provably mutually exclusive, only one render site is ever active at a time. Sharing a JSX value rather than a component is fine here — React instantiates it independently at each position, and there is no risk of duplicate DOM.

- **[INFO I-3] Shared state (`mmxApiKey`, `mmxError`, `mmxJustAuthed`) persists across the active-agent switch.**
  If a user types a key in the hoisted CTA then selects MMX as active agent, the same key is visible in the active-agent panel's `mmxSetupBlock`. This is correct and intentional — no state is lost on the switch. No action required.

- **[INFO I-4] V8 intentionally reverses QA W-1 from `MMX-CARD-SETUP-FIX`.**
  The brief references commit `75e0c85` and explicitly expects setup to fire during the loading window. The prior W-1 finding (no-op during null) has been superseded by the discoverability requirement. Noted for history.

## Scope Check

- [IN-SCOPE] `mmxSetupBlock` shared JSX value, both render sites — verified ✅
- [IN-SCOPE] `postMmxSetup` / `handleMmxApiKeySave` / `handleMmxSetup` / `refreshMmxStatus` — verified ✅
- [IN-SCOPE] `mmxJustAuthed` auto-clear effect — verified ✅
- [IN-SCOPE] Hoisted CTA + active-agent panel mutual exclusion — verified ✅
- [IN-SCOPE] V3 caption / OAuth link microcopy — verified (W-A found)
- [OUT-OF-SCOPE] `app/api/mmx/setup/route.ts`, `lib/mmx-client.ts`, `useMmxAvailability.ts` — covered by MMX-AUTO-INSTALL-3STATE-VERIFY, unchanged in this pass

## Gate Decision

**[CONCERNS — 0.88]** — 9 of 10 criteria pass exactly per spec. V3 passes functionally (the correct label text is computed) but fails on rendering: `.toLowerCase()` collapses `(OAuth)` to `(oauth)` in the tmux link button, deviating from the brief's table and the inline comment. All setup, error, success, timing, and Pi-panel criteria are correct. The fix is a single-line change. Merge acceptable with W-A patched first; it is the only deviation from the decisions doc.
