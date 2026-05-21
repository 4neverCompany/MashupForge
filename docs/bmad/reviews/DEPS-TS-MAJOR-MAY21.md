# DEPS-TS-MAJOR-MAY21 — TypeScript 5.9.3 → 6.0.3 upgrade research

**Task:** Evaluate upgrading TypeScript from 5.9.3 → 6.0.3 (major bump).
**Verdict:** **CONDITIONAL SAFE** — one tsconfig change required, no source-code changes, no toolchain conflicts.
**Confidence:** 0.95 (empirical: tested with TS 6.0.3 actually installed; tsc + full 1024-test suite green).

## Empirical findings

I temporarily installed `typescript@6.0.3` against the current `main` (commit `40a9545`) and ran `tsc --noEmit` plus the full vitest suite. Results:

| Check | Result |
|---|---|
| `npx tsc --noEmit` (raw) | **1 error** — `TS5101: Option 'baseUrl' is deprecated and will stop functioning in TypeScript 7.0` |
| `npx tsc --noEmit --ignoreDeprecations 6.0` | **0 errors** |
| `npx tsc --noEmit --noUncheckedSideEffectImports --ignoreDeprecations 6.0` | **0 errors** (CSS side-effect imports unaffected) |
| `npx vitest run` (full suite) | **1024/1024 passed** |

After verifying, I restored `package.json` + `package-lock.json` from git (`git checkout`), and the working tree is clean. No code committed; this file is the research deliverable.

## Why so few breaks: tsconfig already 6.0-aligned

Current `tsconfig.json` explicitly sets every option whose default changed in 6.0, so the major default-shift doesn't touch us:

| Option | TS 5.x default | TS 6.0 default | Our setting |
|---|---|---|---|
| `strict` | `false` | `true` | `true` (explicit) ✓ |
| `module` | `commonjs` | `esnext` | `"esnext"` (explicit) ✓ |
| `target` | `es5` | `es2025` | `"ES2017"` (explicit) ✓ |
| `moduleResolution` | inferred | `bundler`/`nodenext` | `"bundler"` (explicit) ✓ |
| `esModuleInterop` | `false` | always-on | `true` (explicit) ✓ |
| `noUncheckedSideEffectImports` | `false` | `true` | (default, but our CSS imports pass anyway) ✓ |
| `types` | `["*"]` | `[]` | (default, but Next.js generates `next-env.d.ts` references) ✓ |

The only mismatch is `baseUrl: "."`, which 6.0 deprecates (still functional, errors at TS 7.0).

## Toolchain compatibility

| Package | Version | TS 6.0 compatible? |
|---|---|---|
| `next` | 16.2.6 | yes (modern Next supports any 5.x/6.x) |
| `react` | 19.2.6 | type-defs version-agnostic |
| `@types/react` | ^19 | type-defs version-agnostic |
| `@types/node` | ^20.19.41 | version-agnostic |
| `eslint` | ^9.39.4 | not TS-version-coupled |
| `eslint-config-next` (transitively pulls `@typescript-eslint/*`) | latest | **peerDep is `typescript >=4.8.4 <6.1.0`** → 6.0.x is in-range ✓ |
| `vitest` | ^4.1.7 | uses TS only for type-stripping; version-agnostic |
| `ts-api-utils` | (transitive) | peerDep `>=4.8.4`, no upper bound ✓ |

No package in the dep tree pins `<6.0.0` for TypeScript. The tightest constraint is `@typescript-eslint/*`'s `<6.1.0`, which still admits 6.0.x.

## Source-code scan

Searched for every 6.0-removed pattern across `.ts` and `.tsx` (excluding node_modules / dist):

| Removed / errored in 6.0 | Hits |
|---|---|
| `import ... assert { ... }` (must become `with`) | **0** |
| Legacy `module Foo {}` namespace keyword | **0** |
| `outFile` in tsconfig | **0** |
| `amd-module` reference | **0** |
| `moduleResolution: "classic"` | **0** |
| `module: "amd" / "umd" / "systemjs" / "none"` | **0** |

The codebase uses none of the removed syntax.

## The one required change

`tsconfig.json` needs one of two fixes for the `baseUrl` deprecation:

**Option A — silence (minimal, recommended for this bump):**
```diff
   "compilerOptions": {
+    "ignoreDeprecations": "6.0",
     "target": "ES2017",
     ...
     "baseUrl": ".",
```
Postpones the proper fix until TS 7.0 ships. Zero behavior change.

**Option B — remove `baseUrl`, use absolute paths in `paths`:**
```diff
-    "baseUrl": ".",
     "paths": {
-      "@/*": ["./*"]
+      "@/*": ["./*"]
     }
```
Under `moduleResolution: "bundler"`, `paths` resolves from the tsconfig directory without needing `baseUrl`. Confirmed working in TS 6.0 docs but warrants a follow-up tsc run to verify Next.js's TS plugin doesn't rely on the explicit `baseUrl`.

**Recommendation:** Option A for the v0.9.42 release window — fastest, lowest risk, leaves the proper fix for the eventual TS 7.0 bump when it'll be forced anyway.

## Exact upgrade command

```bash
# Apply the bump (devDependency):
npx npm-check-updates --filter typescript -u
npm install

# Apply the tsconfig.json patch (Option A above) — single field add.

# Verify:
npx tsc --noEmit && npx vitest run
```

Equivalent npm-only path:
```bash
npm install --save-dev typescript@^6.0.3
```

## Risks I considered but ruled out

- **CSS side-effect imports tripping `noUncheckedSideEffectImports: true`** — empirically tested with the flag explicitly enabled; zero errors. Next.js's `next-env.d.ts` covers the ambient declarations.
- **`types: []` default change breaking ambient `@types/*` loading** — codebase imports every type explicitly via ES modules; no ambient-only `@types` reliance. Verified by zero new errors after the install.
- **`@typescript-eslint/*` blocking the bump** — peerDep range `>=4.8.4 <6.1.0` admits 6.0.x cleanly.
- **`baseUrl` removal breaking `@/*` path resolution at runtime** — only deprecated in 6.0, still functional. Next.js bundler resolves `@/*` via its own webpack/turbopack config independent of `baseUrl`.

## Out of scope (deferred follow-up)

- **TS 7.0 prep:** `baseUrl` will stop functioning in TS 7.0. Plan Option B (or a Next.js-equivalent path config) before that bump lands.
- **`@typescript-eslint/*` next major:** When `@typescript-eslint` cuts a version with peerDep `<6.2.0` or wider, we should refresh `eslint-config-next` to pick it up.
