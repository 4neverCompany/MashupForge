---
paths:
  - "package.json"
  - "src-tauri/Cargo.toml"
  - "src-tauri/tauri.conf.json"
  - "src-tauri/Cargo.lock"
  - "scripts/release.sh"
  - ".github/workflows/tauri-windows.yml"
  - "CHANGELOG.md"
---

# MashupForge release flow

`scripts/release.sh <ver>` bumps the **three** project-version files (`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`), refreshes `bun.lock`, regenerates `CHANGELOG.md` from conventional-commit subjects, and commits as `chore(release): v<ver>`.

But it does **not** touch `src-tauri/Cargo.lock`. The lockfile's `app` package version (line ~80) stays at the previous release, and the next tag-push trips the version-parity check in `tauri-windows.yml:48-64` ("Internal version mismatch — files don't agree with each other").

## The canonical release sequence

```bash
# 1. Bump everything release.sh knows about + commit.
bash scripts/release.sh 0.9.X

# 2. Bring Cargo.lock along. release.sh leaves it stale.
cd src-tauri && cargo update -p app && cd ..

# 3. Companion commit (do not amend — CLAUDE.md forbids amending).
git add src-tauri/Cargo.lock
git commit -m "chore(release): refresh Cargo.lock for v0.9.X"

# 4. Push + tag. The tag-push triggers tauri-windows.yml.
git push origin main
git tag -a v0.9.X -m "Release v0.9.X"
git push origin v0.9.X

# 5. Watch the build (~25-30 min on Windows-latest).
gh -R Code4neverCompany/MashupForge run watch <run-id> --exit-status
```

## What the workflow checks

`tauri-windows.yml` enforces three invariants at "Check version parity with tag":

1. `package.json.version === src-tauri/tauri.conf.json.version` (same string)
2. `package.json.version === src-tauri/Cargo.toml.version` (same string)
3. `package.json.version === tag.slice(1)` — `v0.9.X` tag, `0.9.X` files

Violating any of these fails the build at the first job step (Ubuntu, ~30 sec). The asset upload job (`upload`) auto-creates the GitHub release if it doesn't exist.

## On workflow_dispatch with `release_tag`

The workflow accepts manual dispatch with an input `release_tag` for "upload to that release instead of the auto-resolved one." But `workflow_dispatch` checks out the **branch ref** it's dispatched from (default `main`), not the tag. So:

- If you dispatch from `main` while `package.json` is at 0.9.X+1, with `release_tag=v0.9.X`, the parity check fails because pkg.version != tag.
- The only way to populate older release assets is a hotfix branch from the old tag that bumps Cargo.toml to match.

## Common pitfalls

- **Amending the release commit** to include Cargo.lock — DON'T. CLAUDE.md forbids amending. Use the companion commit pattern above.
- **Skipping `cargo update -p app`** — workflow's parity check will fail. Confirmed twice this session.
- **Forgetting to push `main` before pushing the tag** — the build will checkout the tag commit and might fail to resolve workspace state.
