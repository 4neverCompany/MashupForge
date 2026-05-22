#!/usr/bin/env bash
# install-event-hooks.sh — install MashupForge git hooks that auto-emit
# events to ~/.hermes/sessions/project-events.jsonl on commit / merge /
# tag-push. EVENT-LOG-AUTO-EMIT task — Maurice flagged that 20+ commits
# and v0.9.41/42/43 releases never made it into the event log because
# nothing fired the writer automatically.
#
# Idempotent — run as many times as you like. Existing pre-commit hook
# (managed by simple-git-hooks for `npm run precommit`) is left alone;
# this script only owns post-commit, post-merge, and pre-push.
#
# Usage:
#   bash scripts/install-event-hooks.sh
#
# Bypass with SKIP_HERMES_HOOKS=1 on any individual git command:
#   SKIP_HERMES_HOOKS=1 git commit -m "..."

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="${REPO_ROOT}/.git/hooks"
LOG_SCRIPT='$HOME/.hermes/scripts/log-session-event.sh'

mkdir -p "$HOOKS_DIR"

# ── post-commit ─────────────────────────────────────────────────────────
# Fires after every commit. Extracts an UPPERCASE-WITH-DASHES task id from
# the subject line if present (e.g. UPDATE-P0-1, DEPS-PATCH-MINOR-MAY22)
# so downstream consumers can group events by task.
cat > "${HOOKS_DIR}/post-commit" <<'HOOK'
#!/bin/sh
# Auto-emit a commit event to ~/.hermes/sessions/project-events.jsonl.
# Best-effort — must NEVER fail the surrounding git operation.
LOG_SCRIPT="$HOME/.hermes/scripts/log-session-event.sh"
[ -x "$LOG_SCRIPT" ] || exit 0
[ "${SKIP_HERMES_HOOKS:-0}" = "1" ] && exit 0

SHA=$(git rev-parse HEAD 2>/dev/null) || exit 0
SUBJECT=$(git log -1 --format=%s HEAD 2>/dev/null) || exit 0
# First UPPERCASE-WITH-DASHES token (>=4 chars, must end alphanumeric)
TASK=$(printf '%s' "$SUBJECT" | grep -oE '[A-Z][A-Z0-9-]{3,}[A-Z0-9]' | head -1)

"$LOG_SCRIPT" \
    --agent dev \
    --event commit \
    --project MashupForge \
    --task "${TASK:-}" \
    --summary "$SUBJECT" \
    --detail "$SHA" \
    >/dev/null 2>&1 || true
exit 0
HOOK

# ── post-merge ──────────────────────────────────────────────────────────
# Fires after `git merge` / `git pull` succeeds. A regular merge ALSO
# fires post-commit for the merge commit, but post-merge fires for
# fast-forward pulls too (where no merge commit exists). Emit a "pull"
# event so the log shows when upstream changes were absorbed.
cat > "${HOOKS_DIR}/post-merge" <<'HOOK'
#!/bin/sh
LOG_SCRIPT="$HOME/.hermes/scripts/log-session-event.sh"
[ -x "$LOG_SCRIPT" ] || exit 0
[ "${SKIP_HERMES_HOOKS:-0}" = "1" ] && exit 0

HEAD_SHA=$(git rev-parse HEAD 2>/dev/null) || exit 0
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0
SUBJECT=$(git log -1 --format=%s HEAD 2>/dev/null) || exit 0

"$LOG_SCRIPT" \
    --agent dev \
    --event note \
    --project MashupForge \
    --task "merge" \
    --summary "Merged upstream into ${BRANCH}: ${SUBJECT}" \
    --detail "$HEAD_SHA" \
    >/dev/null 2>&1 || true
exit 0
HOOK

# ── pre-push ────────────────────────────────────────────────────────────
# Stdin: `<local-ref> <local-sha> <remote-ref> <remote-sha>` per ref.
# Logs a `release` event for tag pushes (refs/tags/v*); branch pushes
# are covered by the underlying post-commit. Hook still must NEVER
# block the push — every failure path returns 0.
cat > "${HOOKS_DIR}/pre-push" <<'HOOK'
#!/bin/sh
LOG_SCRIPT="$HOME/.hermes/scripts/log-session-event.sh"
[ -x "$LOG_SCRIPT" ] || exit 0
[ "${SKIP_HERMES_HOOKS:-0}" = "1" ] && exit 0

while read -r local_ref local_sha remote_ref remote_sha; do
    case "$remote_ref" in
        refs/tags/v*)
            TAG="${remote_ref#refs/tags/}"
            "$LOG_SCRIPT" \
                --agent dev \
                --event release \
                --project MashupForge \
                --task "$TAG" \
                --summary "Release $TAG pushed to origin" \
                --detail "$local_sha" \
                >/dev/null 2>&1 || true
            ;;
    esac
done
exit 0
HOOK

chmod +x "${HOOKS_DIR}/post-commit" "${HOOKS_DIR}/post-merge" "${HOOKS_DIR}/pre-push"

echo "Installed event-log auto-emit hooks:"
echo "  ${HOOKS_DIR}/post-commit"
echo "  ${HOOKS_DIR}/post-merge"
echo "  ${HOOKS_DIR}/pre-push"
echo
echo "Writes to: ${LOG_SCRIPT//\$HOME/$HOME}"
echo "Bypass:    SKIP_HERMES_HOOKS=1 git <cmd>"
