#!/bin/bash
# release.sh — bump version, regenerate CHANGELOG.md, commit, leave push+tag
# to the operator. Usage: ./scripts/release.sh 0.7.2

set -euo pipefail

VERSION="${1:?Usage: ./scripts/release.sh <version> [--force] (e.g. 0.7.2)}"
FORCE="${2:-}"
TAG="v${VERSION}"
DATE="$(date -u +%Y-%m-%d)"

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# ── Empty-bump guard ─────────────────────────────────────────────────────────
# 8 of the 10 releases between v1.3.3 and v1.4.3 were version bumps with
# ZERO real commits since the previous tag — each one cost a ~20 min Tauri
# CI run and an "Internal-only release; no user-facing changes" entry in
# the public release list. Refuse to cut a release when nothing changed.
# `--force` overrides (e.g. re-cutting a release whose build infra failed).
guard_prev_tag="$(git tag --list 'v*' --sort=-version:refname | head -n 1 || true)"
if [ -n "${guard_prev_tag}" ] && [ "${FORCE}" != "--force" ]; then
  real_commits="$(git log "${guard_prev_tag}..HEAD" --no-merges --pretty='%s' \
    | grep -Evc '^(chore\(release\)|chore\(changelog\)|docs\(changelog\))' || true)"
  if [ "${real_commits}" -eq 0 ]; then
    echo "ERROR: No real commits since ${guard_prev_tag} — refusing to cut an empty release." >&2
    echo "       To verify CI health without a release, use:" >&2
    echo "         gh workflow run tauri-windows.yml" >&2
    echo "       To force anyway: ./scripts/release.sh ${VERSION} --force" >&2
    exit 1
  fi
  echo "Empty-bump guard: ${real_commits} real commit(s) since ${guard_prev_tag} — proceeding."
fi

echo "Bumping to ${VERSION}..."

# Bump package.json, tauri.conf.json, Cargo.toml in place. Each sed pattern
# matches the FIRST `"version": "..."` line in the file, which is the
# project's own version in all three files (Cargo.toml lock-style entries
# use a different syntax and aren't matched by the JSON-style pattern).
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" package.json
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" src-tauri/tauri.conf.json
sed -i "s/^version = \"[^\"]*\"/version = \"${VERSION}\"/" src-tauri/Cargo.toml

pkg=$(grep '"version"' package.json | sed 's/.*"version": "\(.*\)".*/\1/')
tauri=$(grep '"version"' src-tauri/tauri.conf.json | sed 's/.*"version": "\(.*\)".*/\1/')
cargo=$(grep '^version' src-tauri/Cargo.toml | sed 's/.*"\(.*\)".*/\1/')

echo "package.json=${pkg}  tauri.conf.json=${tauri}  Cargo.toml=${cargo}"
if [ "$pkg" != "$VERSION" ] || [ "$tauri" != "$VERSION" ] || [ "$cargo" != "$VERSION" ]; then
  echo "ERROR: Version mismatch after bump!" >&2
  exit 1
fi

# ── Lockfile sync ───────────────────────────────────────────────────────────
# Regenerate bun.lock so CI's `bun install --frozen-lockfile` keeps passing.
# We don't bump dependency versions here — `bun install` is a no-op on a
# clean lockfile and only writes out a refreshed file when package.json has
# drifted (e.g. a previous commit added a dep without running bun install
# locally). v0.9.24 release shipped via the workflow's npm fallback because
# the Bun primary step kept failing on a stale lockfile; this step prevents
# the same drift from accumulating across releases.
#
# Skip silently if bun isn't on PATH — the operator can also run on a
# machine without Bun (the workflow's npm fallback still works), we just
# can't refresh the lockfile from there.
if command -v bun >/dev/null 2>&1; then
  echo "Refreshing bun.lock..."
  bun install --silent
else
  echo "[skip] bun not on PATH — bun.lock not refreshed."
fi

# Refresh src-tauri/Cargo.lock so the `app` package version inside the
# lockfile tracks Cargo.toml. The workflow's parity check
# (`tauri-windows.yml:48-64`) doesn't read Cargo.lock, so a stale entry
# slips past parity but trips the cargo build downstream — e.g. v0.9.40
# initial CI failed at the parity step for a different reason but would
# have also tripped on a stale lockfile if it had gotten that far. Without
# this step every release commit needs a manual `cargo update -p app`
# companion commit (see `.claude/rules/release-flow.md`).
#
# Skip silently if cargo isn't on PATH — operator can refresh manually
# afterwards on a machine that has the Rust toolchain.
if command -v cargo >/dev/null 2>&1; then
  echo "Refreshing src-tauri/Cargo.lock..."
  (cd src-tauri && cargo update -p app --quiet)
else
  echo "[skip] cargo not on PATH — src-tauri/Cargo.lock not refreshed."
fi

# ── Changelog generation ─────────────────────────────────────────────────────
# Conventional-commits → Keep-a-Changelog sections. `chore:`, `ci:`, `build:`,
# `style:` are skipped — internal noise that doesn't belong in user-facing
# release notes. `chore(release):` (the bump itself, from a prior run) is
# also skipped via the same filter.

prev_tag="$(git tag --list 'v*' --sort=-version:refname | head -n 1 || true)"
if [ -z "${prev_tag}" ]; then
  echo "No prior tag found — diffing from initial commit."
  prev_tag="$(git rev-list --max-parents=0 HEAD | head -n 1)"
fi
echo "Generating changelog since ${prev_tag}..."

block="$(mktemp)"
trap 'rm -f "${block}"' EXIT

# Emit a `### <Section>` block for every commit subject matching `pattern`.
# Subjects of the form `type(scope): summary` become `- **scope:** summary`,
# matching the existing CHANGELOG.md style. Bare `type: summary` becomes
# `- summary`. Returns 0 (and emits nothing) if no commits matched.
#
# The `type(release):` / `type(changelog):` commits are SKIPPED — those
# are the "I wrote the highlights file" / "I bumped the version"
# commits, which would otherwise show up in the auto-gen as noise
# entries. The highlights file and the version files are the
# user-facing artifacts; the commits that added them aren't.
emit_section() {
  local label="$1"
  local pattern="$2"
  local lines
  lines="$(git log "${prev_tag}..HEAD" --no-merges --pretty='%s' \
            | grep -E "^${pattern}" \
            | grep -Ev '^[a-z]+\((release|changelog)\)' \
            || true)"
  [ -z "${lines}" ] && return 0

  printf '\n### %s\n' "${label}" >> "${block}"
  while IFS= read -r line; do
    local cleaned scope
    cleaned="$(printf '%s' "${line}" | sed -E 's/^[a-z]+(\([^)]+\))?: //')"
    scope="$(printf '%s' "${line}" | sed -nE 's/^[a-z]+\(([^)]+)\):.*/\1/p')"
    if [ -n "${scope}" ]; then
      printf -- '- **%s:** %s\n' "${scope}" "${cleaned}" >> "${block}"
    else
      printf -- '- %s\n' "${cleaned}" >> "${block}"
    fi
  done <<< "${lines}"
}

printf '## [%s] — %s\n' "${VERSION}" "${DATE}" > "${block}"

emit_section "Added"   "feat(\([^)]+\))?:"
emit_section "Fixed"   "fix(\([^)]+\))?:"
emit_section "Changed" "(refactor|perf)(\([^)]+\))?:"
emit_section "Docs"    "docs(\([^)]+\))?:"
emit_section "Tests"   "test(\([^)]+\))?:"

# Empty release: only the heading line was written. Substitute a placeholder
# so the CHANGELOG entry still exists for traceability.
if [ "$(wc -l < "${block}")" -le 1 ]; then
  printf '\n_Internal-only release; no user-facing changes since %s._\n' "${prev_tag}" >> "${block}"
fi

# ── Hand-curated highlights (pre-release, opt-in) ──────────────────────
# If the release operator wrote `docs/changelog-highlights/<version>.md`
# (without the v prefix) before running this script, splice it into the
# new block ABOVE the auto-generated conventional-commit sections. This is
# the place for the "what does this release mean for the user" prose
# that mechanical commit subjects can't capture — migration notes,
# breaking-change callouts, the 2-4 most-important user-facing changes,
# credit / pricing notes, etc.
#
# Fallback: if the highlights file doesn't exist (forgotten / skipped),
# the block is just the auto-gen sections. Add a warning so the operator
# notices and can backfill before pushing.
highlights_file="docs/changelog-highlights/${VERSION}.md"
if [ -f "${highlights_file}" ]; then
  echo "Splicing hand-curated highlights from ${highlights_file}..."
  highlights_block="$(mktemp)"
  trap 'rm -f "${block}" "${new_changelog}" "${highlights_block}"' EXIT
  {
    printf '\n### 🎬 Highlights\n\n'
    # Markdown heading demotion. The file's H1 (the title line, e.g.
    # "# v1.0.4 — title") is stripped — the ## [1.0.4] … heading the
    # script already wrote carries that info. All remaining H2s become
    # H4s (natural nesting under our prepended ### 🎬 Highlights).
    # H3s in the file stay H3s.
    sed -E '1{/^# /d; /^$/d}' "${highlights_file}" \
      | sed -E 's/^## /#### /'
    printf '\n---\n'
  } > "${highlights_block}"
  cat "${highlights_block}" "${block}" > "${block}.new"
  mv "${block}.new" "${block}"
else
  echo
  echo "⚠️  No highlights file at ${highlights_file}"
  echo "   CHANGELOG entry will be auto-gen only. To backfill later:"
  echo "     1. Write ${highlights_file} (Markdown, hand-curated)"
  echo "     2. Re-run:  ./scripts/release.sh ${VERSION}"
  echo "   The auto-gen sections will be re-emitted in place; the highlights"
  echo "   block will be spliced in above them on the second pass."
  echo
fi

# Insert the new block above the first existing version block. The intro
# header (everything from line 1 up to the first version heading) is
# preserved verbatim. If no prior version block exists, append after the
# header.
#
# Accepts both heading styles the project has used:
#   - Keep-a-Changelog default: `## [0.9.30] — 2026-05-05`  (script-generated)
#   - Brief-driven shorthand:   `## v0.9.32 (2026-05-16)`   (recent releases)
# A regex that only matched `^## \[` skipped past v-prefixed entries and
# put the new block underneath them, producing reverse-chronological
# entries below the newest one. Match either.
header_end="$(grep -nE '^## (\[|v[0-9])' CHANGELOG.md | head -n 1 | cut -d: -f1 || true)"
new_changelog="$(mktemp)"
trap 'rm -f "${block}" "${new_changelog}"' EXIT

if [ -z "${header_end}" ]; then
  cat CHANGELOG.md > "${new_changelog}"
  printf '\n' >> "${new_changelog}"
  cat "${block}" >> "${new_changelog}"
  printf '\n' >> "${new_changelog}"
else
  head -n "$((header_end - 1))" CHANGELOG.md > "${new_changelog}"
  cat "${block}" >> "${new_changelog}"
  printf '\n' >> "${new_changelog}"
  tail -n "+${header_end}" CHANGELOG.md >> "${new_changelog}"
fi
mv "${new_changelog}" CHANGELOG.md

echo
echo "── Generated changelog block ──"
cat "${block}"
echo "───────────────────────────────"

# ── Commit ──────────────────────────────────────────────────────────────────
# Stage the five version files and commit with subject `chore(release): vX.Y.Z`
# and body = the generated changelog block. Operator pushes + tags afterwards.
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock CHANGELOG.md
# Include bun.lock if the install step above (or any prior local run)
# changed it. Empty-stage if it's clean — `git add` no-ops on missing diff.
if [ -f bun.lock ]; then
  git add bun.lock
fi

# Skip the commit if nothing actually changed (e.g. re-running for the same
# version). git diff --cached is empty when nothing is staged for commit.
if git diff --cached --quiet; then
  echo "No staged changes — skipping commit."
else
  {
    printf 'chore(release): %s\n\n' "${TAG}"
    cat "${block}"
  } | git commit -F -
  echo "Committed: $(git log -1 --pretty='%h %s')"
fi

echo
echo "Next:"
echo "  git push origin main"
echo "  git tag ${TAG} && git push origin ${TAG}"
