'use client';

import { useState } from 'react';
import { streamAIToString, extractJsonArrayFromLLM } from '@/lib/aiClient';
import { enhancePromptForModel } from '@/lib/modelOptimizer';
import { buildEnhancedPrompt } from '@/lib/image-prompt-builder';
import { checkBudget, incrementCredits, loadCreditUsage } from '@/lib/credit-budget';
import { getModelSpec } from '@/lib/model-specs';
import { MASTERPROMPT_INSTRUCTIONS } from '@/lib/masterpromptTemplate';
import { getErrorMessage } from '@/lib/errors';
import { fetchWithRetry } from '@/lib/fetchWithRetry';
import { extractTrademarkNames } from '@/lib/extract-trademark-names';
import { planStagedSubstitution, setOutcome } from '@/lib/trademark-outcomes';
import { MASHUPFORGE_AI_PERSONA } from '@/lib/agent-prompt';
import {
  type GeneratedImage,
  type GenerateOptions,
  type UserSettings,
  LEONARDO_MODELS,
  getLeonardoDimensions,
} from '../types/mashup';
import { pickDefaultImageModel, pickHiggsfieldModelForCycle, getImageModel, type ImageProvider } from '../lib/image-models';
import { persistImageToDisk } from '../lib/images/storage';
// V1.7.0-M2.1: contextual camera angle — AI picks a fitting angle per item,
// settings.cameraAngle acts as an optional lock. See lib/camera-angles.ts.
import { buildCameraAngleMenu, isCameraAngleId, resolveEffectiveCameraAngle } from '../lib/camera-angles';
import { applyWatermark } from '../lib/watermark';

function getModelName(id: string): string {
  return getImageModel(id)?.name || id;
}

interface GeneratedItem {
  prompt: string;
  aspectRatio?: string;
  tags?: string[];
  selectedNiches?: string[];
  selectedGenres?: string[];
  negativePrompt?: string;
  // V1.7.0-M2.1: per-item camera angle chosen by the idea model from the
  // 14-slug catalog. Validated against the catalog at parse time; an
  // invalid/absent value falls back to settings.cameraAngle.
  cameraAngle?: string;
}

function pickStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strs = value.filter((v): v is string => typeof v === 'string');
  return strs.length > 0 ? strs : undefined;
}

// V1.7.0-M2.1: exported for unit tests (per-item cameraAngle validation).
export function parseGeneratedItems(raw: string): GeneratedItem[] {
  return extractJsonArrayFromLLM(raw)
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      prompt: typeof item.prompt === 'string' ? item.prompt : '',
      aspectRatio: typeof item.aspectRatio === 'string' ? item.aspectRatio : undefined,
      tags: pickStringArray(item.tags),
      selectedNiches: pickStringArray(item.selectedNiches),
      selectedGenres: pickStringArray(item.selectedGenres),
      negativePrompt: typeof item.negativePrompt === 'string' ? item.negativePrompt : undefined,
      // V1.7.0-M2.1: only accept a catalog slug; anything else (model
      // hallucinated a label, free text, etc.) is dropped so the composer
      // never sees an unresolvable angle.
      cameraAngle: isCameraAngleId(item.cameraAngle) ? item.cameraAngle : undefined,
    }))
    .filter((item) => item.prompt.length > 0);
}

// V1.5: applyWatermark moved to lib/watermark.ts (it has no hook/React
// dependencies — a pure canvas op). Imported for this hook's own
// generation path AND re-exported so every existing importer
// (MashupContext, useComparison, …) keeps working unchanged.
export { applyWatermark };

/**
 * Submit-and-poll helper used by both the main generate loop and
 * rerollImage. Returns the Leonardo success payload or throws. On
 * FAILED the thrown Error is annotated with `moderationClassification`
 * and `failedPrompt` so callers can detect content-moderation blocks
 * and decide whether to rewrite + retry.
 */
interface LeonardoSubmitParams {
  prompt: string;
  negativePrompt?: string;
  /** V1.0.7-PROMPT-ENG-A4: anti-AI-look curated negative prompts from
   *  buildEnhancedPrompt. Joined with `negativePrompt` inside
   *  submitLeonardoAndPoll before sending to the API. Empty array
   *  means "no anti-AI-look" — equivalent to the prior behavior. */
  antiAiLookNegatives?: string[];
  modelId: string;
  width: number;
  height: number;
  styleIds?: string[];
  apiKey?: string;
  quality?: string;
  /**
   * IMG-INVEST-001 issue 1: Leonardo's `prompt_enhance` knob, threaded
   * from the model spec via lib/image-prompt-builder.ts. When omitted,
   * the API route defaults to `'ON'` for back-compat. Pipeline-style
   * model specs that set `prompt_enhance: 'OFF'` (to skip Leonardo's
   * own rewrite because the client already enhanced) finally land
   * through this field instead of being silently dropped.
   */
  promptEnhance?: 'ON' | 'OFF';
}

interface LeonardoSuccess {
  url: string;
  imageId?: string;
  seed?: number;
}

export type LeonardoGenerationError = Error & {
  moderationClassification?: string[];
  failedPrompt?: string;
  moderation?: unknown;
};

/**
 * Poll Leonardo's status endpoint until the generation is COMPLETE,
 * FAILED, or we hit the attempt cap. Shared by `submitLeonardoAndPoll`
 * (Leonardo-only path) and `submitViaAiImage` (vercel-ai orchestrator
 * path). On FAILED, the thrown error is annotated with the moderation
 * classifications + failedPrompt so the caller can decide whether to
 * rewrite + retry.
 */
async function pollLeonardoGeneration(
  generationId: string,
  promptForErrorContext: string,
): Promise<LeonardoSuccess> {
  // Initial delay: Leonardo's Hasura layer needs ~3s to commit the
  // generation before status polls return a usable result.
  await new Promise(resolve => setTimeout(resolve, 3000));
  let attempts = 0;
  while (attempts < 150) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    attempts++;
    const statusRes = await fetch(`/api/leonardo/${generationId}`);
    if (!statusRes.ok) {
      const errText = await statusRes.text();
      throw new Error(`Failed to check status: ${errText.slice(0, 100)}`);
    }
    const statusData = await statusRes.json();
    if (statusData.status === 'COMPLETE') {
      return {
        url: statusData.url,
        imageId: statusData.imageId,
        seed: statusData.seed,
      };
    }
    if (statusData.status === 'FAILED') {
      const classifications: string[] = Array.isArray(statusData.moderation?.moderationClassification)
        ? statusData.moderation.moderationClassification
        : [];
      const err = new Error(statusData.error || 'Leonardo generation failed') as LeonardoGenerationError;
      err.moderationClassification = classifications;
      err.failedPrompt = statusData.failedPrompt || promptForErrorContext;
      err.moderation = statusData.moderation;
      throw err;
    }
  }
  throw new Error('Timeout waiting for Leonardo generation');
}

async function submitLeonardoAndPoll(params: LeonardoSubmitParams): Promise<LeonardoSuccess> {
  // V1.0.7-PROMPT-ENG-A4: join the user-supplied negative prompt
  // with the anti-AI-look curated list. Leonardo takes a single
  // `negative_prompt` string — comma-separated is the conventional
  // concat. We keep undefined as the empty case so the route layer's
  // "if defined, send" logic still treats no-negatives as "no field".
  const joinedNegatives = [params.negativePrompt, ...(params.antiAiLookNegatives ?? [])]
    .filter((s): s is string => Boolean(s && s.trim()))
    .join(', ') || undefined;

  const res = await fetchWithRetry('/api/leonardo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: params.prompt,
      negative_prompt: joinedNegatives,
      modelId: params.modelId,
      width: params.width,
      height: params.height,
      styleIds: params.styleIds,
      apiKey: params.apiKey,
      quality: params.quality || 'HIGH',
      promptEnhance: params.promptEnhance,
    }),
  });
  if (!res.ok) {
    let errMessage = 'Leonardo API failed';
    try {
      const errData = await res.json();
      errMessage = errData.error || errMessage;
    } catch {
      const text = await res.text();
      errMessage = `Server error (${res.status}): ${text.slice(0, 100)}...`;
    }
    throw new Error(errMessage);
  }
  const data = await res.json();
  if (!data.generationId) throw new Error('Leonardo returned no generationId');

  return pollLeonardoGeneration(data.generationId, params.prompt);
}

/**
 * vercel-ai orchestrator path. Submits via `/api/ai/image` which
 * server-side runs MiniMax-enhance + Leonardo-submit, then polls the
 * existing `/api/leonardo/{id}` route just like submitLeonardoAndPoll.
 *
 * Set `skipEnhance: true` to bypass MiniMax (used by the moderation
 * retry, which has already produced a rewritten prompt and just wants
 * the Leonardo submit half).
 */
interface AiImageSubmitParams {
  idea: string;
  modelId: string;
  width: number;
  height: number;
  styleIds?: string[];
  quality?: 'LOW' | 'MEDIUM' | 'HIGH';
  negativePrompt?: string;
  /** V1.0.7-PROMPT-ENG-A4: same as LeonardoSubmitParams.antiAiLookNegatives
   *  — joined with `negativePrompt` in submitViaAiImage before the
   *  /api/ai/image request body. */
  antiAiLookNegatives?: string[];
  systemPrompt?: string;
  niches?: string[];
  genres?: string[];
  apiKey?: string;
  skipEnhance?: boolean;
  /**
   * IMG-INVEST-001 issue 1: forward the model spec's prompt_enhance
   * value all the way to Leonardo so pipeline-style specs can disable
   * Leonardo's own enhancement (we already MiniMax-enhanced server-side).
   */
  promptEnhance?: 'ON' | 'OFF';
}

interface AiImageSubmitResult extends LeonardoSuccess {
  enhancedPrompt: string;
}

async function submitViaAiImage(params: AiImageSubmitParams): Promise<AiImageSubmitResult> {
  // V1.0.7-PROMPT-ENG-A4: same join pattern as submitLeonardoAndPoll.
  const joinedNegatives = [params.negativePrompt, ...(params.antiAiLookNegatives ?? [])]
    .filter((s): s is string => Boolean(s && s.trim()))
    .join(', ') || undefined;

  const res = await fetchWithRetry('/api/ai/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idea: params.idea,
      modelId: params.modelId,
      width: params.width,
      height: params.height,
      styleIds: params.styleIds,
      quality: params.quality,
      negativePrompt: joinedNegatives,
      systemPrompt: params.systemPrompt,
      niches: params.niches,
      genres: params.genres,
      apiKey: params.apiKey,
      skipEnhance: params.skipEnhance === true,
      promptEnhance: params.promptEnhance,
    }),
  });
  if (!res.ok) {
    let errMessage = 'vercel-ai image orchestrator failed';
    try {
      const errData = await res.json();
      errMessage = errData.error || errMessage;
    } catch {
      const text = await res.text();
      errMessage = `Server error (${res.status}): ${text.slice(0, 100)}…`;
    }
    throw new Error(errMessage);
  }
  const data = (await res.json()) as {
    generationId?: string;
    prompt?: string;
  };
  if (!data.generationId || typeof data.prompt !== 'string') {
    throw new Error('Orchestrator returned no generationId/prompt');
  }
  const success = await pollLeonardoGeneration(data.generationId, data.prompt);
  return { ...success, enhancedPrompt: data.prompt };
}

/**
 * Submit a MiniMax-native image generation job. Synchronous: one POST
 * returns ready URLs or a structured error — no polling phase, no
 * moderation-retry path (MiniMax's content-filter codes are surfaced
 * via the route's structured `error` field instead).
 *
 * Returns the same `LeonardoSuccess` shape that submitLeonardoAndPoll
 * produces so the downstream watermark/state/tag pipeline doesn't need
 * to branch on provider.
 */
interface MinimaxImageParams {
  prompt: string;
  width: number;
  height: number;
  aspectRatio?: string;
  quantity?: number;
  promptOptimizer?: boolean;
  seed?: number;
}

/**
 * HIGGSFIELD-INTEGRATION: submit a generation through the Higgsfield
 * MCP server (via the /api/higgsfield/image route). Same
 * `LeonardoSuccess` return shape as the other providers. The route
 * may return a `completed: false` + `requestId` when the job is
 * long-running; we poll the status route in that case (capped at
 * 5 minutes, matching the Leonardo polling shape).
 *
 * Errors propagate as plain `Error` with the route's `error` field
 * as the message. 401 means the user needs to OAuth their Higgsfield
 * account in Settings (we don't try to re-auth from the client).
 */
interface HiggsfieldImageParams {
  prompt: string;
  modelId: string;            // e.g. 'higgsfield-nano-banana-pro'
  apiName: string;            // e.g. 'nano_banana_2'
  aspectRatio?: string;
  resolution?: '1k' | '2k' | '4k';
  quality?: 'low' | 'medium' | 'high';
  submodel?: 'pro' | 'flex' | 'max';
  referenceImageUrl?: string;
  seed?: number;
  /**
   * V1.4.0: optional CLI token from settings. When present, the
   * server route uses the CLI binary path (HiggsfieldCliAdapter)
   * instead of the OAuth MCP path. With `useImageGeneration` now
   * auto-picking Higgsfield, this is the common case for pipeline
   * runs.
   */
  higgsfieldCliToken?: string;
}

interface HiggsfieldImageResult extends LeonardoSuccess {
  enhancedPrompt: string;
}

async function submitHiggsfieldImage(params: HiggsfieldImageParams): Promise<HiggsfieldImageResult> {
  const res = await fetchWithRetry('/api/higgsfield/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: params.prompt,
      model: params.apiName,
      aspectRatio: params.aspectRatio,
      resolution: params.resolution,
      quality: params.quality,
      // FLUX.2 sub-model: we forward as part of the prompt args; the
      // route includes it only when the model is flux_2.
      referenceImageUrl: params.referenceImageUrl,
      seed: params.seed,
      // V1.4.0: forward the user's CLI token so the server uses the
      // CLI binary path. Without this, the route tries OAuth and
      // returns 401 for users who never went through the OAuth flow.
      higgsfieldCliToken: params.higgsfieldCliToken,
    }),
  });
  if (!res.ok) {
    let errMessage = 'Higgsfield image generation failed';
    try {
      const errData = await res.json();
      errMessage = errData.error || errMessage;
    } catch {
      const text = await res.text();
      errMessage = `Server error (${res.status}): ${text.slice(0, 100)}…`;
    }
    throw new Error(errMessage);
  }
  const data = (await res.json()) as {
    completed?: boolean;
    imageUrl?: string;
    requestId?: string;
    model?: string;
  };
  if (data.completed && typeof data.imageUrl === 'string' && data.imageUrl) {
    return { url: data.imageUrl, enhancedPrompt: params.prompt };
  }
  if (data.requestId) {
    // Async path: poll /api/higgsfield/status/{requestId}. Same 2s
    // interval + 5min cap as the Leonardo path.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    for (let i = 0; i < 150; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const statusRes = await fetch(`/api/higgsfield/status/${data.requestId}`);
      if (!statusRes.ok) continue;
      const status = (await statusRes.json()) as {
        status?: string;
        imageUrl?: string;
        videoUrl?: string;
        error?: string;
      };
      if (status.status === 'completed' && typeof status.imageUrl === 'string') {
        return { url: status.imageUrl, enhancedPrompt: params.prompt };
      }
      if (status.status === 'failed' || status.status === 'nsfw') {
        throw new Error(status.error || `Higgsfield job ${status.status}`);
      }
    }
    throw new Error('Timeout waiting for Higgsfield image');
  }
  throw new Error('Higgsfield returned no image URL or request id');
}

async function submitMinimaxImage(params: MinimaxImageParams): Promise<LeonardoSuccess> {
  const res = await fetchWithRetry('/api/minimax-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: params.prompt,
      aspectRatio: params.aspectRatio,
      width: params.width,
      height: params.height,
      n: params.quantity ?? 1,
      promptOptimizer: params.promptOptimizer ?? false,
      seed: params.seed,
    }),
  });
  if (!res.ok) {
    let errMessage = 'MiniMax image generation failed';
    try {
      const errData = await res.json();
      errMessage = errData.error || errMessage;
    } catch {
      const text = await res.text();
      errMessage = `Server error (${res.status}): ${text.slice(0, 100)}…`;
    }
    throw new Error(errMessage);
  }
  const data = (await res.json()) as {
    images?: Array<{ url?: string; width?: number; height?: number }>;
    generationId?: string;
  };
  const first = Array.isArray(data.images) ? data.images[0] : undefined;
  if (!first || typeof first.url !== 'string' || !first.url) {
    throw new Error('MiniMax returned no usable image URL');
  }
  return {
    url: first.url,
    imageId: data.generationId,
  };
}

/**
 * TRADEMARK-SELF-HEAL (2026-05-21): the previous one-size-fits-all
 * instruction said "Keep the character names and core concept" — which
 * is exactly the wrong move for TRADEMARK rejections (Leonardo flagged
 * the named character; keeping the name guarantees the retry also
 * fails). Classification-aware now:
 *
 * - TRADEMARK / COPYRIGHT → instruct the AI to swap named IP for
 *   generic descriptors ("Spider-Man" → "a spider-powered hero",
 *   "Grogu" → "a small green alien"). The model already knows the
 *   franchise mappings; embedding a hardcoded mapping table would
 *   rot the moment a new franchise lands. The "core concept" framing
 *   is dropped — for trademark, the concept WAS the violation.
 * - NSFW / EXTREME_VIOLENCE / CHILD → keep names, soften imagery
 *   (the original behaviour, useful for over-aggressive moderation).
 * - Default / unknown → conservative fallback identical to pre-fix.
 *
 * Maurice reported: every pipeline run currently fails on Spider-Man /
 * Grogu / Mandalorian mashups because the rewrite kept the name.
 */
export function buildModerationRewriteInstruction(
  failedPrompt: string,
  classifications: string[] = [],
): string {
  const upper = classifications.map((c) => c.toUpperCase());
  const isTrademark = upper.some((c) => c === 'TRADEMARK' || c === 'COPYRIGHT');
  const isContentBlock = upper.some((c) => c === 'NSFW' || c === 'EXTREME_VIOLENCE' || c === 'CHILD');

  if (isTrademark) {
    // TRADEMARK-SURGICAL-REWRITE (2026-05-21): Maurice reported the
    // previous instruction (4bc046b) was destroying prompts. The
    // "drop the named-character anchor" framing + the franchise-example
    // list (e.g. "Black Panther" → "a panther-themed warrior") trained
    // the LLM to over-generalize — it stripped scene/mood/style/
    // composition along with the name, and even non-trademarked-but-
    // adjacent-sounding names (e.g. "Viktor von Doom") got rewritten
    // because the examples taught the model to recognise IP-shaped
    // patterns broadly.
    //
    // New rule: SURGICAL substitution only. Replace ONLY the specific
    // trademark trigger with a brief visual descriptor that preserves
    // the character's distinctive look (colors, silhouette, key props).
    // Every other word — scene, lighting, action, composition, style,
    // mood, location — must survive verbatim. One positive example
    // showing the minimal-edit shape; no franchise list to avoid
    // teaching the model to recognise more names than it should.
    return `This prompt was blocked by content moderation for TRADEMARK / COPYRIGHT — one specific named-IP character triggered it.

CRITICAL RULES (read carefully):
1. Identify which character NAME(S) in the prompt are the likely trademark trigger.
2. Replace ONLY those name(s) with a brief visual descriptor that preserves the character's distinctive look (colors, silhouette, signature props).
3. Every OTHER word in the prompt — scene, mood, composition, lighting, action, location, style, era, time-of-day, camera angle, art style, weather, expressions — MUST be preserved EXACTLY as written. Do not paraphrase, condense, or "improve" them.
4. Do NOT generalize non-trademarked descriptions. If the prompt says "Viktor von Doom" but that's a fictional character not on any trademark list, leave it alone.
5. Do NOT shorten the prompt. The output should have a similar word count to the input, with only the trigger name swapped.

Surgical edit example:
- Input:  "Spider-Man swinging through neon Tokyo at night, cinematic lighting, 35mm film grain, dynamic action pose, low angle"
- Output: "a red and blue spider-themed hero in a web-pattern suit swinging through neon Tokyo at night, cinematic lighting, 35mm film grain, dynamic action pose, low angle"

Notice: only the character name changed. Every other word is identical.

Return ONLY the rewritten prompt — no preamble, no explanation, no list of changes.

BLOCKED PROMPT:
${failedPrompt}

REWRITTEN PROMPT:`;
  }

  if (isContentBlock) {
    return `This prompt was blocked by content moderation (${classifications.join(', ')}). Rewrite it to be cleaner and shorter (40–60 words max). Remove any violence, gore, or explicit language. Keep the character names and core concept. Return ONLY the rewritten prompt.

BLOCKED PROMPT:
${failedPrompt}

REWRITTEN PROMPT:`;
  }

  // Unknown / mixed classification — conservative fallback (pre-fix wording).
  return `This prompt was blocked by content moderation. Rewrite it to be cleaner and shorter (40–60 words max). Remove any violence, gore, or explicit language. Keep the character names and core concept. Return ONLY the rewritten prompt.

BLOCKED PROMPT:
${failedPrompt}

REWRITTEN PROMPT:`;
}

interface ModerationRetryCallback {
  /** Fires once if the first submission hits a moderation block and we're about to rewrite-and-retry. */
  onRetry: (classifications: string[]) => void;
}

interface SubmitResult {
  success: LeonardoSuccess;
  finalPrompt: string;
  /** true if the second attempt (rewrite) was used. false means first try succeeded. */
  retried: boolean;
}

/**
 * SUCCESS-PATH-ALLOWED-MARKING (2026-05-22): when a generation
 * succeeds on first try (no retry), every trademark-list name that
 * appeared in the submitted prompt is recorded as 'allowed' in the
 * outcome store. Future TRADEMARK blocks involving other prompts that
 * happen to contain these names won't auto-substitute them — the
 * substitution path filters to names with outcome 'blocked' only.
 *
 * setOutcome's sticky-blocked guard (lib/trademark-outcomes.ts) means
 * we can never revive a previously-blocked name to 'allowed' by a
 * coincidental success — once a name has reliably failed, the
 * 'allowed' marking is a no-op.
 *
 * Only call on FIRST-TRY successes (the success path before the
 * retry catch). A success that came AFTER a retry doesn't prove the
 * names are allowed — the retry's substitution may have removed them.
 */
function markPromptNamesAllowed(prompt: string, modelId: string): void {
  const names = extractTrademarkNames(prompt);
  for (const name of names) setOutcome(name, 'allowed', modelId);
}

/**
 * TRADEMARK-STAGED-PIPELINE (2026-05-22): 3-stage moderation recovery.
 *
 * Maurice's spec: a TRADEMARK/COPYRIGHT block does NOT pre-emptively
 * rewrite the user's prompt and does NOT swap every famous name at
 * once. It tries the original verbatim, then a single-term minimal
 * swap, then a single-term rich descriptor swap — surfacing the error
 * only after all three fail.
 *
 *   Stage 1: original prompt VERBATIM.
 *   Stage 2: on TRADEMARK fail, pick ONE term (planStagedSubstitution),
 *            swap with the minimal placeholder ("a character"), retry.
 *   Stage 3: still TRADEMARK fail, swap the SAME term with the rich
 *            GENERIC_FOR descriptor, retry. This is the last resort.
 *
 * Non-TRADEMARK moderation (NSFW / EXTREME_VIOLENCE / CHILD) keeps
 * the single-shot LLM rewrite — that's a legitimate softening task,
 * not a one-word-swap task, and the staged pipeline doesn't help.
 *
 * Non-moderation errors rethrow immediately.
 */
async function submitWithOneRetry(
  initialPrompt: string,
  baseParams: Omit<LeonardoSubmitParams, 'prompt'>,
  callbacks: ModerationRetryCallback,
  // M3.3-P3 commit a: narrowed to `'vercel-ai' | undefined`. The
  // provider argument is now purely a forwarder to
  // `lib/aiClient.ts:streamAIToString`; the legacy pi/nca/mmx routes
  // are gone.
  provider?: 'vercel-ai',
): Promise<SubmitResult> {
  // STAGE 1 — original prompt verbatim.
  try {
    const success = await submitLeonardoAndPoll({ prompt: initialPrompt, ...baseParams });
    markPromptNamesAllowed(initialPrompt, baseParams.modelId);
    return { success, finalPrompt: initialPrompt, retried: false };
  } catch (err) {
    const lErr = err as LeonardoGenerationError;
    const classifications = lErr.moderationClassification || [];
    if (classifications.length === 0) throw err;

    const upper = classifications.map((c) => c.toUpperCase());
    const isTrademark = upper.some((c) => c === 'TRADEMARK' || c === 'COPYRIGHT');

    callbacks.onRetry(classifications);

    if (!isTrademark) {
      // NSFW / EXTREME_VIOLENCE / CHILD — single LLM rewrite, one retry.
      const rewritten = await streamAIToString(
        buildModerationRewriteInstruction(lErr.failedPrompt || initialPrompt, classifications),
        { mode: 'enhance', provider },
      );
      const activePrompt = (rewritten || '').trim() || initialPrompt;
      const success = await submitLeonardoAndPoll({ prompt: activePrompt, ...baseParams });
      return { success, finalPrompt: activePrompt, retried: true };
    }

    // pollLeonardoGeneration always annotates failedPrompt on moderation
    // errors (statusData.failedPrompt, or the submitted prompt as fallback),
    // and we only reach here when classifications.length > 0 — so the
    // `|| initialPrompt` branch is defensive padding, not a live fallback.
    const plan = planStagedSubstitution(lErr.failedPrompt || initialPrompt, baseParams.modelId);
    if (!plan) {
      // No eligible name to swap (none extracted, or all user-whitelisted).
      // Surface the original moderation error so the user edits manually.
      throw err;
    }
    // The picked term is by definition a real blocker for this model now —
    // record it so future prompts for this model skip it pre-flight.
    setOutcome(plan.targetName, 'blocked', baseParams.modelId);

    // STAGE 2 — minimal placeholder swap.
    try {
      const success = await submitLeonardoAndPoll({ prompt: plan.stage2Prompt, ...baseParams });
      return { success, finalPrompt: plan.stage2Prompt, retried: true };
    } catch (err2) {
      const l2 = err2 as LeonardoGenerationError;
      const c2 = (l2.moderationClassification || []).map((c) => c.toUpperCase());
      const stillTrademark = c2.some((c) => c === 'TRADEMARK' || c === 'COPYRIGHT');
      if (!stillTrademark) throw err2;
      // STAGE 3 — same target, rich descriptor.
      const success = await submitLeonardoAndPoll({ prompt: plan.stage3Prompt, ...baseParams });
      return { success, finalPrompt: plan.stage3Prompt, retried: true };
    }
  }
}

/**
 * Same one-shot moderation-retry shape as `submitWithOneRetry`, but
 * the underlying submit goes through `/api/ai/image` (server-side
 * MiniMax-enhance + Leonardo-submit). On retry, the client asks
 * MiniMax for a clean rewrite of the failed prompt, then re-submits
 * via `/api/ai/image` with `skipEnhance: true` so the orchestrator
 * doesn't re-enhance the already-rewritten text.
 */
interface AiImageContext {
  systemPrompt?: string;
  niches?: string[];
  genres?: string[];
  apiKey?: string;
}

async function submitViaAiImageWithOneRetry(
  initialIdea: string,
  baseParams: Omit<AiImageSubmitParams, 'idea' | 'skipEnhance'>,
  context: AiImageContext,
  callbacks: ModerationRetryCallback,
): Promise<SubmitResult> {
  // STAGE 1 — original idea (server enhances + submits).
  try {
    const r = await submitViaAiImage({
      ...baseParams,
      ...context,
      idea: initialIdea,
      skipEnhance: false,
    });
    markPromptNamesAllowed(r.enhancedPrompt, baseParams.modelId);
    return { success: r, finalPrompt: r.enhancedPrompt, retried: false };
  } catch (err) {
    const lErr = err as LeonardoGenerationError;
    const classifications = lErr.moderationClassification || [];
    if (classifications.length === 0) throw err;

    const upper = classifications.map((c) => c.toUpperCase());
    const isTrademark = upper.some((c) => c === 'TRADEMARK' || c === 'COPYRIGHT');

    callbacks.onRetry(classifications);

    if (!isTrademark) {
      const rewritten = await streamAIToString(
        buildModerationRewriteInstruction(lErr.failedPrompt || initialIdea, classifications),
        { mode: 'enhance', provider: 'vercel-ai' },
      );
      const activePrompt = (rewritten || '').trim() || initialIdea;
      const r = await submitViaAiImage({
        ...baseParams,
        ...context,
        idea: activePrompt,
        skipEnhance: true,
      });
      return { success: r, finalPrompt: r.enhancedPrompt, retried: true };
    }

    // TRADEMARK-STAGED-PIPELINE: plan against the enhanced prompt that
    // Leonardo actually saw (lErr.failedPrompt), not the rough idea —
    // the orchestrator's enhancement may have introduced names that
    // aren't in the user's idea string. pollLeonardoGeneration always
    // sets failedPrompt for moderation FAILED responses (server's
    // statusData.failedPrompt or the submitted prompt as fallback), and
    // this branch is only reached on classifications.length > 0, so the
    // `|| initialIdea` is defensive padding for an unreachable case.
    const plan = planStagedSubstitution(lErr.failedPrompt || initialIdea, baseParams.modelId);
    if (!plan) throw err;
    setOutcome(plan.targetName, 'blocked', baseParams.modelId);

    // STAGE 2 — minimal swap. skipEnhance so the orchestrator submits
    // the swapped prompt verbatim.
    try {
      const r = await submitViaAiImage({
        ...baseParams,
        ...context,
        idea: plan.stage2Prompt,
        skipEnhance: true,
      });
      return { success: r, finalPrompt: r.enhancedPrompt, retried: true };
    } catch (err2) {
      const l2 = err2 as LeonardoGenerationError;
      const c2 = (l2.moderationClassification || []).map((c) => c.toUpperCase());
      const stillTrademark = c2.some((c) => c === 'TRADEMARK' || c === 'COPYRIGHT');
      if (!stillTrademark) throw err2;
      // STAGE 3 — rich descriptor swap, same target term.
      const r = await submitViaAiImage({
        ...baseParams,
        ...context,
        idea: plan.stage3Prompt,
        skipEnhance: true,
      });
      return { success: r, finalPrompt: r.enhancedPrompt, retried: true };
    }
  }
}

export interface LastGenerationError {
  message: string;
  classifications: string[];
  failedPrompt?: string;
  /** true when the retry also failed and the user needs to edit manually. */
  retried: boolean;
}

interface UseImageGenerationDeps {
  settings: UserSettings;
  updateImageTags: (id: string, tags: string[]) => void;
}

export function useImageGeneration({ settings, updateImageTags }: UseImageGenerationDeps) {
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState('');
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [lastError, setLastError] = useState<LastGenerationError | null>(null);

  const clearGenerationError = () => setGenerationError(null);
  const clearLastError = () => setLastError(null);

  const autoTagImage = async (id: string, providedImg?: GeneratedImage) => {
    const img = providedImg || [...images].find(i => i.id === id);
    if (!img) return;

    try {
      const text = await streamAIToString(
        `Analyze this image prompt: "${img.prompt}".
Generate a set of 5-8 fitting tags for a gallery. Include:
- Universe/Franchise (e.g., "Warhammer 40k", "Star Wars", "Marvel")
- Character names
- Style (e.g., "Cinematic", "Cyberpunk", "Grimdark")
- Themes (e.g., "Battle", "Portrait", "Landscape")
Return ONLY a JSON array of strings, nothing else.`,
        { mode: 'tag', provider: settings.activeAiAgent, model: settings.activeTextModel, activeSkills: settings.activeSkills }
      );
      let tags: unknown[] = [];
      try {
        tags = extractJsonArrayFromLLM(text);
      } catch {
        tags = ['Mashup'];
      }
      const strTags = tags
        .filter((t): t is string => typeof t === 'string')
        .map((t) => (t === 'Warhammer 40,000' ? 'Warhammer 40k' : t));
      if (strTags.length > 0) {
        updateImageTags(id, strTags);
      }
    } catch {
      // auto-tag is best-effort; silently skip on failure
    }
  };

  const setImageStatus = (id: string, status: 'generating' | 'animating' | 'ready') => {
    setImages(prev => prev.map(img => img.id === id ? { ...img, status } : img));
  };

  const generateNegativePrompt = async (idea: string) => {
    try {
      const text = await streamAIToString(
        `Given this image generation idea: "${idea}"
Generate a concise negative prompt that would help avoid common issues in AI image generation.
Focus on: blurry, low quality, deformed, extra limbs, bad anatomy, watermark, text overlay.
Keep it under 100 words. Return ONLY the negative prompt text, nothing else.`,
        { mode: 'negative-prompt', provider: settings.activeAiAgent, model: settings.activeTextModel, activeSkills: settings.activeSkills }
      );
      return text.trim();
    } catch {
      return '';
    }
  };

  const generateImages = async (customPrompts?: string[], append: boolean = false, options?: GenerateOptions) => {
    setIsGenerating(true);
    setGenerationError(null);
    const placeholders: GeneratedImage[] = (customPrompts || [1, 2, 3, 4]).map((_, idx) => ({
      id: `placeholder-${Date.now()}-${idx}`,
      prompt: typeof _ === 'string' ? _ : 'Generating...',
      status: 'generating',
      url: '',
    }));

    if (!append) {
      setImages(placeholders);
    } else {
      setImages(prev => [...prev, ...placeholders]);
    }

    setProgress(append ? 'Generating image...' : 'Brainstorming crossover concepts...');

    try {
      let itemsToGenerate: {
        prompt: string,
        aspectRatio?: string,
        tags?: string[],
        selectedNiches?: string[],
        selectedGenres?: string[],
        negativePrompt?: string,
        cameraAngle?: string
      }[] = [];
      const ensureTags = async (prompt: string, existingTags?: string[]) => {
        if (existingTags && existingTags.length > 0) return existingTags;
        try {
          const text = await streamAIToString(
            `Analyze this image prompt: "${prompt}". Generate 5-8 fitting tags (universe, character, style, theme). Return ONLY a JSON array of strings.`,
            { mode: 'tag', provider: settings.activeAiAgent, model: settings.activeTextModel, activeSkills: settings.activeSkills }
          );
          const parsed = extractJsonArrayFromLLM(text);
          const strTags = parsed.filter((t): t is string => typeof t === 'string');
          return strTags.length > 0 ? strTags : ['Mashup'];
        } catch {
          return ['Mashup'];
        }
      };

      // Single source of truth: settings.agentPrompt carries diversity
      // rules, art direction, and universe-blending guidance. Content
      // Pillars + Style Tags (was Niches + Genres) are appended as
      // live context so the active tag chips in Settings still shape
      // each batch.
      // AI-ROLE-REDESIGN (2026-05-22): MashupForge AI persona fallback
      // + label rename; agentNiches/agentGenres keys unchanged.
      const systemContext = `${settings.agentPrompt || MASHUPFORGE_AI_PERSONA}
Content Pillars: ${settings.agentNiches?.join(', ') || 'All — pick freely'}
Style Tags: ${settings.agentGenres?.join(', ') || 'All — pick freely'}`;

      if (options?.skipEnhance && customPrompts) {
        itemsToGenerate = customPrompts.map(p => ({ prompt: p, aspectRatio: options?.aspectRatio }));
      } else if (!customPrompts || customPrompts.length === 0) {
        const promptText = await streamAIToString(
          `${systemContext}

${MASTERPROMPT_INSTRUCTIONS}

═══════════════════════════════════════════════════
TASK
═══════════════════════════════════════════════════
Generate 4 SHORT image prompts (40–60 words EACH) following the rules above. Leonardo's prompt_enhance will expand them — do NOT write long descriptions yourself. Maximum variety in characters, franchises, and settings. Do NOT repeat characters across the 4 prompts.

Return ONLY a JSON array of 4 objects, each with:
- "prompt": string — 40–60 words, named character + ONE equipment fusion + short setting + 1–2 quality tags
- "aspectRatio": string — "16:9" for wide/epic, "9:16" for portrait/character, "1:1" otherwise
- "tags": array of strings — 5-8 tags (universes, characters, themes)
- "selectedNiches": array of strings
- "selectedGenres": array of strings
- "negativePrompt": string — 15 words max, CONTEXT-AWARE to the prompt's subject. Pick from: character art → "bad anatomy, wrong proportions, extra fingers, mutated hands"; landscapes → "overexposed, washed out, text, watermark, signature"; action scenes → "motion blur, static pose, flat lighting"; dark/grimdark → "bright colors, cartoon style, flat shading". Always include the core technical defects (blurry, low quality, deformed).
- "cameraAngle": string — the ONE camera-angle id from the catalog below that best fits THIS prompt's mood and subject. Use the id exactly as written (e.g. "low-angle-30"), not the label. Vary it across the 4 prompts where it suits them.

CAMERA ANGLE CATALOG (pick the id that matches the emotional intent):
${buildCameraAngleMenu()}

Random Seed: ${Math.random()}`,
          { mode: 'idea', provider: settings.activeAiAgent, model: settings.activeTextModel, niches: settings.agentNiches, genres: settings.agentGenres, activeSkills: settings.activeSkills }
        );

        try {
          itemsToGenerate = parseGeneratedItems(promptText);
        } catch {
          itemsToGenerate = [
            { prompt: 'A Space Marine from Warhammer 40k wielding a lightsaber from Star Wars, standing on a desolate alien planet.', aspectRatio: '16:9', tags: ['Warhammer 40k', 'Star Wars', 'Crossover'] },
            { prompt: 'Batman wearing an Iron Man suit, perched on a gargoyle in a futuristic cyberpunk Gotham.', aspectRatio: '9:16', tags: ['DC', 'Marvel', 'Crossover'] },
            { prompt: 'Gandalf the White casting a spell alongside Doctor Strange in the Mirror Dimension.', aspectRatio: '16:9', tags: ['Marvel', 'Fantasy', 'Crossover'] },
            { prompt: 'Darth Vader commanding a fleet of Star Destroyers over Hogwarts castle.', aspectRatio: '16:9', tags: ['Star Wars', 'Harry Potter', 'Crossover'] },
          ];
        }

        if (!Array.isArray(itemsToGenerate) || itemsToGenerate.length === 0) {
          throw new Error('Failed to generate prompts');
        }

        itemsToGenerate = itemsToGenerate.slice(0, 4);
      } else {
        const promptText2 = await streamAIToString(
          `${systemContext}

${MASTERPROMPT_INSTRUCTIONS}

═══════════════════════════════════════════════════
TASK
═══════════════════════════════════════════════════
The user has sketched these rough ideas: ${JSON.stringify(customPrompts)}

Transform EACH rough idea into a SHORT image prompt (40–60 words) following the rules above. Preserve the user's core concept — the character pairing, the situation — and add ONE crisp equipment fusion plus a brief setting phrase. Do NOT write long cinematic descriptions. Leonardo's prompt_enhance will expand your short prompt into the full detailed image prompt — your job is ingredients, not the recipe.

Return ONLY a JSON array of objects (one per input idea, in the same order), each with:
- "prompt": string — 40–60 words, named character + ONE equipment fusion + short setting + 1–2 quality tags
- "aspectRatio": string — "16:9" for wide/epic, "9:16" for portrait/character, "1:1" otherwise
- "tags": array of strings — 5-8 tags
- "selectedNiches": array of strings
- "selectedGenres": array of strings
- "negativePrompt": string — 15 words max, CONTEXT-AWARE to the prompt's subject. Pick from: character art → "bad anatomy, wrong proportions, extra fingers, mutated hands"; landscapes → "overexposed, washed out, text, watermark, signature"; action scenes → "motion blur, static pose, flat lighting"; dark/grimdark → "bright colors, cartoon style, flat shading". Always include the core technical defects (blurry, low quality, deformed).`,
          { mode: 'idea', provider: settings.activeAiAgent, model: settings.activeTextModel, niches: settings.agentNiches, genres: settings.agentGenres, activeSkills: settings.activeSkills }
        );

        try {
          itemsToGenerate = parseGeneratedItems(promptText2);
        } catch {
          itemsToGenerate = customPrompts.map(p => ({ prompt: p, aspectRatio: options?.aspectRatio }));
        }

        if (!Array.isArray(itemsToGenerate) || itemsToGenerate.length === 0) {
          itemsToGenerate = customPrompts.map(p => ({ prompt: p, aspectRatio: options?.aspectRatio }));
        } else {
          itemsToGenerate = itemsToGenerate.slice(0, customPrompts.length);
        }
      }

      for (let i = 0; i < itemsToGenerate.length; i++) {
        const item = itemsToGenerate[i];

        // V1.4.0: use the unified model registry. Leonardo is the
        // default; Higgsfield is opt-in (when `higgsfieldEnabled`
        // is true) and round-robins through `higgsfieldImageModels`
        // so multiple Higgsfield models are used across a run.
        // See `lib/image-models.ts` for the full selection rules.
        const unifiedModel = pickDefaultImageModel({
          defaultImageModel: settings.defaultImageModel,
          defaultHiggsfieldImageModel: settings.defaultHiggsfieldImageModel,
          defaultLeonardoModel: settings.defaultLeonardoModel,
          higgsfieldEnabled: settings.higgsfieldEnabled,
          higgsfieldImageModels: settings.higgsfieldImageModels,
        })
        // Caller can override (e.g. the ManualGenerationPanel passes
        // its own chosen model id).
        const overrideId = options?.leonardoModel
        const selectedModel = overrideId ?? unifiedModel.id
        const modelName = unifiedModel.name

        // Ask pi to rewrite the prompt AND pick model-aware parameters
        // (best aspect ratio, best style, smart negative prompt) before
        // sending it to the provider. Skipped when options.skipEnhance is set.
        setProgress(`Optimizing prompt for ${modelName}...`);
        const enhancement = options?.skipEnhance
          ? { prompt: item.prompt }
          : await enhancePromptForModel(item.prompt, selectedModel, {
              style: options?.style,
              aspectRatio: item.aspectRatio || options?.aspectRatio,
              negativePrompt: item.negativePrompt || options?.negativePrompt,
            });

        const modelPrompt = enhancement.prompt;
        const currentAspectRatio =
          enhancement.aspectRatio || item.aspectRatio || options?.aspectRatio || '1:1';
        const modelStyle = enhancement.style || options?.style;
        const modelNegPrompt =
          enhancement.negativePrompt || item.negativePrompt || options?.negativePrompt;

        setProgress(`Generating image ${i + 1} of ${itemsToGenerate.length} with ${modelName}...`);
        try {
          const generatedNegativePrompt = modelNegPrompt;

          // STORY-MMX-PROMPT-WIRE: route the per-spec details (style UUID,
          // dimensions, quality default) through buildEnhancedPrompt so MMX
          // and Leonardo see the same shape of inputs. Old logic — fuzzy
          // style→UUID match against LEONARDO_MODELS + getLeonardoDimensions
          // — stays as the fallback for un-spec'd legacy entries.
          const enhanced = buildEnhancedPrompt(modelPrompt, {
            modelId: selectedModel,
            styleName: modelStyle,
            aspectRatio: currentAspectRatio,
            count: 1,
            // V1.0.7-PROMPT-ENG-A4: when the user opted into anti-AI-look
            // in Settings, the curated negative-prompt list is appended
            // to enhanced.negativePrompts. We join it with the existing
            // user-supplied negativePrompt below (Leonardo takes a single
            // `negative_prompt` string).
            antiAiLook: settings.antiAiLook === true,
            // V1.7.0-M2.1: forward the EFFECTIVE camera angle. A pinned
            // settings.cameraAngle is a user lock and wins; otherwise the
            // idea model's per-item choice (item.cameraAngle) is used.
            // resolveEffectiveCameraAngle drops anything not in the catalog.
            mcsla: (() => {
              const angle = resolveEffectiveCameraAngle(settings.cameraAngle, item.cameraAngle);
              return angle ? { camera: { angle } } : undefined;
            })(),
          });

          const fallbackStyleUuids = (() => {
            if (!modelStyle) return undefined;
            const modelConfig = LEONARDO_MODELS.find(m => m.id === selectedModel);
            if (!modelConfig?.styles) return undefined;
            const match = modelConfig.styles.find(s =>
              s.name.toLowerCase() === modelStyle.toLowerCase() ||
              s.name.toLowerCase().includes(modelStyle.toLowerCase())
            );
            return match ? [match.uuid] : undefined;
          })();

          const fallbackDims = getLeonardoDimensions(selectedModel, currentAspectRatio);

          // Branch on the model's backend provider. MiniMax-native models
          // skip Leonardo entirely (no styleIds, no quality, no moderation
          // retry — MiniMax surfaces filter rejections via the route's
          // structured error). All other models stay on the Leonardo path.
          // V1.4.0: provider comes from the unified registry, not just
          // `LEONARDO_MODELS`. The caller can still override via
          // `options.imageProvider` (e.g. the ManualGenerationPanel
          // uses this to force Higgsfield for a manual run).
          const unifiedSelected = getImageModel(selectedModel);
          const imageProvider: ImageProvider =
            (options?.imageProvider as ImageProvider | undefined) ||
            unifiedSelected?.provider ||
            'leonardo';

          const sharedWidth = enhanced.leonardo.width ?? fallbackDims.width;
          const sharedHeight = enhanced.leonardo.height ?? fallbackDims.height;
          const sharedStyleIds = enhanced.leonardo.styleIds ?? fallbackStyleUuids;
          const rawQuality = options?.quality || enhanced.leonardo.quality || 'HIGH';
          const sharedQuality: 'LOW' | 'MEDIUM' | 'HIGH' =
            rawQuality === 'LOW' || rawQuality === 'MEDIUM' || rawQuality === 'HIGH'
              ? rawQuality
              : 'HIGH';
          const onModerationBlock = (classifications: string[]) => {
            const reasons = classifications.join(', ');
            const stageMsg = `Blocked by ${reasons} — rewriting and retrying once…`;
            setLastError({ message: stageMsg, classifications, retried: false });
            setImages(prev => prev.map(img =>
              img.id === placeholders[i].id
                ? { ...img, error: stageMsg }
                : img
            ));
            setProgress(`Image ${i + 1}: ${stageMsg}`);
          };

          let success: LeonardoSuccess;
          let activePrompt: string;
          let retried: boolean;
          if (imageProvider === 'minimax') {
            success = await submitMinimaxImage({
              prompt: enhanced.prompt,
              width: sharedWidth,
              height: sharedHeight,
              aspectRatio: currentAspectRatio,
              quantity: 1,
              // Short prompts get bigger uplift from prompt_optimizer;
              // long ones already carry their own detail and the optimizer
              // tends to drift them off-spec.
              promptOptimizer: enhanced.prompt.length < 180,
            });
            activePrompt = enhanced.prompt;
            retried = false;
          } else if (imageProvider === 'higgsfield') {
            // HIGGSFIELD-INTEGRATION: forward to /api/higgsfield/image.
            // The route resolves the MCP `higgsfield_generate` tool
            // and returns either a ready URL or a requestId we then
            // poll via /api/higgsfield/status. No moderation retry
            // here — Higgsfield returns 422 with a structured error
            // for blocked prompts and we surface it as-is. The
            // user's "Connect Higgsfield" decision in Settings
            // gates this path; an unconnected account returns 401
            // which we surface verbatim.
            // `apiName` comes from the model-spec JSON (lib/model-specs)
            // for the higgsfield-* entries we just added — those specs
            // carry the Higgsfield job_set_type slug (`nano_banana_2`,
            // `seedance_2_0`, etc.). LEONARDO_MODELS does not have
            // these models so we don't fall through to modelConfig.apiName.
            // V1.0.7-PROMPT-ENG-D: per-cycle credit budget gate. When
            // the user has set a cap and the cycle is over, we throw
            // a typed error that the outer catch surfaces verbatim;
            // the user can then either reset the cycle or flip the
            // override from Settings.
            const usage = await loadCreditUsage();
            const budget = checkBudget(settings.higgsfieldMonthlyCreditCap, usage);
            if (!budget.allowed) {
              throw new Error(
                `Higgsfield credit cap reached (${usage.used}/${settings.higgsfieldMonthlyCreditCap}). ` +
                `Open Settings → Credit Budget to reset the cycle or override for this cycle.`,
              );
            }
            const hfSpec = getModelSpec(selectedModel);
            // V1.4.0: pull the CLI token from settings so the server
            // route uses the CLI binary path. `higgsfieldCliToken`
            // is the user-pasted override; the OAuth status route
            // covers the OAuth path. Either way the request now
            // succeeds end-to-end.
            const cliToken = settings.higgsfieldCliToken;
            const hf = await submitHiggsfieldImage({
              prompt: enhanced.prompt,
              modelId: selectedModel,
              apiName: enhanced.higgsfield.model || hfSpec?.apiName || 'nano_banana_2',
              aspectRatio: currentAspectRatio,
              resolution: enhanced.higgsfield.resolution,
              quality: enhanced.higgsfield.quality,
              seed: enhanced.higgsfield.seed,
              higgsfieldCliToken: cliToken,
            });
            success = { url: hf.url };
            activePrompt = enhanced.prompt;
            retried = false;
            // V1.0.7-PROMPT-ENG-D: charge 1 credit per successful
            // submission. v1 uses a flat rate; v2 should look up the
            // model's actual cost from lib/model-specs and pass it
            // here. Failed submissions don't count.
            void incrementCredits(1);
          } else if (settings.activeAiAgent === 'vercel-ai') {
            // Hybrid orchestrator path: server-side MiniMax-enhance +
            // Leonardo-submit via /api/ai/image, then poll via the
            // existing /api/leonardo/{id} route.
            ({ success, finalPrompt: activePrompt, retried } = await submitViaAiImageWithOneRetry(
              enhanced.prompt,
              {
                modelId: selectedModel,
                width: sharedWidth,
                height: sharedHeight,
                styleIds: sharedStyleIds,
                quality: sharedQuality,
                negativePrompt: generatedNegativePrompt,
                // V1.0.7-PROMPT-ENG-A4: forward anti-AI-look curated
                // negatives to /api/ai/image. The route layer will
                // forward them into the provider's negative_prompt
                // channel (Leonardo / Higgsfield MCP).
                antiAiLookNegatives: enhanced.negativePrompts,
                promptEnhance: 'ON',
              },
              {
                systemPrompt: settings.agentPrompt,
                niches: settings.agentNiches,
                genres: settings.agentGenres,
                apiKey: settings.apiKeys.leonardo,
              },
              { onRetry: onModerationBlock },
            ));
          } else {
            ({ success, finalPrompt: activePrompt, retried } = await submitWithOneRetry(
              enhanced.prompt,
              {
                negativePrompt: generatedNegativePrompt,
                // V1.0.7-PROMPT-ENG-A4: forward anti-AI-look curated
                // negatives to /api/leonardo. Joined with the
                // user-supplied negative inside submitLeonardoAndPoll.
                antiAiLookNegatives: enhanced.negativePrompts,
                modelId: selectedModel,
                width: sharedWidth,
                height: sharedHeight,
                styleIds: sharedStyleIds,
                apiKey: settings.apiKeys.leonardo,
                quality: sharedQuality,
                // IMG-INVEST-001 PART 2: force Leonardo's API-side enhancement ON
              // for Manual + Pipeline regardless of per-model spec default.
              // Brief: "we do NOT touch/improve prompts ourselves; Leonardo's
              // prompt_enhance handles all expansion."
              promptEnhance: 'ON',
              },
              { onRetry: onModerationBlock },
              settings.activeAiAgent,
            ));
          }

          let finalUrl = success.url;
          if (settings.watermark?.enabled) {
            finalUrl = await applyWatermark(finalUrl, settings.watermark, settings.channelName);
          }
          const generatedTags = await ensureTags(activePrompt, item.tags);
          // V1.3.4: download the generated image to the local
          // images\generated folder right after the watermark step.
          // The CDN URL is temporary (typically 24-72h) — having a
          // real file on disk means the gallery survives URL expiry,
          // the metadata JSON stays small (no embedded base64), and
          // one bad byte can't take down the whole library. The
          // download is fire-and-forget; if it fails we still keep
          // `finalUrl` so the CDN fallback works until expiry.
          const newImageId = `img-${Date.now()}-${i}`;
          const savedAt = Date.now();
          let localPath: string | undefined;
          if (finalUrl) {
            try {
              const { persistImageToDisk } = await import('@/lib/images/storage');
              const persisted = await persistImageToDisk(finalUrl, newImageId, savedAt);
              if (persisted) localPath = persisted;
            } catch {
              /* non-fatal: the CDN url is still in `finalUrl` */
            }
          }
          setImages(prev => prev.map(img => img.id === placeholders[i].id ? {
            id: newImageId,
            url: finalUrl,
            // V1.5: remember the CLEAN pre-watermark source so the
            // "Re-apply watermark" action composites onto it instead of
            // the already-watermarked url (no double-stacking).
            originalUrl: success.url,
            localPath,
            prompt: activePrompt,
            tags: generatedTags,
            imageId: success.imageId,
            seed: success.seed,
            negativePrompt: generatedNegativePrompt,
            aspectRatio: currentAspectRatio,
            style: modelStyle,
            status: 'ready',
            modelInfo: {
              provider: imageProvider,
              modelId: selectedModel,
              modelName: getModelName(selectedModel)
            }
          } : img));
          if (retried) {
            setLastError(null);
          }

          // V1.4.0-REWORK: Higgsfield add-on path. The primary
          // generation above just produced a Leonardo image (the
          // existing workflow, unchanged). If the user has opted
          // into Higgsfield (`higgsfieldEnabled: true`), generate
          // one Higgsfield variant of the same idea IN PARALLEL so
          // the user gets both. Multiple Higgsfield models are
          // exercised by round-robin through `higgsfieldImageModels`.
          //
          // The Higgsfield variant uses the model-specific skill
          // (e.g. banana-pro-director for nano_banana_2) — the
          // skill content is injected via `activeSkills` into the
          // prompt enhancement call, and the CLI does its own
          // model-side prompt enhancement on top.
          if (settings.higgsfieldEnabled) {
            const hfModel = pickHiggsfieldModelForCycle(
              i,
              settings.higgsfieldImageModels,
            );
            const hfSkillNames = hfModel.skillBinding
              ? [
                  'cinema-world-builder',
                  hfModel.skillBinding.skillName,
                ].filter((n, idx, arr) => arr.indexOf(n) === idx)
              : ['cinema-world-builder'];
            const hfPlaceholderId = `img-${Date.now()}-${i}-hf-${hfModel.apiModelId}`;
            setImages(prev => [
              {
                id: hfPlaceholderId,
                prompt: item.prompt,
                status: 'generating' as const,
                tags: generatedTags,
                modelInfo: {
                  provider: 'higgsfield',
                  modelId: hfModel.id,
                  modelName: hfModel.name,
                },
              } as GeneratedImage,
              ...prev,
            ]);
            // Fire-and-forget — the primary path's success/failure
            // is what gates the pipeline. The user gets a parallel
            // Higgsfield image added to the gallery.
            void (async () => {
              try {
                // Gap 4: show both the Leonardo and Higgsfield models so
                // the user can see what's running side-by-side.
                setProgress(`Leonardo (${selectedModel}) + Higgsfield (${hfModel.apiModelId}): ${item.prompt.slice(0, 50)}…`);
                const cliToken = settings.higgsfieldCliToken;
                // Gap 1: inject the model-specific skill content into the
                // prompt enhancement call via activeSkills. The LLM reframes
                // the prompt using the model's optimal structure (SLCT for
                // Nano Banana via banana-pro-director, MCSLA for the rest
                // via cinema-world-builder).
                const mergedSkills = [
                  ...(settings.activeSkills ?? []),
                  ...hfSkillNames,
                ].filter((n, idx, arr) => arr.indexOf(n) === idx);
                const hfEnhancedPrompt = await streamAIToString(
                  `Rewrite this image prompt optimized for the ${hfModel.name} model. Return only the rewritten prompt, no explanation.\n\n${item.prompt}`,
                  {
                    mode: 'enhance',
                    provider: settings.activeAiAgent,
                    model: settings.activeTextModel,
                    activeSkills: mergedSkills,
                  },
                ).catch(() => item.prompt);
                const hfSpec = getModelSpec(hfModel.id);
                const hf = await submitHiggsfieldImage({
                  prompt: hfEnhancedPrompt,
                  modelId: hfModel.id,
                  apiName: hfSpec?.apiName || hfModel.apiModelId,
                  aspectRatio: currentAspectRatio,
                  resolution: hfModel.resolutions?.[0] as '1k' | '2k' | '4k' | undefined,
                  quality: undefined,
                  seed: undefined,
                  higgsfieldCliToken: cliToken,
                });
                // Persist to disk (v1.3.4 image storage) and update
                // the gallery entry.
                const persistedFilename = await persistImageToDisk(
                  hf.url,
                  hfPlaceholderId,
                  Date.now(),
                ).catch(() => null);
                setImages(prev => prev.map(img =>
                  img.id === hfPlaceholderId
                    ? {
                        ...img,
                        url: hf.url,
                        localPath: persistedFilename ?? undefined,
                        status: 'ready' as const,
                        prompt: hf.enhancedPrompt || item.prompt,
                      }
                    : img
                ));
              } catch (hfErr) {
                // Gap 3: surface auth failures with actionable instructions.
                // Any other failure is surfaced verbatim so the user can
                // diagnose. Status is 'error' (not 'ready') so GalleryCard's
                // error overlay actually shows.
                const rawHfMsg = hfErr instanceof Error ? hfErr.message : 'Higgsfield failed';
                const isAuthError =
                  rawHfMsg.includes('401') ||
                  rawHfMsg.toLowerCase().includes('not connected') ||
                  rawHfMsg.toLowerCase().includes('not configured') ||
                  rawHfMsg.toLowerCase().includes('unauthorized');
                const hfErrMsg = isAuthError
                  ? `${rawHfMsg} — Run \`higgsfield auth login\` in a terminal to authenticate the CLI, or set the Higgsfield CLI token in Settings → AI Engine.`
                  : rawHfMsg;
                setImages(prev => prev.map(img =>
                  img.id === hfPlaceholderId
                    ? { ...img, status: 'error' as const, error: hfErrMsg }
                    : img
                ));
              }
            })();
          }
        } catch (imgError: unknown) {
          // Don't leave the placeholder stuck on 'generating'. Flip it
          // to 'error' with a human-readable reason so the UI can show
          // the failure instead of a forever-spinning loader.
          const rawMsg = getErrorMessage(imgError) || 'Generation failed';
          const classifications: string[] = (imgError as LeonardoGenerationError)?.moderationClassification || [];
          const isContentFilter =
            classifications.length > 0 ||
            rawMsg.toLowerCase().includes('no images found') ||
            rawMsg.toLowerCase().includes('complete but no images') ||
            rawMsg.toLowerCase().includes('blocked by content moderation');

          let errMsg: string;
          if (selectedModel === 'gpt-image-1.5' && isContentFilter) {
            errMsg = 'GPT-image-1.5 failed the generation. This model blocks more often than the nano-banana variants — try switching model or changing the style.';
          } else if (classifications.length > 0) {
            errMsg = `Blocked after rewrite: ${classifications.join(', ')}. Edit the prompt manually or try a different model.`;
          } else {
            errMsg = rawMsg;
          }
          setLastError({
            message: errMsg,
            classifications,
            failedPrompt: (imgError as LeonardoGenerationError)?.failedPrompt,
            retried: true,
          });
          setImages(prev => prev.map(img =>
            img.id === placeholders[i].id
              ? { ...img, status: 'error', error: errMsg }
              : img
          ));
        }
        setProgress('');
      }
    } catch (error: unknown) {
      const message = getErrorMessage(error) || 'An error occurred during generation.';
      setGenerationError(message);
      setProgress('');
    } finally {
      setIsGenerating(false);
    }
  };

  const rerollImage = async (id: string, prompt: string, options?: GenerateOptions) => {
    setIsGenerating(true);
    setGenerationError(null);
    setProgress('Rerolling image...');

    setImages(prev => prev.map(img => img.id === id ? { ...img, status: 'generating' } : img));

    try {
      const selectedModel = options?.leonardoModel || settings.defaultLeonardoModel;

      const ensureTags = async (prompt: string, existingTags?: string[]) => {
        if (existingTags && existingTags.length > 0) return existingTags;
        try {
          const text = await streamAIToString(
            `Analyze this image prompt: "${prompt}". Generate 5-8 fitting tags (universe, character, style, theme). Return ONLY a JSON array of strings.`,
            { mode: 'tag', provider: settings.activeAiAgent, model: settings.activeTextModel, activeSkills: settings.activeSkills }
          );
          const parsed = extractJsonArrayFromLLM(text);
          const strTags = parsed.filter((t): t is string => typeof t === 'string');
          return strTags.length > 0 ? strTags : ['Mashup'];
        } catch {
          return ['Mashup'];
        }
      };

      // IMG-INVEST-001 PART 2 (2026-05-23): no our-side prompt
      // enhancement in Manual mode. The user's existing prompt goes to
      // Leonardo VERBATIM; Leonardo's API-side prompt_enhance=ON does
      // any necessary expansion. Previously this path ran a
      // streamAIToString LLM rewrite that constrained re-rolls to
      // Star Wars / Marvel / DC / Warhammer 40k — that was both an
      // our-side enhancement (against spec) AND an unwanted franchise
      // filter for users who had broader content pillars in Settings.
      const finalPrompt = options?.negativePrompt
        ? `${prompt}\nDo not include: ${options.negativePrompt}`
        : prompt;

      // Apply the per-model prompt + parameter tuning on top of the
      // reroll enhancement so rerolls also pick the best aspect ratio
      // and art style for the target Leonardo variant.
      const rerollEnhancement = options?.skipEnhance
        ? { prompt: finalPrompt }
        : await enhancePromptForModel(finalPrompt, selectedModel, {
            style: options?.style,
            aspectRatio: options?.aspectRatio,
            negativePrompt: options?.negativePrompt,
          });
      const modelPrompt = rerollEnhancement.prompt;
      const modelStyle = rerollEnhancement.style || options?.style;
      const modelNegPrompt = rerollEnhancement.negativePrompt || options?.negativePrompt;

      let newImg: GeneratedImage | null = null;

      try {
        const currentAspectRatio =
          rerollEnhancement.aspectRatio || options?.aspectRatio || '1:1';

        // STORY-MMX-PROMPT-WIRE: same wiring as the generate path so
        // rerolls pick up spec-driven style UUIDs / dimensions /
        // quality defaults instead of recomputing them inline.
        const enhanced = buildEnhancedPrompt(modelPrompt, {
          modelId: selectedModel,
          styleName: modelStyle,
          aspectRatio: currentAspectRatio,
          count: 1,
          // V1.0.7-PROMPT-ENG-A2/A3 + V1.7.0-M2.1: reroll forwards the
          // pinned settings angle (a reroll has no per-item context).
          // Routed through the resolver so a stale/invalid stored slug
          // can't reach the composer.
          mcsla: (() => {
            const angle = resolveEffectiveCameraAngle(settings.cameraAngle, undefined);
            return angle ? { camera: { angle } } : undefined;
          })(),
        });

        const fallbackStyleUuids = (() => {
          if (!modelStyle) return undefined;
          const modelConfig = LEONARDO_MODELS.find(m => m.id === selectedModel);
          if (!modelConfig?.styles) return undefined;
          const match = modelConfig.styles.find(s =>
            s.name.toLowerCase() === modelStyle.toLowerCase() ||
            s.name.toLowerCase().includes(modelStyle.toLowerCase())
          );
          return match ? [match.uuid] : undefined;
        })();

        const fallbackDims = getLeonardoDimensions(selectedModel, currentAspectRatio);

        const modelConfig = LEONARDO_MODELS.find(m => m.id === selectedModel);
        const imageProvider =
          options?.imageProvider || modelConfig?.provider || 'leonardo';

        const sharedWidth = enhanced.leonardo.width ?? fallbackDims.width;
        const sharedHeight = enhanced.leonardo.height ?? fallbackDims.height;
        const sharedStyleIds = enhanced.leonardo.styleIds ?? fallbackStyleUuids;
        const rawQuality = options?.quality || enhanced.leonardo.quality || 'HIGH';
        const sharedQuality: 'LOW' | 'MEDIUM' | 'HIGH' =
          rawQuality === 'LOW' || rawQuality === 'MEDIUM' || rawQuality === 'HIGH'
            ? rawQuality
            : 'HIGH';
        const onModerationBlock = (classifications: string[]) => {
          const reasons = classifications.join(', ');
          const stageMsg = `Reroll blocked by ${reasons} — rewriting and retrying once…`;
          setLastError({ message: stageMsg, classifications, retried: false });
          setImages(prev => prev.map(img =>
            img.id === id ? { ...img, error: stageMsg } : img
          ));
          setProgress(stageMsg);
        };

        let success: LeonardoSuccess;
        let activePrompt: string;
        let retried: boolean;
        if (imageProvider === 'minimax') {
          success = await submitMinimaxImage({
            prompt: enhanced.prompt,
            width: sharedWidth,
            height: sharedHeight,
            aspectRatio: currentAspectRatio,
            quantity: 1,
            promptOptimizer: enhanced.prompt.length < 180,
          });
          activePrompt = enhanced.prompt;
          retried = false;
        } else if (imageProvider === 'higgsfield') {
          // HIGGSFIELD-INTEGRATION: reroll path. Same submit helper
          // as the main loop — the model + aspect ratio come from
          // the reroll inputs and the spec.
          // V1.0.7-PROMPT-ENG-D: same budget gate as the main loop.
          const usageR = await loadCreditUsage();
          const budgetR = checkBudget(settings.higgsfieldMonthlyCreditCap, usageR);
          if (!budgetR.allowed) {
            throw new Error(
              `Higgsfield credit cap reached (${usageR.used}/${settings.higgsfieldMonthlyCreditCap}). ` +
              `Open Settings → Credit Budget to reset the cycle or override for this cycle.`,
            );
          }
          const hfSpecR = getModelSpec(selectedModel);
          const hf = await submitHiggsfieldImage({
            prompt: enhanced.prompt,
            modelId: selectedModel,
            apiName: enhanced.higgsfield.model || hfSpecR?.apiName || 'nano_banana_2',
            aspectRatio: currentAspectRatio,
            resolution: enhanced.higgsfield.resolution,
            quality: enhanced.higgsfield.quality,
            seed: enhanced.higgsfield.seed,
          });
          success = { url: hf.url };
          activePrompt = enhanced.prompt;
          retried = false;
          // V1.0.7-PROMPT-ENG-D: charge 1 credit per successful reroll.
          void incrementCredits(1);
        } else if (settings.activeAiAgent === 'vercel-ai') {
          ({ success, finalPrompt: activePrompt, retried } = await submitViaAiImageWithOneRetry(
            enhanced.prompt,
            {
              modelId: selectedModel,
              width: sharedWidth,
              height: sharedHeight,
              styleIds: sharedStyleIds,
              quality: sharedQuality,
              negativePrompt: modelNegPrompt,
              // V1.0.7-PROMPT-ENG-A4: forward anti-AI-look curated
              // negatives to /api/ai/image in the reroll path too.
              antiAiLookNegatives: enhanced.negativePrompts,
              // IMG-INVEST-001 PART 2: force Leonardo's API-side enhancement ON
              // for Manual + Pipeline regardless of per-model spec default.
              // Brief: "we do NOT touch/improve prompts ourselves; Leonardo's
              // prompt_enhance handles all expansion."
              promptEnhance: 'ON',
            },
            {
              systemPrompt: settings.agentPrompt,
              niches: settings.agentNiches,
              genres: settings.agentGenres,
              apiKey: settings.apiKeys.leonardo,
            },
            { onRetry: onModerationBlock },
          ));
        } else {
          ({ success, finalPrompt: activePrompt, retried } = await submitWithOneRetry(
            enhanced.prompt,
            {
              negativePrompt: modelNegPrompt,
              // V1.0.7-PROMPT-ENG-A4: forward anti-AI-look curated
              // negatives to /api/leonardo in the reroll path too.
              antiAiLookNegatives: enhanced.negativePrompts,
              modelId: selectedModel,
              width: sharedWidth,
              height: sharedHeight,
              styleIds: sharedStyleIds,
              apiKey: settings.apiKeys.leonardo,
              quality: sharedQuality,
              // IMG-INVEST-001 PART 2: force Leonardo's API-side enhancement ON
              // for Manual + Pipeline regardless of per-model spec default.
              // Brief: "we do NOT touch/improve prompts ourselves; Leonardo's
              // prompt_enhance handles all expansion."
              promptEnhance: 'ON',
            },
            { onRetry: onModerationBlock },
            settings.activeAiAgent,
          ));
        }

        let finalUrl = success.url;
        if (settings.watermark?.enabled) {
          finalUrl = await applyWatermark(finalUrl, settings.watermark, settings.channelName);
        }
        const generatedTags = await ensureTags(activePrompt, []);
        newImg = {
          id: `img-${Date.now()}-reroll`,
          url: finalUrl,
          prompt: activePrompt,
          tags: generatedTags,
          imageId: success.imageId,
          seed: success.seed,
          negativePrompt: modelNegPrompt,
          aspectRatio: currentAspectRatio,
          style: modelStyle,
          status: 'ready',
          modelInfo: {
            provider: imageProvider,
            modelId: selectedModel,
            modelName: getModelName(selectedModel)
          }
        };
        if (retried) {
          setLastError(null);
        }
      } catch (err) {
        const lErr = err as LeonardoGenerationError;
        const classifications = lErr?.moderationClassification || [];
        if (classifications.length > 0) {
          setLastError({
            message: `Still blocked after rewrite: ${classifications.join(', ')}. Edit the prompt manually.`,
            classifications,
            failedPrompt: lErr.failedPrompt,
            retried: true,
          });
        }
        throw err;
      }

      if (newImg) {
        setImages(prev => {
          return prev.map(img => img.id === id ? newImg! : img);
        });
      } else {
        setImages(prev => prev.map(img => img.id === id ? { ...img, status: 'ready' } : img));
      }

      setProgress('');
    } catch (error: unknown) {
      const message = getErrorMessage(error) || 'An error occurred during reroll.';
      setGenerationError(message);
      setProgress('');
    } finally {
      setIsGenerating(false);
    }
  };

  return {
    images,
    setImages,
    isGenerating,
    progress,
    generationError,
    clearGenerationError,
    lastError,
    clearLastError,
    generateImages,
    rerollImage,
    generateNegativePrompt,
    autoTagImage,
    setImageStatus,
  };
}
