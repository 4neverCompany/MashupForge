# Testing Policy — MashupForge

> Cross-project test policy lives in the global **`qa`** agent's
> `agent.md`. This file is the MashupForge-specific addendum
> (the test bar, the framework choices, the project gotchas).

## Bar

**1,243 tests pass at HEAD.** Any change that drops the count is a
regression — fix the code, not the test (unless the test was
checking a now-removed behavior; commit message must say so).

## Framework

- **Runner:** Vitest 4
- **DOM:** happy-dom (NOT jsdom — that was v1.0.2 and is gone)
- **Component testing:** `@testing-library/react` +
  `@testing-library/user-event`
- **IndexedDB:** `fake-indexeddb`

## Test layout

```
tests/
  lib/         # bulk of the suite (~1,200 tests)
  components/  # React component tests
  api/         # API route tests
```

Co-located test files use `*.test.ts` / `*.test.tsx`. The
co-location pattern is **not** used here — everything lives under
`tests/`.

## Project-specific rules

### State machine changes → property-based

The post-lifecycle state machine is the v0.9.41 fix. Any change
to `lib/post-lifecycle/` must ship with a property-based test
that calls every (state, transition) pair and asserts the post
body always contains `hostedImageUrl`. The v0.9.41 failure mode
(post record written, hosted URL write crashes) must also have a
regression test that asserts the system surfaces the failure,
not a silent orphan.

### AES-GCM tampering → flip middle byte

For the Higgsfield token store (`lib/higgsfield/token-store.ts`),
flip a byte in the **MIDDLE** of the ciphertext segment, not the
last char. Last-char flips can land on a valid GCM tag because
base64url is 6-bit aligned and the tag is truncated. The handoff
gotcha list §9.2 calls this out — same gotcha applies to any
crypto with packed-format encoding.

### Reconciler → focus + 30s

`hooks/useReconciler.ts` fires on focus and a 30s timer. Both
triggers must be tested. Don't disable either without a test
proving the alternative works.

### IDB + SQLite parity

Every storage test runs in both backends. The web build and the
Tauri build are the same product — storage features that work
on one must work on the other.

### Anti-`as any`

Production code: no `any`, no `as any`. The ESLint config flags
both. If you genuinely need an escape hatch, document it in a
comment and add a TODO with a target date. The `as any` regex
in CI is being tightened in v1.0.5.1 to flag only real type
holes (not comments or error-path narrows).

## Commands

```bash
bunx vitest run                # full suite
bunx vitest run --watch        # watch mode
bunx vitest run tests/lib/post-lifecycle  # one subtree
bunx tsc --noEmit              # typecheck only (no tests)
```

## Precommit

`simple-git-hooks` runs `tsc --noEmit && vitest run` on
`git commit`. Slow (~3 min) but catches real issues. Use
`--no-verify` for quick commits; CI re-runs the same check.

## CI

- **`.github/workflows/ci.yml`** — lint + typecheck + test on
  every push.
- **`.github/workflows/pr-checks.yml`** — per-PR vitest + bundle
  size check.
- **`.github/workflows/brand-guards.yml`** — legacy-name grep
  (failing as of HEAD; fixed in v1.0.5.1 by adding `.hermes/` to
  `paths-ignore`).
- **`.github/workflows/tauri-windows.yml`** — release pipeline.
  Includes the version-parity check.
