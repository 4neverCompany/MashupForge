# RELEASE-v0.9.21 — BLOCKED (stale task)

**Status:** BLOCKED — will not execute
**Dispatched:** 2026-05-04T14:35:28+02:00 (stall_count: 1)
**Reviewed:** 2026-05-04 by Developer

## Why blocked

The task asks to "bump to v0.9.21" and tag `v0.9.21`, but **v0.9.21 already shipped 3 days ago** and the repo has advanced 7 patch versions past it. Running `scripts/release.sh` against this brief would regress the version and create a tag collision.

### Verification

| Check | Result |
|---|---|
| `git tag v0.9.21` | Exists — `fbb9afa` `chore(release): v0.9.21` (2026-05-01 18:55:54 +0200) |
| `package.json` version | `0.9.27` |
| Latest tag | `v0.9.28` |
| Brief `docs/bmad/briefs/mmx-cli-ai-agent-integration.md` | **Missing** — file does not exist in repo |
| Cited commit `7331b94` | Exists — `fix(mmx): stop auto-running broken OAuth flow` (MMX era) |
| Cited commit `a3a10bd` | Exists — `docs(qa): MMX-CARD-VPASS-QA re-review` (MMX era) |
| Current work focus | NCA (Nacara CLI) integration — orthogonal to brief's MMX OAuth scope |

The cited commits are real but belong to a prior development cycle. The brief itself never made it into the repo. Project state from 2026-05-02 already shows last commit on the NCA integration line; the v0.9.21 release was completed before this task was re-dispatched.

## Hypothesis

This task entry was likely re-queued from an old dispatch log without checking that v0.9.21 had already shipped. `stall_count: 1` confirms it has cycled at least once.

## Action

- Will NOT run `scripts/release.sh`.
- Will NOT modify `package.json`, `tauri.conf.json`, or `Cargo.toml`.
- Pushing `blocked` envelope + chat ping to Hermes so he can purge or rewrite the queue entry.

## Recommendation for Hermes

If the intent was "cut the next release after the recent NCA fixes," the correct task is `RELEASE-v0.9.28-or-next` with current `HEAD` (`abe91e1` `fix(nca): isAuthenticated() reads ~/.nca/config.toml`). Confirm before re-dispatching.
