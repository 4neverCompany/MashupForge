'use client';

import { useState } from 'react';
import { streamAIToString, extractJsonArrayFromLLM } from '@/lib/aiClient';
import { enhancePromptForModel } from '@/lib/modelOptimizer';
import { buildEnhancedPrompt } from '@/lib/image-prompt-builder';
import { MASTERPROMPT_INSTRUCTIONS } from '@/lib/masterpromptTemplate';
import { getErrorMessage } from '@/lib/errors';
import { fetchWithRetry } from '@/lib/fetchWithRetry';
import {
  type GeneratedImage,
  type GenerateOptions,
  type UserSettings,
  type WatermarkSettings,
  LEONARDO_MODELS,
  getLeonardoDimensions,
} from '../types/mashup';

function getModelName(id: string): string {
  return LEONARDO_MODELS.find(m => m.id === id)?.name || id;
}

interface GeneratedItem {
  prompt: string;
  aspectRatio?: string;
  tags?: string[];
  selectedNiches?: string[];
  selectedGenres?: string[];
  negativePrompt?: string;
}

function pickStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strs = value.filter((v): v is string => typeof v === 'string');
  return strs.length > 0 ? strs : undefined;
}

function parseGeneratedItems(raw: string): GeneratedItem[] {
  return extractJsonArrayFromLLM(raw)
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      prompt: typeof item.prompt === 'string' ? item.prompt : '',
      aspectRatio: typeof item.aspectRatio === 'string' ? item.aspectRatio : undefined,
      tags: pickStringArray(item.tags),
      selectedNiches: pickStringArray(item.selectedNiches),
      selectedGenres: pickStringArray(item.selectedGenres),
      negativePrompt: typeof item.negativePrompt === 'string' ? item.negativePrompt : undefined,
    }))
    .filter((item) => item.prompt.length > 0);
}

export async function applyWatermark(baseImageSrc: string, settings: WatermarkSettings, channelName?: string): Promise<string> {
  if (!settings.enabled) return baseImageSrc;
  if (!settings.image && !channelName) return baseImageSrc;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(baseImageSrc);
        return;
      }

      ctx.drawImage(img, 0, 0);
      ctx.globalAlpha = settings.opacity || 0.8;

      // 8% padding (up from 3%) gives watermarks more breathing room
      // even if Instagram applies minor adjustments to the padded image.
      const padding = canvas.width * 0.08;

      if (settings.image) {
        const wm = new Image();
        wm.crossOrigin = "anonymous";
        wm.onload = () => {
          const wmWidth = canvas.width * (settings.scale || 0.15);
          const wmHeight = (wm.height / wm.width) * wmWidth;

          let x = 0, y = 0;
          switch (settings.position) {
            case 'top-left': x = padding; y = padding; break;
            case 'top-right': x = canvas.width - wmWidth - padding; y = padding; break;
            case 'bottom-left': x = padding; y = canvas.height - wmHeight - padding; break;
            case 'bottom-right': x = canvas.width - wmWidth - padding; y = canvas.height - wmHeight - padding; break;
            case 'center': x = (canvas.width - wmWidth) / 2; y = (canvas.height - wmHeight) / 2; break;
          }

          ctx.drawImage(wm, x, y, wmWidth, wmHeight);
          resolve(canvas.toDataURL('image/png'));
        };
        wm.onerror = () => resolve(baseImageSrc);
        wm.src = settings.image;
      } else if (channelName) {
        const fontSize = canvas.width * (settings.scale || 0.05);
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.fillStyle = 'white';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';

        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;

        const metrics = ctx.measureText(channelName);
        const textWidth = metrics.width;
        const textHeight = fontSize;

        let x = 0, y = 0;
        switch (settings.position) {
          case 'top-left': x = padding; y = padding; break;
          case 'top-right': x = canvas.width - textWidth - padding; y = padding; break;
          case 'bottom-left': x = padding; y = canvas.height - textHeight - padding; break;
          case 'bottom-right': x = canvas.width - textWidth - padding; y = canvas.height - textHeight - padding; break;
          case 'center': x = (canvas.width - textWidth) / 2; y = (canvas.height - textHeight) / 2; break;
        }

        ctx.fillText(channelName, x, y);
        resolve(canvas.toDataURL('image/png'));
      }
    };
    img.onerror = () => resolve(baseImageSrc);
    img.src = baseImageSrc.startsWith('http') ? `/api/proxy-image?url=${encodeURIComponent(baseImageSrc)}` : (baseImageSrc.startsWith('data:') ? baseImageSrc : `data:image/jpeg;base64,${baseImageSrc}`);
  });
}

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
  modelId: string;
  width: number;
  height: number;
  styleIds?: string[];
  apiKey?: string;
  quality?: string;
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
  const res = await fetchWithRetry('/api/leonardo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: params.prompt,
      negative_prompt: params.negativePrompt,
      modelId: params.modelId,
      width: params.width,
      height: params.height,
      styleIds: params.styleIds,
      apiKey: params.apiKey,
      quality: params.quality || 'HIGH',
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
  systemPrompt?: string;
  niches?: string[];
  genres?: string[];
  apiKey?: string;
  skipEnhance?: boolean;
}

interface AiImageSubmitResult extends LeonardoSuccess {
  enhancedPrompt: string;
}

async function submitViaAiImage(params: AiImageSubmitParams): Promise<AiImageSubmitResult> {
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
      negativePrompt: params.negativePrompt,
      systemPrompt: params.systemPrompt,
      niches: params.niches,
      genres: params.genres,
      apiKey: params.apiKey,
      skipEnhance: params.skipEnhance === true,
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

function buildModerationRewriteInstruction(failedPrompt: string): string {
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
 * One-retry moderation recovery. Leonardo's moderation is empirically
 * non-deterministic — a 3-attempt cascade with aggressive rewrites and
 * defensive negative prompts gave marginal improvement for significant
 * complexity. This helper does the simple thing: submit, and if it
 * fails with a moderation classification, ask pi for a clean rewrite
 * and try exactly one more time. No classification-aware branching,
 * no forbidden lists, no negative-prompt escalation.
 *
 * Non-moderation errors rethrow immediately and skip the retry.
 */
async function submitWithOneRetry(
  initialPrompt: string,
  baseParams: Omit<LeonardoSubmitParams, 'prompt'>,
  callbacks: ModerationRetryCallback,
  provider?: 'pi' | 'nca' | 'mmx' | 'vercel-ai',
): Promise<SubmitResult> {
  try {
    const success = await submitLeonardoAndPoll({ prompt: initialPrompt, ...baseParams });
    return { success, finalPrompt: initialPrompt, retried: false };
  } catch (err) {
    const lErr = err as LeonardoGenerationError;
    const classifications = lErr.moderationClassification || [];
    if (classifications.length === 0) throw err;

    callbacks.onRetry(classifications);

    const rewritten = await streamAIToString(
      buildModerationRewriteInstruction(lErr.failedPrompt || initialPrompt),
      { mode: 'enhance', provider },
    );
    const activePrompt = (rewritten || '').trim() || initialPrompt;

    const success = await submitLeonardoAndPoll({ prompt: activePrompt, ...baseParams });
    return { success, finalPrompt: activePrompt, retried: true };
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
  try {
    const r = await submitViaAiImage({
      ...baseParams,
      ...context,
      idea: initialIdea,
      skipEnhance: false,
    });
    return { success: r, finalPrompt: r.enhancedPrompt, retried: false };
  } catch (err) {
    const lErr = err as LeonardoGenerationError;
    const classifications = lErr.moderationClassification || [];
    if (classifications.length === 0) throw err;

    callbacks.onRetry(classifications);

    const rewritten = await streamAIToString(
      buildModerationRewriteInstruction(lErr.failedPrompt || initialIdea),
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
        { mode: 'tag', provider: settings.activeAiAgent }
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
        { mode: 'negative-prompt', provider: settings.activeAiAgent }
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
        negativePrompt?: string
      }[] = [];
      const ensureTags = async (prompt: string, existingTags?: string[]) => {
        if (existingTags && existingTags.length > 0) return existingTags;
        try {
          const text = await streamAIToString(
            `Analyze this image prompt: "${prompt}". Generate 5-8 fitting tags (universe, character, style, theme). Return ONLY a JSON array of strings.`,
            { mode: 'tag', provider: settings.activeAiAgent }
          );
          const parsed = extractJsonArrayFromLLM(text);
          const strTags = parsed.filter((t): t is string => typeof t === 'string');
          return strTags.length > 0 ? strTags : ['Mashup'];
        } catch {
          return ['Mashup'];
        }
      };

      // Single source of truth: settings.agentPrompt carries diversity
      // rules, art direction, and universe-blending guidance. Niches +
      // genres are appended as live context so the active tag chips in
      // Settings still shape each batch.
      const systemContext = `${settings.agentPrompt || 'You are an elite AI art director.'}
Active Niches: ${settings.agentNiches?.join(', ') || 'All'}
Active Genres: ${settings.agentGenres?.join(', ') || 'All'}`;

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

Random Seed: ${Math.random()}`,
          { mode: 'idea', provider: settings.activeAiAgent, niches: settings.agentNiches, genres: settings.agentGenres }
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
          { mode: 'idea', provider: settings.activeAiAgent, niches: settings.agentNiches, genres: settings.agentGenres }
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

        const selectedModel = options?.leonardoModel || settings.defaultLeonardoModel;
        const modelName = getModelName(selectedModel);

        // Ask pi to rewrite the prompt AND pick model-aware parameters
        // (best aspect ratio, best style, smart negative prompt) before
        // sending it to Leonardo. Skipped when options.skipEnhance is set.
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
                modelId: selectedModel,
                width: sharedWidth,
                height: sharedHeight,
                styleIds: sharedStyleIds,
                apiKey: settings.apiKeys.leonardo,
                quality: sharedQuality,
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
          setImages(prev => prev.map(img => img.id === placeholders[i].id ? {
            id: `img-${Date.now()}-${i}`,
            url: finalUrl,
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
            { mode: 'tag', provider: settings.activeAiAgent }
          );
          const parsed = extractJsonArrayFromLLM(text);
          const strTags = parsed.filter((t): t is string => typeof t === 'string');
          return strTags.length > 0 ? strTags : ['Mashup'];
        } catch {
          return ['Mashup'];
        }
      };

      let enhancedPrompt = prompt;
      try {
        enhancedPrompt = await streamAIToString(
          `Platform Niches: ${settings.agentNiches?.join(', ') || 'None'}.
Target Genres: ${settings.agentGenres?.join(', ') || 'None'}.
The user wants to re-roll an image based on this idea: "${prompt}". Enhance this idea into a highly detailed, cinematic image generation prompt. You MUST strictly limit the content to ONLY these franchises: Star Wars, Marvel, DC, and Warhammer 40k. Focus heavily on "what if" scenarios, alternative universes, different timelines, and epic crossovers. Return ONLY the enhanced prompt as a single string.`,
          { mode: 'enhance', provider: settings.activeAiAgent }
        );
      } catch {
        // enhancement failed — proceed with original prompt
      }

      const finalPrompt = options?.negativePrompt
        ? `${enhancedPrompt}\nDo not include: ${options.negativePrompt}`
        : enhancedPrompt;

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
              modelId: selectedModel,
              width: sharedWidth,
              height: sharedHeight,
              styleIds: sharedStyleIds,
              apiKey: settings.apiKeys.leonardo,
              quality: sharedQuality,
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
