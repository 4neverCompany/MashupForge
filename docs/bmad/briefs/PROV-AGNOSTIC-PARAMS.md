# PROV-AGNOSTIC-PARAMS — Provider-agnostic parameter engine

**Status:** P1 shipped, P2 + P3 awaiting green-light.
**Owner:** dev.
**Trigger:** `/tmp/provider-agnostic-params.txt`.

---

## Pain point

`lib/model-specs/` describes only Leonardo image + video models. When a
user picks a non-Leonardo backend the rule engine has no spec to read,
so the request goes out with default parameters:

| Surface | Today | After |
|---|---|---|
| Leonardo image gen (nano-banana, gpt-image, …) | Auto-tuned via `suggestParameters` | unchanged |
| MiniMax image-01 (added 2026-05-17, commit `f0f047e`) | No spec — bypasses tuning | spec added in P1, tuned in P2 |
| Vercel-ai chat — MiniMax-M2.5/M2.7, OpenAI gpt-4o-mini, Anthropic haiku, OpenRouter | No spec, route sends `{model, messages, stream}` only | new text-model spec class introduced in P2 |
| pi.dev / nca / mmx subprocess text | Backend handles its own params | out of scope (sidecar contracts) |

## Scope decision (taken in P1)

Three things are intentionally NOT collapsed into a single spec shape:

1. **Image specs** — keep the current rich JSON schema (parameters,
   aspectRatios, capabilities, styles, rules). Add `provider` field.
2. **Video specs** — same as image, distinguished by `type: 'video'`.
3. **Text specs** — new, smaller shape (`provider`, `endpoint`,
   `defaults: {temperature, max_tokens, top_p}`, per-mode overrides).
   Lives in `lib/text-model-specs.ts` (TS, not JSON — values are
   primitive numbers, type-safety is more useful than JSON ergonomics).

Rationale: collapsing text-gen params (`temperature`, `max_tokens`)
into the image-spec schema would force every image-spec consumer to
ignore those fields and every text-spec consumer to handle the
12-key image-only fields. Two narrow classes beat one wide one.

## Plan

### P1 — Schema extension + provider tags (THIS COMMIT, no behaviour change)

- `lib/model-specs/index.ts` — add `provider: 'leonardo' | 'minimax' | 'openai' | 'anthropic' | 'openrouter'` to `ModelSpec`.
- Tag all 8 existing JSONs as `"provider": "leonardo"`.
- Add `lib/model-specs/minimax-image-01.json` with `"provider": "minimax"`. Closes the gap discovered during MXIMG-001 (the model is in `LEONARDO_MODEL_PARAMS` but had no rich JSON spec).
- Wire `minimax-image-01` into the `MODEL_SPECS` map.
- No engine or UI changes. `suggestParameters()` signature unchanged. All 22 existing param-suggest tests pass as-is.

### P2 — Engine provider-awareness (proposed, NOT in this commit)

- Add `provider?: string` filter to `SuggestParametersInput`. When set, the engine filters `availableModels` to entries whose `LeonardoModelConfig.provider` matches (or is undefined-→-leonardo for back-compat).
- Introduce `lib/text-model-specs.ts` with the text-spec shape and entries for: minimax-m2.5, minimax-m2.7, minimax-m2.7-highspeed, openai-gpt-4o-mini, anthropic-claude-3-haiku-20240307, openrouter-openai-gpt-4o-mini.
- `/api/ai/prompt` reads the active text-spec by `provider.name + modelId` and threads `temperature` / `max_tokens` / `top_p` into the MiniMax `chat/completions` body and `streamText` calls.
- Per-mode overrides: `idea` → high temp (0.9-1.0) for variety, `caption` → mid temp (0.7), `enhance` → low temp (0.5), `tag` / `negative-prompt` → low temp (0.3), `chat` → default (0.8).

### P3 — UI: model picker filters by active provider (proposed, NOT in this commit)

- `SettingsModal.tsx` "Default Leonardo Model" dropdown:
  rename to "Default Image Model", filter by `LEONARDO_MODELS.filter(m => m.provider === imageProviderFromActiveAgent)`.
- New "Default Text Model" dropdown next to it, populated from `TEXT_MODEL_SPECS` filtered by `settings.activeAiAgent`.
- Persist `settings.activeTextModel?: string` so the route picks it up via `body.model`.

## Risk + back-compat

- **P1:** Pure additive. No existing caller breaks because every existing code path either ignores the new field or treats undefined-provider as Leonardo.
- **P2:** `suggestParameters` adds an OPTIONAL filter param — existing callers unchanged. Text-model specs are net-new; they don't conflict with image-specs.
- **P3:** Touches one component (SettingsModal) and one settings field. UI-visible change for users on non-vercel-ai providers; vercel-ai users see the same dropdowns they have today plus a new text-model picker.

## Tests

- **P1:** existing 22 param-suggest tests already pass after the schema add (verified). Add 2 new tests asserting `getModelSpec('minimax-image-01').provider === 'minimax'` and that all 8 prior specs report `'leonardo'`.
- **P2 (future):** add `provider` filter coverage to `param-suggest.test.ts` + new `text-model-specs.test.ts` validating per-mode overrides.
- **P3 (future):** SettingsModal dropdown filtering test via `@testing-library/react`.
