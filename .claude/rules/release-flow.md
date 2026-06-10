---
paths:
  - "package.json"
  - "src-tauri/Cargo.toml"
  - "src-tauri/tauri.conf.json"
  - "src-tauri/Cargo.lock"
  - "scripts/release.sh"
  - ".github/workflows/tauri-windows.yml"
  - "CHANGELOG.md"
  - "docs/changelog-highlights/**"
---

# MashupForge release flow

## Batch releases — DON'T tag every change (convention, 2026-06-10)

Each tag triggers a ~20-minute Tauri Windows build AND pushes a forced
auto-update to every desktop user. So **do not cut a release per PR.** The
agreed rhythm (Maurice, 2026-06-10):

1. **Merge** finished PRs to `main` as they go green (CI on the PR is the
   gate). Merging is cheap and does NOT trigger a desktop build — only a
   pushed `v*.*.*` tag does.
2. **Accumulate** related work on `main`. When a coherent bundle is ready —
   a feature + its fixes, or the end of a work session — **propose ONE
   release** and **wait for Maurice's explicit OK** before tagging.
3. Only then run `scripts/release.sh <ver>` + push the tag.

Do NOT tag proactively. A single release that bundles 3–5 merged PRs is the
target, not 5 separate releases. (2026-06-10 shipped v1.5.0→v1.5.2 as three
separate builds in one day — that's exactly what this convention prevents.
Those three stay as-is; the convention applies going forward.) The
`release.sh` empty-bump guard already blocks a no-op release; this rule is
about not over-releasing real-but-small changes.

**Squash-merge titles MUST be conventional-commit formatted** (`feat: …`,
`fix(scope): …`). The empty-bump guard and the CHANGELOG auto-gen parse
commit SUBJECTS on main — a squash commit titled after a prose PR title
("M1: Pipeline fixes…") is invisible to both, and the guard will falsely
abort a real release (happened on v1.6.0, 2026-06-10; shipped via
`ALLOW_EMPTY_RELEASE=1` — the highlights file carried the story). Either
make the PR title conventional, or pass one at merge time:
`gh pr merge N --squash --subject "feat: …"`.

---

`scripts/release.sh <ver>` bumps **all** version files in one shot — `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock` — plus refreshes `bun.lock` and regenerates `CHANGELOG.md` from conventional-commit subjects, committing as `chore(release): v<ver>`.

Before v0.9.40 the script didn't touch `Cargo.lock`, which caused two separate release breakages (v0.9.37 and v0.9.40). A `cargo update -p app` step now runs inside the script after the version bumps so the lockfile's `app` entry tracks `Cargo.toml`.

## The canonical release sequence

```bash
# 0. (Optional but recommended) Write the hand-curated highlights.
#    This is the "what does this release mean for the user" prose that
#    mechanical commit subjects can't capture — migration notes, breaking
#    changes, the 2-4 most-important user-facing changes, credit / pricing
#    notes, etc. If skipped, the CHANGELOG entry will be auto-gen only and
#    the script will print a warning.
cat > docs/changelog-highlights/<ver>.md <<'EOF'
# <ver> — <one-line title>

## 🎬 Highlights

### <one user-facing change>
<why it matters, what to do, link to docs>

### <another change>
<...>

## 🔧 Breaking changes
<none, or "X was removed / changed. See migration.md for the path.">

## 📋 Migration notes
<step-by-step if needed, otherwise "no action required">

## 🙏 Credits
<optional, shout-outs to contributors / inspirations>
EOF
git add docs/changelog-highlights/<ver>.md
git commit -m "docs(changelog): add v<ver> highlights"

# 1. Bump everything + commit. The script splices the highlights file in
#    above the auto-gen sections.
bash scripts/release.sh <ver>

# 2. Push + tag. The tag-push triggers tauri-windows.yml.
git push origin main
git tag -a v<ver> -m "Release v<ver>"
git push origin v<ver>

# 3. Watch the build (~25-30 min on Windows-latest).
gh -R 4neverCompany/MashupForge run watch <run-id> --exit-status
```

If you find yourself making a "refresh Cargo.lock for v<ver>" companion commit after `release.sh`, something regressed in the script — that step should be automatic now.

## Highlights-file workflow

`docs/changelog-highlights/<ver>.md` is the **single source of truth for user-facing release notes**. It is:

- **Hand-curated**, not auto-generated. The author picks the 2-4 most important user-facing changes, writes migration notes, calls out breaking changes, and credits contributors.
- **Pre-release**, committed BEFORE running `release.sh`. The script splices it into the CHANGELOG entry above the auto-gen sections. If the file is missing, the script emits a warning and proceeds with auto-gen only.
- **Idempotent**. Re-running `release.sh` re-emits the auto-gen sections in place and re-splices the highlights. Backfilling the highlights file later + re-running produces the correct final entry.
- **Visible in git log** — the highlights content is included as the body of the `chore(release): v<ver>` commit, so `git show <tag>` and `git log v<ver>` both display the full release notes.
- **Reviewed in PR**. Because the highlights file is committed BEFORE the release script runs, the highlight prose goes through normal PR review alongside the code change.

The motivation: conventional-commit subjects like `feat(higgsfield): MCP-server integration` are useful for archeology but useless for end-users trying to decide whether to update. The highlights file is where the user-facing story gets told.

### Skeleton template

```markdown
# <ver> — <one-line title>

## 🎬 Highlights

### <the 1-3 most important user-facing changes>
<why it matters, what to do, link to docs>

## 🔧 Breaking changes
<none, or "X was removed / changed. See migration.md for the path.">

## 📋 Migration notes
<step-by-step if needed, otherwise "no action required">

## 🧪 Test summary
- N/N tests pass
- bundle size
- any pre-release manual QA results

## 🙏 Credits
<optional, shout-outs to contributors / inspirations>
```

Keep it under 200 lines. The auto-gen sections below will pick up the mechanical details.

## After the release workflow finishes

The `.github/workflows/release.yml` uses GitHub's `generate_release_notes: true` to auto-populate the draft release body from PR + commit history. This misses the highlights file — the user-facing "what does this release mean for me" prose. After the workflow completes:

1. Go to `https://github.com/4neverCompany/MashupForge/releases/tag/v<ver>` (draft, not yet published)
2. Click "Edit"
3. Replace the auto-generated body with the content of `docs/changelog-highlights/<ver>.md` (copy-paste)
4. The full Highlights block (🎬 Highlights, 🔧 Breaking changes, 📋 Migration notes, 🧪 Test summary, 📚 Research artifacts, 🙏 Credits) is the canonical release story
5. Promote the draft to public

Why we do this manually: the auto-generated notes are useful for archeology (commit-by-commit diff) but read like a robot. The highlights file is the hand-curated user-facing story. Both are valuable; the operator's job is to make the highlights the primary content.

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
