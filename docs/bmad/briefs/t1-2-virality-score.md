# T1.2 — Virality score in the approval queue

**Author:** Hermes (orchestrator)
**Date:** 2026-06-09
**Status:** Brief — ready for subagent dispatch
**Target release:** v1.3.0 (T1.2–T1.5 ship together)
**Branch:** `t1-2-virality-score`
**Worktree:** `C:/temp/mashupforge-t1-2/` (from `main` @ `2a48230`)

## Goal

When a generated image lands in the `pending_approval` state, also
compute a predicted virality score (1–100) and surface a small badge in
the approval UI. The score comes from a new Higgsfield text-generation
adapter wrapping the `brain_activity` model. Existing approval flow
stays intact — the score is additive, not a gate.

This is the single highest-leverage Tier 1 feature for an Instagram
content studio: a visible 12 vs 78 score changes approve/reject
behaviour.

## Architecture (what the subagent builds)

```
┌──────────────────────┐
│ HiggsfieldTextAdapter│  NEW FILE: lib/providers/higgsfield/text-adapter.ts
│  (brain_activity)    │  - thin CLI wrapper, mirrors cli-adapter.ts
└──────────┬───────────┘  - registered in lib/providers/registry.ts
           │
           ▼
┌──────────────────────┐
│ virality_predict tool│  NEW FILE: lib/agent-tools/virality-predict.ts
│  (Zod schema +       │  - exported in lib/agent-tools/index.ts
│   execute)           │  - added to AGENT_TOOLS array
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ Director integration │  EDIT: lib/agent-loop/* — call virality_predict
│  on image_ready →    │         when a post enters pending_approval,
│  pending_approval    │         store the score on the post record
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ UI badge             │  EDIT: components/approval/* — small pill showing
│  in approval card    │         "Virality: 78" with a colour scale
└──────────────────────┘
```

## Files to read first (conventions & templates)

Before writing any code, read these in order:

1. `lib/providers/higgsfield/cli-adapter.ts` — the existing
   Higgsfield CLI adapter (image + video). This is the **template**
   for the new text-adapter: same `ProviderAdapter` interface, same
   `cliInvoke` plumbing, same auth-via-credentials.json pattern.
   Pay attention to:
   - L20 doc-comment: documents the CLI surface
   - L229 (`args = ['generate', 'create', ...]`): the verb shape
   - L266-300 (`generateVideo`): another method, the pattern to follow
   - `runWithErrorMapping`, `maybeBuildAuthEnv`, `resolveImageReference`:
     private helpers you'll mirror.

2. `lib/providers/interface.ts` — `ProviderAdapter` interface, the
   `AssetRef`/`GenerateImageOptions`/etc. types. The new adapter
   may need a new `GenerateTextOptions` shape (the interface already
   hints at this with the text-vs-image pattern in `minimax/text-adapter.ts`).

3. `lib/providers/minimax/text-adapter.ts` — a **smaller** text adapter
   that already exists. This is the closer template for a new
   Higgsfield text adapter than `cli-adapter.ts`.

4. `lib/providers/registry.ts` — where the new adapter is registered.
   Add a line for `higgsfield-text` (or a better name you pick).
   Note the `BUILTIN_PROVIDER_IDS` array.

5. `lib/agent-tools/schemas.ts` — Zod schemas for tool inputs/outputs.
   `lib/agent-tools/generate-image.ts` — **the canonical agent-tool
   template**: structure, error wrapping, dispatcher pattern.

6. `lib/agent-tools/index.ts` — the `AGENT_TOOLS` array. The new
   tool gets added here. Schemas are re-exported.

7. `lib/post-lifecycle/` — the state machine. Find the
   `image_ready → pending_approval` transition. This is where the
   virality computation hooks in. The `useReconciler` hook is also
   here.

8. `components/approval/` — the approval UI. Note the existing
   `CarouselApprovalCard.tsx`, `CarouselStatusPill.tsx`, etc. for
   styling conventions. The single-image approval card is likely
   `components/Studio/` or `components/ImageDetailModal.tsx` — find
   it via `grep -r "pending_approval" components/`.

## CLI surface for `brain_activity`

The text-generation CLI command (verified 2026-06-09):

```bash
$ higgsfield model list | grep brain_activity
brain_activity                  Virality Predictor              text

# Synchronous text generation:
$ higgsfield generate create brain_activity --prompt "..." --json
# Returns: {"text": "<model output>", "request_id": "...", ...}

# Cost:
$ higgsfield generate cost brain_activity --prompt "..." --json
# Returns: {"credits": 1, "currency": "credit", ...}
```

The `brain_activity` model is a **text** model. The CLI's
`generate create` verb is shared between text/image/video — the
`job_set_type` slug (`brain_activity`) is the only discriminator.

Score format assumption (verify against the CLI's actual response
during implementation): a JSON object like
`{"score": 78, "confidence": 0.85, "reasoning": "..."}`. If the
real response shape is different, the adapter's Zod schema
adjusts — the tool's external contract stays the same.

## Acceptance criteria

1. **`lib/providers/higgsfield/text-adapter.ts`** exists, implements
   `ProviderAdapter`, has at minimum:
   - `name = 'higgsfield-text'`
   - `isAvailable()` — same `binaryExists` pattern as cli-adapter
   - `generateText(opts: { prompt: string })` — calls
     `higgsfield generate create brain_activity --prompt ... --json`
     and returns a `ViralityScore { score: number, confidence: number, reasoning?: string }`
   - Zod schema validating the response shape
   - Same auth-via-credentials.json pattern as cli-adapter (no
     regression on the v1.2.6 → v1.2.6 fix)

2. **`lib/providers/registry.ts`** registers the new adapter in
   `BUILTIN_PROVIDER_IDS` and the factory map.

3. **`lib/agent-tools/virality-predict.ts`** exists, with:
   - `zViralityPredictInput` and `zViralityPredictOutput` Zod schemas
   - `viralityPredictTool` definition using `tool()` from 'ai'
   - `executeViralityPredict` that calls the adapter and returns
     the score
   - Follows the `generate-image.ts` template (same error wrapper,
     same dispatcher pattern)

4. **`lib/agent-tools/index.ts`** re-exports the schemas, the
   tool, and adds the new tool to `AGENT_TOOLS` array.

5. **State machine integration:** when a post enters
   `pending_approval`, `virality_predict` is called. The score
   is stored on the post record (new field on the post type —
   add it to `types/mashup.ts`). The score is also returned in
   the response of whatever API route / hook triggers the
   transition. Use the existing `useReconciler` hook as the
   integration point if appropriate; the exact spot is your call
   but the score MUST land on the post record before the UI
   renders.

6. **UI badge:** in the approval card (find the right component
   via `grep -r "pending_approval" components/`), show a small
   pill with "Virality: NN" and a colour scale:
   - 0–30: red/dim
   - 31–60: amber
   - 61–100: green
   The badge is shown alongside the existing approval state pill.
   Style consistent with the existing `CarouselStatusPill.tsx`.

7. **Tests** (under `tests/lib/providers/` and
   `tests/lib/agent-tools/`):
   - `tests/lib/providers/higgsfield-text-adapter.test.ts` —
     at least 5 cases mirroring the cli-adapter tests (sync
     response, async job, missing CLI, error payload, auth env).
   - `tests/lib/agent-tools/virality-predict.test.ts` — at
     least 3 cases (success, low score colour band, provider
     unavailable).
   - One integration-style test confirming the state machine
     calls the tool on the `image_ready → pending_approval`
     transition (or document where the integration lives if
     it's not testable in isolation).

8. **All of:**
   - `bunx tsc --noEmit` clean
   - `bunx vitest run` — all tests pass, including the new ones
   - `bunx vitest run tests/lib/providers/higgsfield-text-adapter.test.ts` — passes
   - `bunx vitest run tests/lib/agent-tools/virality-predict.test.ts` — passes
   - The full test count goes from 1862 → 1862 + N (where N is the
     number of new test cases, expect ~8–10)

9. **No regressions:** the cli-adapter fix from T1.1 still passes.
   The brain_activity cost (in credits) is documented in the file
   header (~1 credit/call).

## Out of scope

- Do NOT add a CLI for `higgsfield account status` (balance
  visibility). That's T1.5 territory.
- Do NOT add a slider in the UI to override the score. The score
  is what the model says; the human approves/rejects separately.
- Do NOT change the existing 6-state pipeline transitions or
  add a new state.
- Do NOT add CLI-side features beyond `generate create brain_activity`.
- Do NOT bump version or update CHANGELOG. Release script handles
  that.
- Do NOT push, open a PR, or tag. Commit only on the local
  feature branch.

## Steps

1. **Read** the files listed above. Understand the existing patterns.
2. **Worktree** the repo:
   ```bash
   cd C:/temp/mashupforge
   git worktree add -b t1-2-virality-score ../mashupforge-t1-2 HEAD
   cd ../mashupforge-t1-2
   # node_modules may be missing — copy from C:/temp/mashupforge/
   cp -r ../mashupforge/node_modules .
   ```
3. **Implement** in this order:
   1. text-adapter.ts (with tests)
   2. registry.ts update
   3. virality-predict.ts (with tests)
   4. agent-tools/index.ts update
   5. State machine integration
   6. UI badge
   7. types/mashup.ts update
4. **Verify** all 9 acceptance criteria above.
5. **Commit** on the feature branch:
   ```bash
   git add -A
   git -c user.name="Maurice" -c user.email="mauricedimi56@gmail.com" \
     commit -m "feat(virality): predict score in approval queue via brain_activity"
   ```
   The commit body should summarise what was added and reference
   this brief.

## Notes

- The CLI is on Maurice's PATH at
  `C:\Users\Maurice\AppData\Roaming\npm\higgsfield`. The adapter
  resolves it the same way `cli-adapter.ts` does
  (`isBinaryAvailable` + `binaryExists`).
- The `higgsfield` CLI requires a workspace to be set. If the
  adapter's `isAvailable()` returns true but generation fails with
  a workspace error, that's a user-side config issue — surface it
  in the error mapping, don't try to auto-set a workspace.
- AGPL constraint: this adds to the open-source codebase. The
  new text-adapter wraps the Higgsfield API, which is fine
  (third-party API calls aren't derivative work of the API
  provider). No new license concerns.
