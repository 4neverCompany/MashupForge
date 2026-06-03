# MashupForge — Project Memory

> Project-specific knowledge that compounds across sessions.
> Read this before working on MashupForge. Update it when you
> learn something that's true for the project (not true for
> the agent globally — that goes in the agent's own MEMORY.md).

## The atomic-write guarantee (v0.9.41 fix)

A post cannot exist without `hostedImageUrl`. Enforced by
`savePostWithBlob()` in `lib/post-lifecycle/` — the post record
and the hosted URL are written in one transaction. The v0.9.41
bug was: post written, hosted URL written separately, crash
in between → orphan post. The state machine makes this
structurally impossible.

**Implication:** if you see a post without `hostedImageUrl`,
the state machine is broken, not the data. Don't try to "fix"
the data — fix the state machine.

## The 6-state pipeline

```
idle → image_ready → pending_caption → pending_approval
                                            │
                                    ┌───────┴───────┐
                                    ▼               ▼
                                approved        rejected
                                    │               │
                                    ▼               ▼
                               scheduled       failed (atomic)
                                    │
                                    ▼
                                 posted
```

All transitions are pure functions. All typed. All guarded at
the API route level. The `useReconciler` hook fires on focus
and a 30s timer.

## Higgsfield is MCP, not REST

`lib/higgsfield/mcp-client.ts` uses `@modelcontextprotocol/sdk`.
OAuth is per-user, dynamic client registration at
`mcp.higgsfield.ai/oauth2/register` on first connect, PKCE S256.
**Do not** replace MCP with raw REST — the integration design
is built on the multi-tenant-from-day-1 architecture.

Tokens are AES-GCM encrypted at rest in IDB. Packed format
`v1.<iv>.<tag>.<ciphertext>`. Never log, never put in
localStorage.

## The user's AI setup

- Higgsfield Plus plan (~1,000 credits/month)
- MiniMax-M2.7 / M3 (text default) + OpenAI fallback
- Leonardo (image default) + Higgsfield (peer of Leonardo)
- Seedance 2.0 is the default video model (Higgsfield)

Typical weekly MashupForge run: 5 images + 2 short videos ≈
150-200 credits. Fits in Plus plan.

## v1.0.5 backlog (pre-ranked)

See `.harness/docs/v105-backlog.md`. TL;DR:
- **C** (next, v1.0.5.1) — CI cleanup (brand-guards, ESLint)
- **A** (v1.0.5.x) — Higgsfield prompt engineering v2 (SLCT,
  MCSLA, camera angles, anti-AI negative prompts)
- **D** (v1.0.5.x) — Per-cycle credit budget
- **E** (v1.0.6) — Long-form video with recurring character

## Open security flag

A hardcoded GitHub PAT was found in 4 superseded release scripts
in `docs/working-folder/scripts/`. The scripts have been
rewritten to read `GITHUB_TOKEN` from env, and they pushed
clean. But the leaked token (full repo access) is still out
there. **Maurice should rotate it.**

## The `.hermes/` situation

The repo has a `.hermes/` directory — that's a parallel
orchestrator (Hermes) from Maurice's previous setup, with
sub-agent memory files. The brand-guard workflow currently
fails because `.hermes/subagents/designer/memory.md` contains
the legacy name "Multiverse Mashup Studio". The v1.0.5.1 fix
adds `.hermes/` to `paths-ignore`. Do not delete `.hermes/`.

## Case-collision on Windows

The repo has `docs/bmad/qa/LATEST-REVIEW.md` AND
`docs/bmad/qa/latest-review.md` (case-insensitive FS collision).
On Windows, the clone drops one of them. Not a real bug — pick
the canonical casing and `git rm` the duplicate.

## Test count bar

**1,243 tests pass at HEAD.** Any change that drops the count
is a regression. The precommit hook runs `tsc --noEmit && vitest
run` (~3 min). `--no-verify` allowed for quick commits; CI
re-runs.

## Bundle size budget

Every route must be < 300 KB gzipped first-load JS. The
`scripts/check-bundle-size.mjs` gate runs in CI. Studio: 218.2
KB, Root: 214.9 KB, Login: 197.1 KB at HEAD.
