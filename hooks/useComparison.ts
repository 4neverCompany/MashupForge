'use client';

import { useState, useEffect } from 'react';
import { get, set } from 'idb-keyval';
import { enhancePromptForModel } from '@/lib/modelOptimizer';
import { getErrorMessage } from '@/lib/errors';
import {
  type GeneratedImage,
  type GenerateOptions,
  type UserSettings,
  type WatermarkSettings,
  LEONARDO_MODELS,
  getLeonardoDimensions,
} from '../types/mashup';

function getModelName(id: string) {
  return LEONARDO_MODELS.find(m => m.id === id)?.name || id;
}

interface UseComparisonDeps {
  settings: UserSettings;
  saveImage: (img: GeneratedImage) => void;
  applyWatermark: (baseImageSrc: string, wm: WatermarkSettings, channelName?: string) => Promise<string>;
}

export interface CachedEnhancement {
  prompt?: string;
  style?: string;
  aspectRatio?: string;
  negativePrompt?: string;
}

export function useComparison({ settings, saveImage, applyWatermark }: UseComparisonDeps) {
  const [comparisonResults, setComparisonResults] = useState<GeneratedImage[]>([]);
  const [comparisonPrompt, setComparisonPrompt] = useState('');
  const [comparisonOptions, setComparisonOptions] = useState<GenerateOptions>({
    aspectRatio: '1:1',
    imageSize: '1K',
    negativePrompt: ''
  });
  const [isComparisonLoaded, setIsComparisonLoaded] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState('');
  const [comparisonError, setComparisonError] = useState<string | null>(null);

  const clearComparisonError = () => setComparisonError(null);

  useEffect(() => {
    const load = async () => {
      try {
        const idbComparisonResults = await get('mashup_comparison_results');
        if (idbComparisonResults) setComparisonResults(idbComparisonResults);
      } catch {
        // silent — comparison results remain empty, loaded flag still set
      } finally {
        setIsComparisonLoaded(true);
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (isComparisonLoaded) {
      set('mashup_comparison_results', comparisonResults);
    }
  }, [comparisonResults, isComparisonLoaded]);

  const generateComparison = async (
    prompt: string,
    modelIds: string[],
    options?: GenerateOptions,
    cachedEnhancements?: Record<string, CachedEnhancement>
  ): Promise<GeneratedImage[]> => {
    setIsGenerating(true);
    setComparisonError(null);
    const comparisonId = `comp-group-${Date.now()}`;
    const readyImages: GeneratedImage[] = [];

    let finalPrompt = prompt;
    if (options?.lighting || options?.angle) {
      const parts = [prompt];
      if (options.lighting) parts.push(`Lighting: ${options.lighting}`);
      if (options.angle) parts.push(`Camera angle: ${options.angle}`);
      parts.push('Highly detailed, cinematic composition.');
      finalPrompt = parts.join('. ');
    }

    const placeholders: GeneratedImage[] = modelIds.map((modelId, idx) => {
      // Resolve the placeholder's modelInfo.provider from the model
      // registry rather than hardcoding 'leonardo' — minimax-image-01
      // is the first non-Leonardo entry in LEONARDO_MODELS and the
      // gallery / filters key off this field. Pre-MXIMG-001 models
      // omit `provider` and fall back to 'leonardo' for back-compat.
      const cfg = LEONARDO_MODELS.find(m => m.id === modelId);
      const provider: 'leonardo' | 'minimax' = cfg?.provider ?? 'leonardo';
      return {
        id: `comp-placeholder-${Date.now()}-${idx}`,
        comparisonId,
        prompt: finalPrompt,
        status: 'generating',
        url: '',
        modelInfo: {
          provider,
          modelId,
          modelName: getModelName(modelId),
        },
      };
    });
    setComparisonResults(prev => [...placeholders, ...prev]);
    setProgress('Preparing comparison...');

    try {
      for (let i = 0; i < modelIds.length; i++) {
        const modelId = modelIds[i];
        const modelName = getModelName(modelId);

        // Use cached enhancement from preview if available, otherwise call pi.
        setProgress(cachedEnhancements?.[modelId]?.prompt
          ? `Generating with ${modelName}...`
          : `Optimizing prompt for ${modelName}...`
        );
        const cached = cachedEnhancements?.[modelId];
        const enhancement = cached?.prompt
          ? {
              prompt: cached.prompt,
              style: cached.style,
              aspectRatio: cached.aspectRatio,
              negativePrompt: cached.negativePrompt,
            }
          : options?.skipEnhance
            ? { prompt: finalPrompt }
            : await enhancePromptForModel(finalPrompt, modelId, {
                style: options?.style,
                aspectRatio: options?.aspectRatio,
                negativePrompt: options?.negativePrompt,
              });
        // V090-PIPELINE-STYLE-DIVERSITY: prefer per-model style override,
        // fall back to enhancement / shared option. Per-model picks come
        // from the rule engine's style diversity (each nano-banana gets a
        // different style).
        const perModelStyle = options?.perModelOptions?.[modelId]?.style;
        // V090-GPT15-STYLE-SKIP: only inject style text for models that
        // support style_ids. gpt-image-1.5 has no style parameter.
        // modelConfig is reused in leonardoStyleUuids below.
        const modelConfig = LEONARDO_MODELS.find(m => m.id === modelId);
        const modelSupportsStyle = Boolean(modelConfig?.styles?.length);
        const modelStyle = modelSupportsStyle
          ? (perModelStyle || enhancement.style || options?.style)
          : undefined;
        const modelPrompt = modelSupportsStyle && modelStyle
          ? `${enhancement.prompt}. Art style: ${modelStyle}`
          : enhancement.prompt;
        const modelRatio =
          enhancement.aspectRatio || options?.aspectRatio || '1:1';
        const modelNegPrompt =
          enhancement.negativePrompt || options?.negativePrompt;

        setProgress(`Generating with ${modelName}...`);

        try {
          let imageUrl = '';
          let imageId = '';
          let seed = 0;

          const dims = getLeonardoDimensions(modelId, modelRatio);

          // Map art style name → Leonardo UUID (reuses modelConfig from above)
          const leonardoStyleUuids = (() => {
            if (!modelStyle) return undefined;
            if (!modelConfig?.styles) return undefined;
            const match = modelConfig.styles.find(s =>
              s.name.toLowerCase() === modelStyle.toLowerCase() ||
              s.name.toLowerCase().includes(modelStyle.toLowerCase())
            );
            return match ? [match.uuid] : undefined;
          })();

          // Provider branch — minimax-image-01 (and any future MiniMax
          // image models) route to /api/minimax-image, which calls
          // MiniMax's native image_generation endpoint with a
          // synchronous response (no polling). All other models stay on
          // the Leonardo v2 submit-then-poll path. Mirrors the branching
          // shipped to hooks/useImageGeneration.ts in MXIMG-001 — that
          // hook's `generateImages` is destructured in several places
          // but never actually invoked (Studio + Pipeline use this
          // generateComparison path instead), which is why the routing
          // gap survived until now.
          const submitProvider: 'leonardo' | 'minimax' =
            modelConfig?.provider ?? 'leonardo';

          if (submitProvider === 'minimax') {
            const res = await fetch('/api/minimax-image', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                prompt: modelPrompt,
                aspectRatio: modelRatio,
                width: dims.width,
                height: dims.height,
                n: 1,
                // Short prompts get a bigger uplift from MiniMax's
                // server-side prompt_optimizer; long ones already
                // carry their own detail. Mirrors the threshold used
                // in useImageGeneration.submitMinimaxImage.
                promptOptimizer: modelPrompt.length < 180,
              }),
            });
            if (res.ok) {
              const data = (await res.json()) as {
                images?: Array<{ url?: string; width?: number; height?: number }>;
                generationId?: string;
              };
              const first = Array.isArray(data.images) ? data.images[0] : undefined;
              if (first && typeof first.url === 'string' && first.url) {
                imageUrl = first.url;
                imageId = data.generationId ?? '';
              }
            }
          } else {
            const res = await fetch('/api/leonardo', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                prompt: modelPrompt,
                modelId,
                width: dims.width,
                height: dims.height,
                negative_prompt: modelNegPrompt,
                styleIds: leonardoStyleUuids,
                apiKey: settings.apiKeys.leonardo
              }),
            });

            if (res.ok) {
              const data = await res.json();
              if (data.generationId) {
                let status = 'PENDING';
                let attempts = 0;
                while (status !== 'COMPLETE' && attempts < 150) {
                  await new Promise(resolve => setTimeout(resolve, 2000));
                  attempts++;
                  const statusRes = await fetch(`/api/leonardo/${data.generationId}`);
                  if (!statusRes.ok) break;
                  const statusData = await statusRes.json();
                  status = statusData.status;
                  if (status === 'COMPLETE') {
                    imageUrl = statusData.url;
                    imageId = statusData.imageId;
                    seed = statusData.seed;
                  } else if (status === 'FAILED') {
                    break;
                  }
                }
              }
            }
          }

          if (imageUrl) {
            const newImg: GeneratedImage = {
              id: `comp-${Date.now()}-${modelId}`,
              comparisonId,
              url: imageUrl,
              // Store the model-tuned prompt + the resolved parameters
              // so the user can see exactly what was sent to Leonardo,
              // not the original form.
              prompt: modelPrompt,
              imageId,
              seed,
              status: 'ready',
              negativePrompt: modelNegPrompt,
              aspectRatio: modelRatio,
              imageSize: options?.imageSize,
              style: modelStyle,
              modelInfo: { provider: submitProvider, modelId, modelName }
            };
            setComparisonResults(prev => prev.map(img => img.id === placeholders[i].id ? newImg : img));
            readyImages.push(newImg);
          } else {
            setComparisonResults(prev => prev.filter(img => img.id !== placeholders[i].id));
          }
        } catch {
          setComparisonResults(prev => prev.filter(img => img.id !== placeholders[i].id));
        }
      }
    } catch (e: unknown) {
      const message = getErrorMessage(e) || 'Comparison failed. Check your API keys.';
      setComparisonError(message);
      setProgress('');
    } finally {
      setIsGenerating(false);
    }
    return readyImages;
  };

  const pickComparisonWinner = async (id: string) => {
    const winnerImg = comparisonResults.find(img => img.id === id);
    if (!winnerImg || !winnerImg.url) return;

    setComparisonResults(prev => prev.map(img => {
      if (img.id === id) {
        return { ...img, winner: true };
      }
      return img;
    }));

    let finalUrl = winnerImg.url;
    let finalBase64 = winnerImg.base64;

    const watermarkSettings: WatermarkSettings = {
      ...(settings.watermark || { enabled: false, image: null, position: 'bottom-right', opacity: 0.8, scale: 0.05 }),
      enabled: true,
    };
    finalUrl = await applyWatermark(finalUrl, watermarkSettings, settings.channelName || 'Multiverse Mashup');
    finalBase64 = undefined;

    const galleryImg: GeneratedImage = {
      ...winnerImg,
      id: `img-${Date.now()}-winner`,
      url: finalUrl,
      base64: finalBase64,
      status: 'ready'
    };

    saveImage(galleryImg);
  };

  const clearComparison = () => {
    setComparisonResults([]);
    set('mashup_comparison_results', []);
  };

  const deleteComparisonResult = (id: string) => {
    setComparisonResults(prev => {
      const updated = prev.filter(img => img.id !== id);
      set('mashup_comparison_results', updated);
      return updated;
    });
  };

  return {
    comparisonResults,
    comparisonPrompt,
    setComparisonPrompt,
    comparisonOptions,
    setComparisonOptions,
    generateComparison,
    pickComparisonWinner,
    clearComparison,
    deleteComparisonResult,
    isComparisonLoaded,
    isComparisonGenerating: isGenerating,
    comparisonProgress: progress,
    comparisonError,
    clearComparisonError,
  };
}
