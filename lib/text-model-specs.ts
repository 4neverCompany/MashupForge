/**
 * Text-generation model specs for the vercel-ai prompt route.
 *
 * P2 of PROV-AGNOSTIC-PARAMS — image and video specs live in
 * `lib/model-specs/*.json` with a rich per-model API surface
 * (aspectRatios, style UUIDs, capabilities, hard rules). Text-gen
 * params are a different shape — three primitive knobs
 * (temperature / maxTokens / topP) plus a per-mode override layer —
 * so they get their own typed module instead of a parallel JSON tree.
 *
 * Consumers:
 *   - `/api/ai/prompt` reads the spec for the resolved provider's
 *     `modelId` and threads params into the MiniMax chat/completions
 *     body AND the ai-sdk `streamText` call so the two vercel-ai
 *     providers (MiniMax / OpenAI) see the same parameter discipline.
 *   - `/api/ai/image`'s `enhanceViaMinimax` helper applies the
 *     `enhance` mode override (low temp) so prompt rewrites stay
 *     focused before Leonardo sees them.
 *
 * 0513-CONSOLIDATION: the v1.0 chain was MiniMax / OpenAI / Anthropic /
 * OpenRouter. Post-v1.0 cleanup cuts the secondary providers; this
 * module only carries MiniMax and OpenAI specs. To re-add a provider,
 * add the model entry below AND update `resolveProvider` in
 * `app/api/ai/prompt/route.ts` AND extend the `ResolvedProvider.name`
 * union there.
 *
 * Adding a new text model: drop a new entry in TEXT_MODEL_SPECS.
 * Most callers just want `getTextModelParams(modelId, mode)` and
 * never touch the underlying spec directly.
 *
 * See `docs/bmad/briefs/PROV-AGNOSTIC-PARAMS.md` for the full
 * rollout plan and the relationship to `suggestParameters`' provider
 * filter (image-side counterpart).
 */
import type { ModelSpecProvider } from './model-specs';

/**
 * Mirrors AiMode in `app/api/ai/prompt/route.ts`. Intentionally not
 * imported from the route module to avoid a lib→app edge in the
 * dependency graph — keep the two in sync when a new mode lands.
 */
export type TextAiMode =
  | 'chat'
  | 'generate'
  | 'idea'
  | 'enhance'
  | 'caption'
  | 'tag'
  | 'negative-prompt'
  | 'collection-info';

/**
 * Provider-agnostic text-gen parameter shape. The vercel AI SDK uses
 * camelCase (`maxTokens`, `topP`); the MiniMax chat/completions API
 * uses snake_case (`max_tokens`, `top_p`). Callers translate at the
 * edge — this module emits camelCase by convention.
 */
export interface TextGenParams {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

export interface TextModelSpec {
  modelId: string;
  provider: ModelSpecProvider;
  defaults: TextGenParams;
  modeOverrides?: Partial<Record<TextAiMode, Partial<TextGenParams>>>;
}

/**
 * Per-mode temperature profile shared across most models. Tuned for:
 *   - `idea`: variety > precision (0.95)
 *   - `chat`: balanced — high enough for natural flow, low enough to
 *     respect web-search enrichment when present (0.8)
 *   - `generate`: prompt-engineering output, mid-precision (0.6)
 *   - `caption`: copywriting, balanced (0.7)
 *   - `enhance`: prompt rewriting, structured (0.5)
 *   - `tag` / `negative-prompt`: short structured output, low temp (0.3)
 *   - `collection-info`: JSON metadata, low-mid (0.5)
 *
 * Models with tighter base temperatures (M2.7) can selectively override
 * a subset of these — see the per-model entries below.
 */
const SHARED_MODE_OVERRIDES: Partial<Record<TextAiMode, Partial<TextGenParams>>> = {
  idea: { temperature: 0.95 },
  chat: { temperature: 0.8 },
  generate: { temperature: 0.6 },
  caption: { temperature: 0.7 },
  enhance: { temperature: 0.5 },
  tag: { temperature: 0.3 },
  'negative-prompt': { temperature: 0.3 },
  'collection-info': { temperature: 0.5 },
};

const TEXT_MODEL_SPECS: Record<string, TextModelSpec> = {
  // ── MiniMax ──────────────────────────────────────────────────────
  'MiniMax-M2.5': {
    modelId: 'MiniMax-M2.5',
    provider: 'minimax',
    // M2.5 is the historical default; tuned slightly warmer than M2.7
    // because the reasoning chain is shorter and benefits from more
    // exploration in the sampling step.
    defaults: { temperature: 0.8, maxTokens: 4096 },
    modeOverrides: SHARED_MODE_OVERRIDES,
  },
  'MiniMax-M2.7': {
    modelId: 'MiniMax-M2.7',
    provider: 'minimax',
    // M2.7 is more capable and benefits from lower base temp +
    // a larger token budget for its longer reasoning blocks.
    defaults: { temperature: 0.7, maxTokens: 8192 },
    modeOverrides: SHARED_MODE_OVERRIDES,
  },
  'MiniMax-M2.7-highspeed': {
    modelId: 'MiniMax-M2.7-highspeed',
    provider: 'minimax',
    // Speed-tuned M2.7 variant; same warmth as M2.5, smaller token
    // budget to keep latency tight.
    defaults: { temperature: 0.8, maxTokens: 4096 },
    modeOverrides: SHARED_MODE_OVERRIDES,
  },
  // ── OpenAI ───────────────────────────────────────────────────────
  'gpt-4o-mini': {
    modelId: 'gpt-4o-mini',
    provider: 'openai',
    defaults: { temperature: 0.7, maxTokens: 4096 },
    modeOverrides: SHARED_MODE_OVERRIDES,
  },
  // 0513-CONSOLIDATION: Anthropic and OpenRouter text specs removed.
  // The chain in `app/api/ai/prompt/route.ts` is now MiniMax → OpenAI
  // only. Add the spec back if a future iteration re-enables the
  // provider.
};

/** Lookup a spec by raw modelId. Returns undefined for unknown models. */
export function getTextModelSpec(modelId: string): TextModelSpec | undefined {
  return TEXT_MODEL_SPECS[modelId];
}

/**
 * Resolve effective text-gen params for a (model, mode) pair. The
 * model's `defaults` are layered first, then the per-mode override
 * (if present) wins for any explicitly-set field. Returns an empty
 * object for unknown modelIds so callers can safely spread the result
 * into request bodies without further null checks.
 */
export function getTextModelParams(
  modelId: string,
  mode?: TextAiMode | string,
): TextGenParams {
  const spec = TEXT_MODEL_SPECS[modelId];
  if (!spec) return {};
  const override = mode ? spec.modeOverrides?.[mode as TextAiMode] : undefined;
  return { ...spec.defaults, ...(override ?? {}) };
}

export function getAllTextModelSpecs(): TextModelSpec[] {
  return Object.values(TEXT_MODEL_SPECS);
}

export function getTextModelSpecsByProvider(
  provider: ModelSpecProvider,
): TextModelSpec[] {
  return Object.values(TEXT_MODEL_SPECS).filter((s) => s.provider === provider);
}
