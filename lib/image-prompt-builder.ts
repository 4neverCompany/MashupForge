/**
 * Provider-agnostic image-prompt builder.
 *
 * Both MMX and Leonardo benefit from the same enhancement step: read the
 * model spec at lib/model-specs/*.json for the user-selected style/preset,
 * append style + quality + mode keywords as natural-language hints to the
 * prompt, and emit provider-specific structured options (mmx flags or
 * Leonardo style UUIDs + dimensions) alongside.
 *
 * One function, one set of inputs, three output shapes (mmx, leonardo,
 * higgsfield) — guarantees that MMX, Leonardo, and Higgsfield all see
 * the same intent and produce comparable output for the same user setting.
 *
 * Pure module: no I/O, no spawn — string assembly + structured-flag
 * extraction.
 */

import { getModelSpec, type ModelSpec } from './model-specs';
import type { MmxImageOptions } from './mmx-client';

export interface PromptInjectionInputs {
  /** Model spec key (e.g. "nano-banana-2"). When set, params/styles are
   * pulled from the JSON spec. Unknown keys are ignored gracefully. */
  modelId?: string;
  /** Pick one style by name from spec.styles. Case-insensitive. The UUID
   * value goes into Leonardo's style_ids; the canonical NAME is appended
   * to the prompt as a keyword for both providers. */
  styleName?: string;
  /** Override the aspect ratio. If unset and the spec has aspectRatios,
   * the first ratio is used as the default — matching how the Leonardo
   * flow already treats the spec's first entry as canonical. */
  aspectRatio?: string;
  /** Tier of the dimension table to pick (e.g. "1K", "2K", "4K"). When
   * unset, the first sub-entry of the chosen aspect ratio is used. */
  dimensionTier?: string;
  /** Image count, propagated to mmxOptions.n and leonardoOptions.quantity. */
  count?: number;
  /** Optional free-text quality hint appended to the prompt last
   * (e.g. "ultra-detailed, cinematic lighting"). */
  qualityHint?: string;
  /** HIGGSFIELD-INTEGRATION: pre-resolved Higgsfield options to merge
   * into the output. Typically populated by the Studio / Pipeline
   * after the user has picked a model from the Higgsfield picker.
   * Only the fields relevant to the selected model are forwarded to
   * the route — the API layer re-validates against the model's
   * allow-list. */
  higgsfieldOptions?: Partial<HiggsfieldBuilderOptions>;
}

export interface LeonardoBuilderOptions {
  /** Style UUIDs resolved from spec.styles[styleName]. Empty if no
   * style was requested or the style name is not in the spec. */
  styleIds?: string[];
  /** Maps to Leonardo's `quantity` parameter. */
  quantity?: number;
  /** Width/height paired from spec.aspectRatios[ratio][tier]. */
  width?: number;
  height?: number;
  /** Default quality from spec.parameters.quality. Forwarded as-is so the
   * route can use the spec's documented enum value (e.g. "HIGH").
   *
   * Note: this replaces the legacy `mode` parameter (FAST|QUALITY|ULTRA),
   * which was deprecated by Leonardo on 2026-05-04 for GPT image models.
   */
  quality?: string;
  /** Maps to Leonardo's `prompt_enhance` enum: 'ON' | 'OFF'. */
  promptEnhance?: 'ON' | 'OFF';
}

/**
 * HIGGSFIELD-INTEGRATION: structured options for the
 * /api/higgsfield/image + /api/higgsfield/video routes. The shape
 * matches the MCP `higgsfield_generate` tool's argument schema. Only
 * the fields supported by the selected model (per its JSON spec) are
 * populated — the API route validates against the model allow-list
 * before forwarding to the MCP server.
 */
export interface HiggsfieldBuilderOptions {
  /** The Higgsfield `job_set_type` slug, e.g. `nano_banana_2`. */
  model: string;
  /** Aspect ratio string, e.g. `9:16`. Validated server-side against
   * the model's allow-list. */
  aspectRatio?: string;
  /** Image resolution tier, e.g. `2k`. Only set for image models. */
  resolution?: '1k' | '2k' | '4k';
  /** Quality enum for models that support it (gpt_image_2, etc.). */
  quality?: 'low' | 'medium' | 'high';
  /** FLUX.2 sub-model: pro/flex/max. Only for higgsfield-flux-2. */
  submodel?: 'pro' | 'flex' | 'max';
  /** Video duration in seconds. Only for video models. */
  duration?: number;
  /** Video generation mode: std/fast/pro. */
  mode?: 'std' | 'fast' | 'pro';
  /** Cinematic genre. */
  genre?: 'auto' | 'action' | 'horror' | 'comedy' | 'noir' | 'drama' | 'epic';
  /** Video resolution. */
  videoResolution?: '480p' | '720p' | '1080p';
  /** Audio toggle (Kling v3 et al). */
  sound?: 'on' | 'off';
  /** Soul character id, for higgsfield-soul-v2 model. */
  soulId?: string;
  /** Reproducibility seed (only on models that accept it). */
  seed?: number;
  /** Publicly-accessible image URL for img2img / i2v. */
  referenceImageUrl?: string;
  /** Publicly-accessible image URL for i2v last frame. */
  endImageUrl?: string;
  /** Image count for batched generation. */
  quantity?: number;
}

export interface EnhancedPrompt {
  /** Prompt with spec/style/quality hints appended. Use as-is for either
   * provider — keywords are natural language and not provider-specific. */
  prompt: string;
  /** Diagnostic: hints actually appended, in the order they appear. */
  appliedHints: string[];
  /** Structured options for the MMX CLI (`mmx image generate` flags). */
  mmx: MmxImageOptions;
  /** Structured options for the Leonardo /api/leonardo route body. */
  leonardo: LeonardoBuilderOptions;
  /** Structured options for the Higgsfield /api/higgsfield/{image,video}
   * route body. Populated only when the caller passes a
   * `higgsfieldOptions` input; otherwise empty. */
  higgsfield: HiggsfieldBuilderOptions;
}

// ---------------------------------------------------------------------------
// Spec readers (small, defensive)
// ---------------------------------------------------------------------------

function paramValue(spec: ModelSpec, key: string): string | undefined {
  const params = spec.parameters as Record<string, unknown> | undefined;
  const entry = params?.[key];
  if (!entry || typeof entry !== 'object') return undefined;
  const e = entry as { value?: unknown; default?: unknown };
  if (typeof e.value === 'string' || typeof e.value === 'number') return String(e.value);
  if (typeof e.default === 'string' || typeof e.default === 'number') return String(e.default);
  return undefined;
}

function firstAspectRatio(spec: ModelSpec): string | undefined {
  const ratios = spec.aspectRatios;
  if (!ratios || typeof ratios !== 'object') return undefined;
  const keys = Object.keys(ratios as Record<string, unknown>);
  return keys[0];
}

function findStyleEntry(spec: ModelSpec, requested: string):
  | { name: string; id?: string }
  | undefined {
  const styles = spec.styles;
  if (!styles || typeof styles !== 'object') return undefined;
  const lookup = requested.trim().toLowerCase();
  for (const [name, id] of Object.entries(styles)) {
    if (name.toLowerCase() === lookup) {
      return { name, id: typeof id === 'string' ? id : undefined };
    }
  }
  return undefined;
}

/**
 * Resolve [width, height] from spec.aspectRatios[ratio][tier]. The
 * dimension tables in the model specs look like:
 *   "1:1": { "1K": [1024,1024], "2K": [2048,2048], "4K": [4096,4096] }
 * Return undefined when the spec has no dimension table or the requested
 * ratio/tier doesn't exist; callers fall through silently.
 */
function dimsFromSpec(
  spec: ModelSpec,
  ratio: string | undefined,
  tier: string | undefined,
): { width: number; height: number } | undefined {
  if (!ratio) return undefined;
  const ratios = spec.aspectRatios as Record<string, unknown> | undefined;
  const ratioEntry = ratios?.[ratio];
  if (!ratioEntry || typeof ratioEntry !== 'object') return undefined;
  const entries = ratioEntry as Record<string, unknown>;
  const tierKey = tier && tier in entries ? tier : Object.keys(entries)[0];
  if (!tierKey) return undefined;
  const dims = entries[tierKey];
  if (!Array.isArray(dims) || dims.length < 2) return undefined;
  const [w, h] = dims;
  if (typeof w !== 'number' || typeof h !== 'number') return undefined;
  return { width: w, height: h };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compose an enhanced prompt + per-provider structured options from a base
 * prompt and a model-spec selector. Pure function — safe to call from
 * tests, route handlers, or cron without side effects.
 *
 * Both `result.mmx` and `result.leonardo` are always populated. Callers
 * pluck the slice they need based on the user-selected provider; the
 * shared `result.prompt` ensures both providers see the same intent.
 *
 * Production callers: `hooks/useImageGeneration.ts` (Leonardo path)
 * and `app/api/mmx/image/route.ts` (MMX path) both feed user inputs
 * through this composer so the two providers see the same intent.
 * Wiring history: STORY-MMX-PROMPT-WIRE.md.
 */
export function buildEnhancedPrompt(
  basePrompt: string,
  inputs: PromptInjectionInputs = {},
): EnhancedPrompt {
  const spec = inputs.modelId ? getModelSpec(inputs.modelId) : undefined;
  const hintParts: string[] = [];
  const mmx: MmxImageOptions = {};
  const leonardo: LeonardoBuilderOptions = {};
  // HIGGSFIELD-INTEGRATION: start from the spec's `apiName` so the
  // caller doesn't need to know the underlying job_set_type. If no
  // spec is found (ad-hoc Higgsfield call), the caller is expected
  // to pass `higgsfieldOptions.model` explicitly.
  const higgsfield: HiggsfieldBuilderOptions = {
    model:
      (spec?.apiName as string | undefined) ||
      inputs.higgsfieldOptions?.model ||
      '',
  };

  // Style: spec-validated → keyword in prompt + UUID for Leonardo.
  // Bare strings (no spec) still go in as keywords for both providers.
  if (inputs.styleName) {
    if (spec) {
      const found = findStyleEntry(spec, inputs.styleName);
      if (found) {
        hintParts.push(`style: ${found.name}`);
        if (found.id) leonardo.styleIds = [found.id];
      }
    } else {
      hintParts.push(`style: ${inputs.styleName.trim()}`);
    }
  }

  // Aspect ratio — explicit override > first spec entry > nothing.
  const aspect = inputs.aspectRatio ?? (spec ? firstAspectRatio(spec) : undefined);
  if (aspect) {
    mmx.aspectRatio = aspect;
    hintParts.push(`aspect ratio: ${aspect}`);
    if (spec) {
      const dims = dimsFromSpec(spec, aspect, inputs.dimensionTier);
      if (dims) {
        leonardo.width = dims.width;
        leonardo.height = dims.height;
      }
    }
  }

  // Quality pulled from the spec when present. Forwarded as a prompt
  // keyword for both providers; Leonardo also gets it as a structured
  // param it can pass to its REST API. (The legacy `mode` parameter was
  // deprecated by Leonardo on 2026-05-04 — image specs no longer carry it.)
  if (spec) {
    const quality = paramValue(spec, 'quality');
    if (quality) {
      hintParts.push(`quality: ${quality}`);
      leonardo.quality = quality;
    }
    const promptEnhance = paramValue(spec, 'prompt_enhance');
    if (promptEnhance) {
      const upper = promptEnhance.toUpperCase();
      if (upper === 'ON') {
        mmx.promptOptimizer = true;
        leonardo.promptEnhance = 'ON';
      } else if (upper === 'OFF') {
        leonardo.promptEnhance = 'OFF';
      }
    }
  }

  // Free-text quality hint from caller (after spec hints).
  if (inputs.qualityHint && inputs.qualityHint.trim()) {
    hintParts.push(inputs.qualityHint.trim());
  }

  // Image count — all three providers.
  if (inputs.count && inputs.count > 0) {
    mmx.n = inputs.count;
    leonardo.quantity = inputs.count;
    higgsfield.quantity = inputs.count;
  }

  // HIGGSFIELD-INTEGRATION: forward caller-supplied Higgsfield
  // options verbatim. The API layer validates each field against
  // the model allow-list before sending to the MCP server, so this
  // step is pure pass-through.
  if (inputs.higgsfieldOptions) {
    const o = inputs.higgsfieldOptions;
    if (o.aspectRatio) higgsfield.aspectRatio = o.aspectRatio;
    if (o.resolution) higgsfield.resolution = o.resolution;
    if (o.quality) higgsfield.quality = o.quality;
    if (o.submodel) higgsfield.submodel = o.submodel;
    if (typeof o.duration === 'number') higgsfield.duration = o.duration;
    if (o.mode) higgsfield.mode = o.mode;
    if (o.genre) higgsfield.genre = o.genre;
    if (o.videoResolution) higgsfield.videoResolution = o.videoResolution;
    if (o.sound) higgsfield.sound = o.sound;
    if (o.soulId) higgsfield.soulId = o.soulId;
    if (typeof o.seed === 'number') higgsfield.seed = o.seed;
    if (o.referenceImageUrl) higgsfield.referenceImageUrl = o.referenceImageUrl;
    if (o.endImageUrl) higgsfield.endImageUrl = o.endImageUrl;
  }
  // Fill in the aspect ratio from the prompt inputs when the caller
  // didn't pass a higgsfieldOptions aspectRatio — keeps the three
  // providers in sync (mmx + leonardo are also filled above).
  if (!higgsfield.aspectRatio && aspect) {
    higgsfield.aspectRatio = aspect;
  }

  const prompt = hintParts.length > 0
    ? `${basePrompt.trim()}. ${hintParts.join(', ')}`
    : basePrompt.trim();

  return { prompt, appliedHints: hintParts, mmx, leonardo, higgsfield };
}
