# v1.0.5 Backlog — MashupForge

> Pre-ranked candidates for v1.0.5, from the HANDOFF.md handoff.
> Re-prioritize as new info comes in.

## Status

| ID | Item | Days | Status |
|---|---|---|---|
| **C** | Pre-existing CI cleanup | 1 | **Starting next** (v1.0.6) |
| **A** | Higgsfield prompt engineering v2 | 3-5 | Backlog (v1.0.5.x) |
| **D** | Per-cycle credit budget | 2-3 | Backlog (v1.0.5.x) |
| — | Long-form video with recurring character | 5-7 | Deferred to v1.0.6 |

## C — CI cleanup (v1.0.6, starting now)

The 1-day fix to get the baseline green again.

### C.1 — `brand-guards.yml` failing

**Symptom:** workflow fails on push because
`.hermes/subagents/designer/memory.md` contains the legacy name
"Multiverse Mashup Studio".

**Fix:** add `.hermes/` to the workflow's `paths-ignore`. It's a
sub-agent memory file from the previous orchestrator setup, not
a user-facing path.

**File:** `.github/workflows/brand-guards.yml`

### C.2 — ~37 ESLint `as any` errors

**Symptom:** `bunx eslint .` reports ~37 `as any` errors in
`useReconciler`, `useSettings`, `lib/persistence`. The current
regex is too strict — it flags comments and error-path narrows
that aren't real type holes.

**Fix:** tighten the regex in `eslint.config.mjs` to flag only
real type holes. If a flagged `as any` is genuinely needed, the
author must add a `// eslint-disable-next-line` with a
justification comment and a TODO with a target date.

**Files:** `eslint.config.mjs`, `hooks/useReconciler.ts`,
`hooks/useSettings.ts`, `lib/persistence/*`

### C.3 — Ship as v1.0.6

Use `scripts/release.sh 1.0.6` to bump + changelog, push, tag,
let the workflow build. Maurice pastes the highlights into the
GitHub Release body.

**Why a patch (1.0.6) and not a minor (1.0.5)?** The change
is CI-only; no user-facing behavior changes. Patch is the
correct semver.

## A — Higgsfield prompt engineering v2 (v1.0.5.x, 3-5 days)

The big user-facing win. Research is already done in
`docs/research/higgsfield-skills/`.

### A.1 — SLCT framework in image prompt builder

Integrate SLCT (Surface / Lumina / Capture / Texture) framework
into `lib/image-prompt-builder.ts` as a `promptStyle: 'slct' |
'legacy'` option.

**Source:** `docs/research/higgsfield-skills/banana-pro-director/`

**Acceptance:**
- SLCT prompt builder passes property-based test
- A/B comparison: SLCT vs legacy on a 10-prompt fixture
- Bundle size impact < 10 KB gzipped
- Setting picker in `components/Settings/`

### A.2 — MCSLA formula for video

Integrate MCSLA (Model · Camera · Subject · Look · Action) for
`higgsfieldOptions` video inputs.

**Source:** `docs/research/higgsfield-skills/cinema-world-builder/`

**Acceptance:**
- MCSLA video prompt builder passes property-based test
- Camera angle + subject type + look picker work end-to-end
- Video gen route accepts the new payload

### A.3 — 14-angle camera catalog as Settings picker

**Source:** `docs/research/higgsfield-skills/.../camera-angles.md`

**Acceptance:**
- 14 angles available in the camera angle picker
- Selected angle flows through SLCT + MCSLA builders
- Per-angle preview / description visible in the picker UI

### A.4 — Anti-AI-look negative prompts by default

Add a curated list of anti-AI negative prompts to the default
image prompt payload. Toggleable in Settings.

**Acceptance:**
- Default negative prompt list ships with the integration
- Toggle in Settings (off by default? on by default? — decide
  with the user)
- Negative prompts appear in the prompt preview in the studio

## D — Per-cycle credit budget (v1.0.5.x, 2-3 days)

Cap the Higgsfield usage per billing cycle.

### D.1 — Settings field

Add `higgsfieldMonthlyCreditCap` to `UserSettings`.

### D.2 — IDB counter

Add `higgsfieldCreditsUsedThisCycle` IDB counter. Increments
on every Higgsfield image/video gen.

### D.3 — Low-credit banner

Pipeline tab shows a banner when usage approaches the cap.

### D.4 — Hard-fail at cap

When cap is hit, hard-fail with a clear message. Settings has
an "Override for this cycle" escape hatch.

**Acceptance:**
- Cap + counter + banner + hard-fail all wired end-to-end
- Property-based test for counter increments
- Test for the override escape hatch

## Deferred to v1.0.6

### E — Long-form video with recurring character (5-7 days)

The 3-step character template workflow from the v1.0.4
highlights:
1. Lock character with feedback loop (Soul Pack)
2. Multi-angle template (front / side / back / hands / nails /
   profile)
3. Scene still as image → video

**Acceptance:**
- Soul Pack library saves character compositions
- Pipeline integration: lock character → multi-angle → scene
  still → video
- All 6 angles in the template
- The full flow ships end-to-end on a 1-shot character


