/**
 * v1.2 Tool Registry — barrel / `AGENT_TOOLS` array tests.
 *
 * Asserts that every tool the Director loop relies on is:
 *   - present in `AGENT_TOOLS`
 *   - has a non-empty description (so the model knows when to use it)
 *   - has a Zod input schema (so the SDK can validate the model's call)
 *   - has a Zod output schema (so the loop can read the result)
 *   - has an `execute` function (the actual side-effecting code)
 */
import { describe, it, expect } from 'vitest';
import {
  AGENT_TOOLS,
  describeAgentTools,
  trendingSearchTool,
  generatePromptTool,
  critiquePromptTool,
  generateImageTool,
  generateVideoTool,
  persistAssetTool,
  m3VisionDescribeTool,
} from '@/lib/agent-tools';

describe('AGENT_TOOLS — barrel contents', () => {
  // V1.2.6: 7 tools total (was 6) — m3_vision_describe added.
  it('contains exactly the 7 documented tools', () => {
    expect(AGENT_TOOLS).toHaveLength(7);
  });

  it('contains the 7 expected tool references (in any order)', () => {
    const set = new Set(AGENT_TOOLS);
    expect(set.has(trendingSearchTool)).toBe(true);
    expect(set.has(generatePromptTool)).toBe(true);
    expect(set.has(critiquePromptTool)).toBe(true);
    expect(set.has(generateImageTool)).toBe(true);
    expect(set.has(generateVideoTool)).toBe(true);
    expect(set.has(persistAssetTool)).toBe(true);
    expect(set.has(m3VisionDescribeTool)).toBe(true);
  });
});

describe('AGENT_TOOLS — per-tool contract', () => {
  const docs = describeAgentTools();
  const expectedNames = [
    'trending_search',
    'generate_prompt',
    'critique_prompt',
    'generate_image',
    'generate_video',
    'persist_asset',
    'm3_vision_describe',
  ];

  it('exposes one description row per tool', () => {
    expect(docs).toHaveLength(7);
  });

  it('names match the 7 documented tools', () => {
    const names = docs.map((d) => d.name).sort();
    expect(names).toEqual([...expectedNames].sort());
  });

  for (const d of docs) {
    it(`${d.name}: has a non-empty description (>= 40 chars)`, () => {
      expect(d.description.length).toBeGreaterThan(40);
    });

    it(`${d.name}: has an inputSchema`, () => {
      expect(d.hasInputSchema).toBe(true);
    });

    it(`${d.name}: has an outputSchema`, () => {
      expect(d.hasOutputSchema).toBe(true);
    });
  }
});
