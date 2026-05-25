# DEPS-ESLINT-PATCH — BLOCKED

**Date:** 2026-05-24  
**Task:** Bump eslint 9.39.4 → 10.4.0  
**Status:** BLOCKED — revert complete, repo clean

---

## What was attempted

`npm install eslint@10.4.0 --save-dev` as instructed.

## What went wrong

### 1. ESLint 10.4.0 does not install cleanly

npm reported success but also:
- 3× `ERESOLVE overriding peer dependency` warnings
- 131 packages removed, 147 changed (catastrophic for a single dep bump)
- `node_modules/eslint` did not exist after install

`npm ls eslint` returned `(empty)`. The `node_modules/.package-lock.json` had no entry for `node_modules/eslint`. ESLint was simply not installed, despite being in `package.json` and `package-lock.json`.

### 2. `eslint-config-next@16` peer dep conflict

The ERESOLVE warnings point to `eslint-config-next` still declaring `eslint@^9` as a peer. npm overrode the conflict rather than erroring — and the resolution dropped eslint entirely instead of downgrading. This directly contradicts the task body's claim that "eslint-config-next@16 supports ESLint 10."

### 3. Semver classification mismatch

The task JSON says `"type": "patch"`. A 9.x → 10.x bump is **semver-major**. Per fleet routing rules, major dep bumps are Complex and require a proposal, not self-assignment. The task body's framing as "patch" is incorrect.

## Recovery

1. `git checkout -- package.json package-lock.json` — lockfile restored
2. `npm ci --ignore-scripts` failed to reinstall eslint (npm bug/state issue)
3. `bun install` — restored eslint@9.39.4 and all 565 packages ✅
4. `git checkout -- package-lock.json` — cleaned npm-generated drift
5. Final state: clean tree, `eslint@9.39.4` in node_modules, 1089/1089 passing ✅

## Recommendation

Before re-attempting, Hermes should verify:
1. `npm show eslint@10.4.0` — does this version actually exist?
2. `npm show eslint-config-next@16 peerDependencies` — does it list `eslint@^10`?
3. If confirmed, try `npm install eslint@10.4.0 --save-dev --legacy-peer-deps` as an alternative approach
4. Re-classify as **Complex** in any re-dispatch (major version bump)

---

# DEPS-ESLINT-FIX — BLOCKED (second attempt, 2026-05-24)

## Diagnosis findings

### Root cause 1 — NODE_ENV=production
`npm install` never installs devDependencies when `NODE_ENV=production` (set globally in this environment). All previous npm-based install attempts silently skipped eslint. Fix for future npm installs: prefix with `NODE_ENV=development`.

### Root cause 2 — eslint-plugin-react@7.x API incompatibility (hard blocker)
After installing eslint@10.4.0 with `NODE_ENV=development --legacy-peer-deps`, lint failed immediately:

```
TypeError: Error while loading rule 'react/display-name': contextOrFilename.getFilename is not a function
```

`eslint-plugin-react@7.x` calls `context.getFilename()` — an API **removed** in ESLint 10. This is a runtime crash, not a warning. The latest available version is `7.37.5`; no `8.x` exists. Since `eslint-config-next@16` transitively requires `eslint-plugin-react@7.x`, there is no path to ESLint 10 with the current dep tree.

### Peer dep warnings (ERESOLVE) — NOT the primary cause
Three packages have stale peer dep ranges that stop at `^9`:
- `eslint-plugin-import`
- `eslint-plugin-jsx-a11y`  
- `eslint-plugin-react`

These can be bypassed with `--legacy-peer-deps`. However the `eslint-plugin-react` API incompatibility is what actually crashes lint at runtime.

### Secondary issue — nested hermes-agent/ui-tui/eslint.config.mjs
ESLint 10 discovered and attempted to load `hermes-agent/ui-tui/eslint.config.mjs`, which imports packages not in the main project's node_modules. This is fixable by adding `{ ignores: ["hermes-agent/**"] }` to the root `eslint.config.mjs` — but moot until the plugin-react issue is resolved.

## Recommendation

**ESLint 10 upgrade is blocked until:**
1. `eslint-plugin-react@8.x` is released with ESLint 10 support (`context.getFilename()` → `context.filename`), OR
2. `eslint-config-next` updates to a version that no longer depends on `eslint-plugin-react@7.x`

Watch: https://github.com/jsx-eslint/eslint-plugin-react/issues for ESLint 10 tracking issue.
Pin eslint to `^9` in the meantime (already the case).
