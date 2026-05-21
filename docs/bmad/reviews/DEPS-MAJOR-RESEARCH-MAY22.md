# DEPS-MAJOR-RESEARCH-MAY22 — @types/node 20→25 + eslint 9→10

**Task:** Empirically evaluate two outstanding major bumps.
**Method:** Same protocol as DEPS-TS-MAJOR-MAY21 — temporarily install the target version, run `tsc --noEmit` + full vitest, capture failures, roll back from git.

## Recommendations

| Dep | Verdict | Confidence | Notes |
|---|---|---|---|
| `@types/node` 20.19.41 → 25.9.1 | **SAFE — bump** | 0.95 | tsc clean, 1066/1066 tests green. No source code changes required. |
| `eslint` 9.39.4 → 10.4.0 | **DEFER** | 0.95 | `eslint-plugin-react` (transitive via `eslint-config-next`) crashes with `contextOrFilename.getFilename is not a function`. Blocker is upstream — needs `eslint-config-next` to ship plugin versions that support eslint 10's API. |

---

## `@types/node` 20.19.41 → 25.9.1

### Empirical test

```bash
npm install --save-dev @types/node@25.9.1
npx tsc --noEmit       # → exit 0, no output
npx vitest run          # → Test Files 92 passed, Tests 1066 passed
git checkout package.json package-lock.json
npm install
```

Zero TypeScript errors. Zero test failures. The bump is purely a type-definition refresh — no runtime impact, no source-code changes.

### Why so safe

Two reasons our codebase doesn't care which `@types/node` major is installed:

1. **The compiler `target` and `lib` in `tsconfig.json` are explicit** (`"target": "ES2017"`, `"lib": ["dom", "dom.iterable", "esnext"]`). The Node lib comes through `@types/node`'s declarations — adding newer Node 25 APIs to that doesn't deprecate or remove anything we use.
2. **We use a narrow Node API surface**: `fs` / `path` / `process.env` / `Buffer` / `AbortSignal.timeout` / web `fetch`. All of these have stable types across Node 20-25. New Node 25 APIs (e.g. `node:sqlite`, expanded `import.meta`) aren't imported anywhere in our code.

### Real-world consideration NOT caught by tsc

Bumping `@types/node` to 25 enables IDE autocomplete for APIs that exist only in Node 25 (e.g. `node:sqlite`, certain `fs/promises` additions). A developer using those would compile fine but crash at runtime under Node 20 on Vercel / in the Tauri sidecar. This is a **process risk, not a code risk** — covered by code review.

### Apply command

```bash
npm install --save-dev @types/node@^25.9.1
```

---

## `eslint` 9.39.4 → 10.4.0

### Empirical test

```bash
npm install --save-dev eslint@10.4.0
# npm warn ERESOLVE overriding peer dependency      (×3)
# added 10 packages, removed 39 packages, changed 14 packages
npx eslint lib/errors.ts
# ESLint: 10.4.0
# TypeError: Error while loading rule 'react/display-name':
#   contextOrFilename.getFilename is not a function
#     at resolveBasedir (.../node_modules/eslint-config-next/node_modules/
#                        eslint-plugin-react/lib/util/version.js:31:100)
#     at detectReactVersion
#     at getReactVersionFromContext
#     ...
git checkout package.json package-lock.json
```

### Root cause

eslint 10 removed the deprecated `context.getFilename()` method (it's a `getter` on `context.physicalFilename` / `context.filename` now). `eslint-plugin-react` (the version pinned inside `eslint-config-next`) still calls the old API. Every JS/TS file lint fails before a single rule runs.

### peerDep audit (from the project's current `package-lock.json`)

| Transitive plugin | peerDep on `eslint` | Supports v10? |
|---|---|---|
| `@typescript-eslint/parser` | `^8.57.0 \|\| ^9.0.0 \|\| ^10.0.0` | ✓ |
| `@typescript-eslint/eslint-plugin` | `^8.57.0 \|\| ^9.0.0 \|\| ^10.0.0` | ✓ |
| `eslint-config-next` | `>=9.0.0` | nominal yes, but its bundled plugins disagree |
| `eslint-plugin-import` | `... \|\| ^9` | **✗** (no v10 in the union) |
| `eslint-plugin-jsx-a11y` | `... \|\| ^9` | **✗** |
| `eslint-plugin-react` | `... \|\| ^9.7` | **✗** (and crashes at runtime) |
| `eslint-plugin-react-hooks` | `... \|\| ^10.0.0` | ✓ |

Three plugins gate the bump. `eslint-plugin-react` is the one that hard-crashes; the other two emit warnings but might break in other ways once they're actually exercised.

### Why we can't fix this locally

The plugins are bundled by `eslint-config-next`. We can't selectively bump the inner plugin versions without forking the config — and even then, `eslint-plugin-react` itself needs to ship a fix for the `getFilename` removal (this is an upstream issue, not something we can patch around with config).

The fix path is upstream:
- Wait for Next.js to publish an `eslint-config-next` whose bundled `eslint-plugin-react` / `eslint-plugin-jsx-a11y` / `eslint-plugin-import` versions support eslint 10's API.
- OR (lower priority) replace `eslint-config-next` with hand-rolled rules — not worth it just to bump eslint.

### Failure mode without a bump

`eslint` 9.39.4 is stable, supported, and our entire toolchain is built around it. Lint runs clean today. There is no security advisory or feature in eslint 10 that we depend on. Deferring costs nothing in the near term.

### Apply command (NOT recommended right now)

```bash
# Would require either an upstream fix or a config-next replacement first.
# Do NOT run this until eslint-config-next supports eslint 10.
npm install --save-dev eslint@^10.4.0
```

---

## Out of scope (follow-ups flagged)

- **TypeScript 7.0 prep** — `baseUrl` deprecation in `tsconfig.json` is silenced via `"ignoreDeprecations": "6.0"` (from `DEPS-TS-MAJOR-MAY21`). When TS 7.0 lands, `baseUrl` must be removed and `paths` config rewritten.
- **`eslint-config-next` migration watch** — track when Next.js publishes a release whose bundled eslint plugins support eslint 10. Re-run this research at that point.
- **`@types/node` 25 + Node 25 runtime alignment** — if we ever bump our deployment Node version, re-test that the Vercel + Tauri sidecar both run on a matching Node.
