# Release Process — MashupForge

> Cross-project release rules: use the project's release script,
> bump all version files in one go, push, tag, let the workflow
> build. Don't hand-edit version files.

## The 5-step release

### Step 1 — Bump versions + auto-gen changelog

```bash
bash scripts/release.sh 1.0.5
```

This does:
1. Bumps `package.json` + `Cargo.toml` + `tauri.conf.json` to
   `1.0.5` (all three — the parity gate fails the workflow if
   they don't match).
2. Auto-gens `CHANGELOG.md` sections (`Added`, `Fixed`,
   `Changed`, `Docs`, `Tests`) by walking conventional-commit
   subjects since the last tag.
3. Splices `docs/changelog-highlights/1.0.5.md` as `h3` under
   the version `h2`, demoting the highlights file's `H2`s to
   `H4`.
4. Creates one commit: `chore(release): v1.0.5`.

If the highlights file `docs/changelog-highlights/<ver>.md`
doesn't exist, the script fails. **Create the highlights file
FIRST** (see step 1.5).

### Step 1.5 — Write hand-curated highlights (Maurice)

`docs/changelog-highlights/<ver>.md`. This is the bit the user
actually reads. The auto-generated sections are noise; the
highlights are the value. Maurice writes these, not the agent.

The release script splices the highlights file's content as `h3`
under the version `h2`. Use `h2` for major sections inside the
highlights file (they become `h4` after splicing) and `h1` for
the file title (becomes `h2`).

### Step 2 — Push + tag

```bash
git push origin main
git tag v1.0.5 && git push origin v1.0.5
```

### Step 3 — Workflow runs

`.github/workflows/tauri-windows.yml` triggers on `tags: ['v*.*.*']`.

The workflow:
1. Checks version parity (Ubuntu job, ~30s).
2. Builds Next.js standalone (`bun run build` →
   `.next/standalone`).
3. Builds the Tauri NSIS installer (`bunx tauri build`).
4. Strips `node_modules` from the standalone bundle (Tauri's
   `frontendDist` rejects paths containing `node_modules`).
5. Uploads 4 assets to a draft GitHub Release.

`release.yml` was deleted in commit `24959ba` — it was a
duplicate that created empty draft releases. The canonical
pipeline is `tauri-windows.yml`.

### Step 4 — Maurice pastes highlights into the release body

The workflow creates a draft release with a placeholder body.
**Maurice pastes the content of
`docs/changelog-highlights/<ver>.md` into the release body**
(overwrite the auto-generated one). Then publish.

This step is manual and lives outside the agent loop.

### Step 5 — Confirm + smoke test

After the release is published:
1. Download the Windows installer from the release page.
2. Install on a clean Windows VM (or the user's machine).
3. Confirm the webview boots at `/studio` (not the landing
   root — that was the v1.0.2 regression).
4. Confirm the auto-updater sees the new version (existing
   users get the update banner on next launch).

## Version-parity gate

The workflow's "Check version parity with tag" step fails the
build if any of:
- `package.json.version` !== `src-tauri/tauri.conf.json.version`
- `package.json.version` !== `src-tauri/Cargo.toml.version`
- `package.json.version` !== `tag.slice(1)`

`scripts/release.sh` bumps all three in one go. **Use the
script.** Hand-editing one and forgetting the others will fail
the workflow.

## Things that have broken releases before

These are documented in `HANDOFF.md` §9.1; keep them in mind:

- **Bun does not populate `node_modules/.bin`** — use
  `bunx tauri build`, not `npx tauri build`. The workflow has
  an npm fallback for the rare case.
- **PowerShell on `windows-latest`** defaults to `pwsh`. Steps
  using `2>/dev/null` or `||` must set `shell: bash`, or
  `2>/dev/null` becomes a literal `D:\a\_temp\dev\null` path.
  Fixed in `commit 3a7608f`.
- **Tauri `frontendDist`** rejects paths containing
  `node_modules`. Strip after copying.
- **`tauri build --target nsis`** fails: `nsis` is not a Rust
  target triple. Use bare `tauri build` (we have
  `bundle.targets: ['nsis']` in `tauri.conf.json`).
- **`bun install --frozen-lockfile`** is strict. After dropping
  deps, delete `bun.lock` and re-run `bun install`.

## Security flag

The handoff commit `fcb30d3` caught a hardcoded GitHub PAT in
4 superseded release scripts under `docs/working-folder/scripts/`.
The scripts were rewritten to read `GITHUB_TOKEN` from env, and
they pushed clean. But the leaked PAT is still out there in
local history / shell env / wherever it was before. **Maurice
should rotate it.** See `HANDOFF.md` for the warning.

## Quick reference

```bash
# 1.5. Write highlights (manual, Maurice)
$EDITOR docs/changelog-highlights/1.0.5.md

# 1. Bump + changelog
bash scripts/release.sh 1.0.5

# 2. Push + tag
git push origin main
git tag v1.0.5 && git push origin v1.0.5

# 3-4. Wait for workflow, paste highlights into release body

# 5. Smoke test
# Download installer, install on Windows, confirm /studio boots
```
