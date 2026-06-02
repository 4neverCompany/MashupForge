/**
 * P2 of PROV-AGNOSTIC-PARAMS: text-model specs class. Tests cover the
 * three contract surfaces the route layer relies on:
 *   1. defaults + mode-override merging (mode override wins when set)
 *   2. unknown models return an empty object (safe-to-spread contract)
 *   3. provider-bucketing helper returns only matching entries
 */
import { describe, it, expect } from 'vitest';
import {
  getTextModelSpec,
  getTextModelParams,
  getAllTextModelSpecs,
  getTextModelSpecsByProvider,
} from '@/lib/text-model-specs';

describe('text-model-specs P2', () => {
  it('ships specs for each of the two vercel-ai providers (post-cleanup)', () => {
    // 0513-CONSOLIDATION: the chain was trimmed from 4 providers to 2.
    // Anthropic and OpenRouter specs were removed.
    const minimax = getTextModelSpecsByProvider('minimax');
    const openai = getTextModelSpecsByProvider('openai');
    expect(minimax.length).toBeGreaterThanOrEqual(3); // M2.5, M2.7, M2.7-highspeed
    expect(openai.length).toBeGreaterThanOrEqual(1);   // gpt-4o-mini

    // The two dropped providers return no text specs.
    expect(getTextModelSpecsByProvider('anthropic')).toEqual([]);
    expect(getTextModelSpecsByProvider('openrouter')).toEqual([]);

    // leonardo has no text models — must not accidentally pick up
    // image specs from the parallel lib/model-specs registry.
    expect(getTextModelSpecsByProvider('leonardo')).toEqual([]);
  });

  it('getTextModelSpec returns the full record for known ids', () => {
    const m25 = getTextModelSpec('MiniMax-M2.5');
    expect(m25).toBeDefined();
    expect(m25?.provider).toBe('minimax');
    expect(m25?.defaults.temperature).toBe(0.8);
    expect(m25?.defaults.maxTokens).toBe(4096);

    const m27 = getTextModelSpec('MiniMax-M2.7');
    expect(m27?.defaults.temperature).toBe(0.7);
    expect(m27?.defaults.maxTokens).toBe(8192);

    expect(getTextModelSpec('not-a-real-model')).toBeUndefined();
  });

  it('getTextModelParams without mode returns the model defaults', () => {
    const params = getTextModelParams('MiniMax-M2.5');
    expect(params.temperature).toBe(0.8);
    expect(params.maxTokens).toBe(4096);
  });

  it('mode override wins over the default temperature', () => {
    // idea → 0.95 from SHARED_MODE_OVERRIDES; defaults are 0.8
    const idea = getTextModelParams('MiniMax-M2.5', 'idea');
    expect(idea.temperature).toBe(0.95);
    // maxTokens is NOT overridden per-mode, so the default leaks through
    expect(idea.maxTokens).toBe(4096);

    // tag → 0.3, structured short output
    const tag = getTextModelParams('MiniMax-M2.5', 'tag');
    expect(tag.temperature).toBe(0.3);
    expect(tag.maxTokens).toBe(4096);
  });

  it('mode override is consistent across models with the shared profile', () => {
    // Every shipped model uses SHARED_MODE_OVERRIDES → same temperature
    // per mode, only the maxTokens default differs (M2.7 has 8192).
    for (const modelId of ['MiniMax-M2.5', 'MiniMax-M2.7', 'gpt-4o-mini']) {
      expect(getTextModelParams(modelId, 'idea').temperature).toBe(0.95);
      expect(getTextModelParams(modelId, 'tag').temperature).toBe(0.3);
      expect(getTextModelParams(modelId, 'enhance').temperature).toBe(0.5);
    }
  });

  it('getTextModelParams returns an empty object for unknown models — safe to spread', () => {
    const params = getTextModelParams('totally-fake-model', 'idea');
    expect(params).toEqual({});
    // Spread into a request body must be a no-op.
    const body = { model: 'totally-fake-model', stream: true, ...params };
    expect(body).toEqual({ model: 'totally-fake-model', stream: true });
  });

  it('unknown mode falls back to model defaults (no crash)', () => {
    const params = getTextModelParams(
      'MiniMax-M2.5',
      'some-future-mode-not-in-overrides' as unknown as 'chat',
    );
    expect(params.temperature).toBe(0.8); // default leaks through
    expect(params.maxTokens).toBe(4096);
  });

  it('getAllTextModelSpecs returns the 4 post-cleanup specs', () => {
    // 0513-CONSOLIDATION: 3 MiniMax variants + 1 OpenAI = 4 specs.
    // Pre-cleanup this was 6 (added claude-3-haiku + openai/gpt-4o-mini).
    const all = getAllTextModelSpecs();
    expect(all.length).toBe(4);
    // Smoke: every spec has the required structural fields.
    for (const s of all) {
      expect(s.modelId).toBeTruthy();
      expect(s.provider).toBeTruthy();
      expect(s.defaults).toBeDefined();
    }
  });
});
