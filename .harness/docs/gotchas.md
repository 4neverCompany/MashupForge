# Gotchas — MashupForge

> Things that have bitten us. Read before debugging.

## Build / CI

- **Bun does not populate `node_modules/.bin`.** Use
  `bunx tauri build`, not `npx tauri build`. The
  `tauri-windows.yml` workflow has an npm fallback that handles
  the rare case.
- **PowerShell on `windows-latest`** defaults to `pwsh`. Steps
  need `shell: bash` to use `||`, `2>/dev/null`, etc. Otherwise
  `2>/dev/null` becomes a literal `D:\dev\null` path. Fixed in
  `commit 3a7608f`.
- **Tauri `frontendDist`** rejects paths containing
  `node_modules`. Next.js standalone ships its own; strip it
  after copying (`rm -rf src-tauri/frontend-stub/node_modules`).
- **`tauri build --target nsis`** fails: `nsis` is not a Rust
  target triple. Use bare `tauri build` when
  `tauri.conf.json` has `bundle.targets: ['nsis']` (which we
  do).
- **`bun --frozen-lockfile` is strict** — `bun.lock` must
  match `package.json` exactly. After dropping deps, delete
  `bun.lock` and re-run `bun install`.
- **`.hermes/` should be excluded from brand-guard CI.**
  `.hermes/subagents/designer/memory.md` contains the legacy
  name "Multiverse Mashup Studio" — that's a sub-agent memory
  file, not user-facing. The `brand-guards.yml` workflow is
  fixed in v1.0.5.1 to add `.hermes/` to `paths-ignore`.

## Higgsfield / Next.js 16 / React 19

- **Status route MUST live at
  `app/api/higgsfield/status/[requestId]/route.ts`** (the
  bracket dir must exist for dynamic segments).
- **`context.params` MUST be typed
  `{ params: Promise<{ requestId: string }> }`** in the dynamic
  route handler, or `next build` fails with a confusing
  constraint error.
- **React 19 `react-hooks/set-state-in-effect`** — wrap
  `setState` calls in `queueMicrotask` to defer out of the
  effect body. The load indicator still appears in the same
  browser frame.
- **AES-GCM tampering test** — flip a byte in the MIDDLE of
  the ciphertext segment, not the last char. Last-char flips
  occasionally land on a valid GCM tag because base64url is
  6-bit aligned and the tag is truncated.
- **OAuth uses dynamic client registration + PKCE S256.**
  Don't hardcode a client ID; the registration happens on
  first connect at `mcp.higgsfield.ai/oauth2/register`.
- **Tokens are AES-GCM encrypted at rest in IDB.** Format
  `v1.<iv>.<tag>.<ciphertext>`. Never write tokens to
  localStorage, never log them.

## Post-lifecycle

- **A post without `hostedImageUrl` cannot exist by
  construction** — the state machine's atomic write ensures
  this. If you see one, the state machine is broken, not the
  data.
- **Reconciler** runs on every focus event and on a 30s
  timer. Don't disable it without understanding the
  consequences.
- **Dual-backend parity** — every storage change must work
  on both IndexedDB (web) and SQLite (desktop). The web build
  and the Tauri build are the same product.
- **Migration is parallel-coexistence, not destructive.** The
  `lib/post-lifecycle/migration.ts` bridge keeps the legacy
  IDB shape readable. The user has production data in the old
  shape.

## Pre-commit hook

- `simple-git-hooks` runs `tsc --noEmit && vitest run` on
  `git commit`. This is slow (~3 min) but catches real issues.
  Use `--no-verify` for quick commits; CI runs the same check
  anyway.

## Case-collision on Windows

- The repo has `docs/bmad/qa/LATEST-REVIEW.md` AND
  `docs/bmad/qa/latest-review.md` (case-insensitive FS
  collision). On Windows, the clone drops one of them. Not a
  real bug — pick the canonical casing and `git rm` the
  duplicate.

## Brand-guard legacy name

- The brand-guard workflow flags the string "Multiverse Mashup
  Studio" anywhere in the repo. The string lives legitimately
  in `.hermes/subagents/designer/memory.md` (a sub-agent
  memory file from the previous orchestrator setup). Add
  `.hermes/` to `paths-ignore` in the workflow — see
  `.github/workflows/brand-guards.yml` (v1.0.5.1 fix).

## Security (HANDOFF.md §commit fcb30d3)

- A hardcoded GitHub Personal Access Token was found in 4
  superseded release scripts in `docs/working-folder/scripts/`.
  The scripts have been rewritten to read from `GITHUB_TOKEN`
  env var. The leaked token (full repo access) is still out
  there in the user's local history / shell env. **Rotate
  it.**
