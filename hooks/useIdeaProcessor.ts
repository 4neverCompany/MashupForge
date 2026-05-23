'use client';

import { useCallback } from 'react';
import { streamAIToString } from '@/lib/aiClient';
import {
  type Idea,
  type UserSettings,
  type GeneratedImage,
  type GenerateOptions,
  type ScheduledPost,
  type PipelineProgress,
  LEONARDO_MODELS,
  LEONARDO_SHARED_STYLES,
  MODEL_PROMPT_GUIDES,
} from '../types/mashup';
import { suggestParametersAI, type PerModelSuggestion } from '@/lib/param-suggest';
import {
  loadEngagementData,
  type CachedEngagement,
  type EngagementHour,
  type EngagementDay,
} from '@/lib/smartScheduler';
import { pickFillWeekSlot } from '@/lib/fill-week-scheduler';
import { fetchWithRetry } from '@/lib/fetchWithRetry';
import {
  processIdea as processIdeaFn,
  type ProcessIdeaDeps,
  type ResumeContext,
} from '@/lib/pipeline-processor';
import { awaitImagesOrSkip } from '@/lib/image-readiness';
import { generateNegativePrompt } from '@/lib/negative-prompts';
import { extractTrademarkNames } from '@/lib/extract-trademark-names';
import { getAllBlocked, setOutcome } from '@/lib/trademark-outcomes';
import { MASHUPFORGE_AI_PERSONA } from '@/lib/agent-prompt';
import type { WriteCheckpointBase } from './usePipelineDaemon';
import { useDesktopConfig } from './useDesktopConfig';

export interface UseIdeaProcessorDeps {
  getSettings: () => UserSettings;
  generateComparison: (
    prompt: string,
    modelIds: string[],
    options?: GenerateOptions,
  ) => Promise<GeneratedImage[]>;
  generatePostContent: (img: GeneratedImage) => Promise<GeneratedImage | undefined>;
  saveImage: (img: GeneratedImage) => void;
  updateIdeaStatus: (id: string, status: 'idea' | 'in-work' | 'done') => void;
  updateSettings: (
    patch: Partial<UserSettings> | ((prev: UserSettings) => Partial<UserSettings>),
  ) => void;
  addLog: (
    step: string,
    ideaId: string,
    status: 'success' | 'error',
    message: string,
  ) => void;
  setPipelineProgress: (p: PipelineProgress | null) => void;
}

function findNextAvailableSlot(
  existingPosts: ScheduledPost[],
  engagement: CachedEngagement | undefined,
  platforms: string[] | undefined,
  caps: UserSettings['pipelineDailyCaps'] | undefined,
  postsPerDay: number,
): { date: string; time: string; reason: string } {
  const eng = engagement || loadEngagementData();
  // V060-004: route through pickFillWeekSlot so the engagement-best
  // slot lands in the current week until it's filled, then extends
  // into week 2.
  const slot = pickFillWeekSlot({
    posts: existingPosts,
    engagement: eng,
    postsPerDay,
    platforms,
    caps,
  });
  const topHour = eng.hours.reduce((a: EngagementHour, b: EngagementHour) =>
    a.weight > b.weight ? a : b,
  );
  const topDay = eng.days.reduce((a: EngagementDay, b: EngagementDay) =>
    a.multiplier > b.multiplier ? a : b,
  );
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const slotDate = new Date(slot.date);
  const capsActive = caps && Object.values(caps).some(v => typeof v === 'number');
  const reason = `${slot.time} on ${dayNames[slotDate.getDay()]} (week ${slot.week}, ${
    eng.source === 'instagram' ? 'IG insights' : 'research'
  } — best hour ${topHour.hour}:00, best day ${dayNames[topDay.day]}${
    capsActive ? ', caps applied' : ''
  })`;
  return { date: slot.date, time: slot.time, reason };
}

/**
 * Per-idea processor hook. Owns no state — builds a ProcessIdeaDeps bag
 * from daemon-supplied live readers + caller-supplied primitives and
 * delegates to the pure processIdeaFn in lib/pipeline-processor.ts.
 */
export function useIdeaProcessor(deps: UseIdeaProcessorDeps) {
  const {
    getSettings,
    generateComparison,
    generatePostContent,
    saveImage,
    updateIdeaStatus,
    updateSettings,
    addLog,
    setPipelineProgress,
  } = deps;

  // V041-HOTFIX-IG: pipeline-processor needs desktop credential flags to
  // detect IG/PN/TW/DC creds stored in config.json (env-style), not just
  // settings.apiKeys (web-mode IDB). Without this, desktop users with
  // creds saved in the Desktop tab see "No platforms configured".
  const { isDesktop, credentials: desktopCreds } = useDesktopConfig();

  const expandIdeaToPrompt = useCallback(
    async (idea: Idea, trendingContext?: string): Promise<string> => {
      const s = getSettings();
      // TRADEMARK-LEARNING (2026-05-21): inject the learned blocklist into
      // the system prompt so the upstream prompt-enhance step generalizes
      // known-bad IP into descriptors instead of writing them out. This
      // is the "feedback" loop side of the store — pre-flight rewrite
      // still catches it post-hoc, but front-loading the AI saves a
      // pipeline step. List grows as the outcome store learns from
      // future failures.
      const blockedNames = getAllBlocked();
      const blockedBlock = blockedNames.length > 0
        ? `\nTRADEMARKED CHARACTERS TO AVOID (based on past pipeline failures): ${blockedNames.join(', ')}.\nUse generic descriptions instead (e.g. "a spider-powered hero" instead of "Spider-Man").\n`
        : '';
      // AI-ROLE-REDESIGN (2026-05-22): Content Pillars / Style Tags
      // labels replace the prior "Active Niches / Active Genres"
      // vocabulary. The settings keys (agentNiches/agentGenres) are
      // unchanged for storage back-compat. Persona fallback also
      // upgraded to the MashupForge AI co-pilot framing.
      const systemContext = `${s.agentPrompt || MASHUPFORGE_AI_PERSONA}
Content Pillars: ${s.agentNiches?.join(', ') || 'None — operate on the idea concept alone'}.
Style Tags: ${s.agentGenres?.join(', ') || 'None — let the idea concept guide style'}.

Mode: prompt expansion. Take this content idea and produce a single, highly detailed image generation prompt (40-60 words). Honor the Content Pillars and Style Tags above as your orientation.
${trendingContext ? `\nCURRENT TRENDING CONTEXT — weave relevant trends into the prompt to make it timely and shareable:\n${trendingContext}\n` : ''}${blockedBlock}
Return ONLY the prompt text, nothing else.`;

      const text = await streamAIToString(
        `${systemContext}\n\nIdea concept: ${idea.concept}\n${idea.context ? `Additional context: ${idea.context}` : ''}\n\nGenerate a single detailed image prompt for this idea.`,
        { mode: 'enhance', provider: s.activeAiAgent },
      );
      return text.trim() || idea.concept;
    },
    [getSettings],
  );

  const processIdea = useCallback(
    async (
      idea: Idea,
      index: number,
      total: number,
      engagement: CachedEngagement,
      accumulatedPosts: ScheduledPost[],
      skipSignal: AbortSignal,
      writeCheckpointBase: WriteCheckpointBase,
      resumeFrom?: ResumeContext,
    ): Promise<void> => {
      const perIdeaImageIds: string[] = [];
      const checkpoint = (step: string) =>
        writeCheckpointBase(idea.id, idea.concept, step, perIdeaImageIds);

      // V030-006: capture the generator's own Promise instead of polling a
      // parallel image store. triggerImageGeneration fires the call and
      // stashes the Promise; waitForImages awaits it (racing skipSignal).
      let imageReadyPromise: Promise<GeneratedImage[]> | null = null;

      const processorDeps: ProcessIdeaDeps = {
        fetchTrendingContext: async ideaArg => {
          const s = getSettings();
          const res = await fetchWithRetry('/api/trending', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tags: [],
              niches: s.agentNiches,
              genres: s.agentGenres,
              ideaConcept: ideaArg.concept,
            }),
          });
          const data = (await res.json()) as { success?: boolean; summary?: string };
          if (data.success && data.summary) return data.summary;
          return '';
        },
        expandIdeaToPrompt,
        triggerImageGeneration: async (prompt, modelIds, trendingContext) => {
          // Run the deterministic param-suggest rule engine for this
          // idea's prompt so the pipeline uses the same style / aspect /
          // negative prompt picks as the interactive Compare flow. Falls
          // back silently if suggestion fails — generation still runs
          // with the base negative prompt derived from user genres.
          const s = getSettings();
          const baseNegative = generateNegativePrompt(
            s.agentGenres || [],
            s.agentNiches || [],
          );
          let suggestedOptions: Partial<GenerateOptions> = {};
          try {
            // AI-PARAM-SUGGEST (2026-05-20): route through the user's
            // text-AI backend. Capability post-filter in suggestParametersAI
            // strips any field the AI hallucinates outside a model's spec,
            // and any failure falls back silently to the rule engine.
            const suggestion = await suggestParametersAI(
              {
                prompt,
                availableModels: LEONARDO_MODELS,
                modelGuides: MODEL_PROMPT_GUIDES,
                availableStyles: LEONARDO_SHARED_STYLES,
                savedImages: [],
                includedModelIds: modelIds,
                // PARAM-TRENDING (2026-05-21): thread the pipeline's
                // already-fetched trending blurb into the AI so style /
                // aspect picks can react to current trends. Empty string
                // when fetchTrendingContext returned nothing — the prompt
                // template handles that with a "(none available)" line.
                trendingContext,
              },
              {
                aiCall: (message, signal) =>
                  streamAIToString(message, {
                    provider: s.activeAiAgent,
                    mode: 'chat',
                    signal,
                  }),
              },
            );
            // V090-PIPELINE-STYLE-DIVERSITY: extract per-model styles
            // from the suggestion so nano-banana siblings each get a
            // different style instead of all sharing the first model's pick.
            const perModelOpts: Record<string, { style?: string; aspectRatio?: string; negativePrompt?: string }> = {};
            for (const mid of Object.keys(suggestion.perModel)) {
              const entry = suggestion.perModel[mid] as PerModelSuggestion;
              if (entry.type === 'image' && entry.style) {
                perModelOpts[mid] = { style: entry.style };
              }
            }
            suggestedOptions = {
              style: suggestion.style,
              aspectRatio: suggestion.aspectRatio,
              imageSize: suggestion.imageSize,
              negativePrompt: suggestion.negativePrompt || baseNegative,
              quality: suggestion.quality,
              promptEnhance: suggestion.promptEnhance,
              perModelOptions: perModelOpts,
            };
          } catch {
            suggestedOptions = { negativePrompt: baseNegative };
          }

          // TRADEMARK-NO-PREFLIGHT-REWRITE (2026-05-22): Maurice's
          // addendum to /tmp/dev-trademark-bug.md — the rewrite should
          // ONLY fire after a real moderation failure, not proactively
          // before generation is attempted. Pre-flight substitution
          // (introduced 9401247, tightened aa2a068) re-wrote prompts
          // that would have succeeded as-is, losing user composition.
          // We pass the user's prompt through verbatim; if a model
          // rejects with TRADEMARK/COPYRIGHT, useImageGeneration's
          // submitWithOneRetry (and useComparison's inline retry)
          // handle the deterministic name-swap as a fallback. The
          // outcome store's getAllBlocked() result still feeds the AI
          // prompt hint in expandIdeaToPrompt above so the upstream
          // AI generalises names while AUTHORING fresh content — that
          // path doesn't rewrite user input, it shapes new prompts.
          const activePrompt = prompt;

          imageReadyPromise = generateComparison(activePrompt, modelIds, {
            skipEnhance: false,
            ...suggestedOptions,
            // Surface per-model Leonardo/MiniMax failures in the pipeline
            // log. Without this hook, the only signal of a failed model
            // is a smaller readyImages array vs. modelIds.length — and
            // the WHY (400 prompt-too-long, moderation, validation, …)
            // lives only on the Compare placeholder, which Pipeline users
            // never see. Added 2026-05-21 after the "only MiniMax shows
            // up in Pipeline" debugging session.
            //
            // TRADEMARK-LEARNING: when the error string mentions TRADEMARK
            // (Leonardo's classification surfaces through this string at
            // useComparison.ts:382 as "Blocked after rewrite: TRADEMARK…"),
            // extract names from the prompt we submitted. Only auto-flag
            // 'blocked' when EXACTLY ONE name is in the prompt — that's
            // the unambiguous case where we know which name triggered the
            // moderation.
            //
            // TRADEMARK-SURGICAL-REWRITE (2026-05-21): Maurice's bug report
            // — when a multi-name prompt blocked, the prior code marked
            // EVERY extracted name 'blocked' even though only one was the
            // trigger. Iron Man got falsely flagged from a Spider-Man +
            // Iron Man prompt where Spider-Man was the real trigger,
            // poisoning the learning store. Now: if there are multiple
            // candidate names, just log them so a human / future
            // disambiguation can act — don't auto-poison the store.
            onModelError: (modelId, modelName, err) => {
              addLog('image-gen', idea.id, 'error', `${modelName} failed: ${err}`);
              if (/TRADEMARK|COPYRIGHT/i.test(err)) {
                const observedNames = extractTrademarkNames(activePrompt);
                if (observedNames.length === 1) {
                  const name = observedNames[0];
                  setOutcome(name, 'blocked', modelId);
                  addLog(
                    'moderation',
                    idea.id,
                    'error',
                    `TRADEMARK blocked: ${modelName} — marked "${name}" blocked for ${modelName} for future pre-flight (sole candidate in prompt)`,
                  );
                } else if (observedNames.length > 1) {
                  addLog(
                    'moderation',
                    idea.id,
                    'error',
                    `TRADEMARK blocked: ${modelName} — ${observedNames.length} candidate names in prompt, NOT auto-flagging (ambiguous trigger): ${observedNames.join(', ')}`,
                  );
                }
              }
            },
          });
          // Swallow the images here — processor contract is Promise<void>.
          // waitForImages reads the captured Promise next.
          await imageReadyPromise;
        },
        getEnabledModelIds: () => {
          // MODEL-PRESELECT-FIX (2026-05-21): bridge between the Studio
          // Compare picker (persists to localStorage.mashup_comparison_models
          // — see components/MainContent.tsx:1468) and the pipeline's
          // model-list step. Returns [] on SSR / missing key / parse failure;
          // pipeline-processor handles the empty case by falling back to
          // "all Leonardo models minus nano-banana".
          try {
            if (typeof window === 'undefined') return [];
            const raw = window.localStorage.getItem('mashup_comparison_models');
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed.filter((x): x is string => typeof x === 'string');
          } catch {
            return [];
          }
        },
        waitForImages: async () => {
          if (!imageReadyPromise) return [];
          const readyImages = await awaitImagesOrSkip(imageReadyPromise, skipSignal);
          for (const img of readyImages) {
            if (!perIdeaImageIds.includes(img.id)) perIdeaImageIds.push(img.id);
          }
          return readyImages;
        },
        generatePostContent,
        saveImage: img => {
          saveImage(img);
          if (!perIdeaImageIds.includes(img.id)) perIdeaImageIds.push(img.id);
        },
        updateIdeaStatus,
        updateSettings,
        findNextAvailableSlot: (posts, eng, platforms, caps) =>
          findNextAvailableSlot(
            posts,
            eng,
            platforms,
            caps,
            getSettings().pipelinePostsPerDay ?? 2,
          ),
        addLog,
        setPipelineProgress,
        writeCheckpoint: checkpoint,
        isSkipRequested: () => skipSignal.aborted,
        getScheduledPosts: () => getSettings().scheduledPosts || [],
        desktopCreds: isDesktop ? desktopCreds : undefined,
      };

      // V050-001: seed perIdeaImageIds with the resume payload so the next
      // checkpoint write keeps tracking the same image set (otherwise a
      // crash mid-resume would lose the imageIds and force a full re-gen).
      if (resumeFrom) {
        for (const img of resumeFrom.images) {
          if (!perIdeaImageIds.includes(img.id)) perIdeaImageIds.push(img.id);
        }
      }

      await processIdeaFn(
        idea,
        index,
        total,
        engagement,
        accumulatedPosts,
        getSettings(),
        processorDeps,
        resumeFrom,
      );
    },
    [
      getSettings,
      generateComparison,
      generatePostContent,
      saveImage,
      updateIdeaStatus,
      updateSettings,
      addLog,
      setPipelineProgress,
      expandIdeaToPrompt,
      isDesktop,
      desktopCreds,
    ],
  );

  return { processIdea, expandIdeaToPrompt };
}
