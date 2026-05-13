// LLM-INTEGRATION-0513: Vercel AI SDK provider — direct API streaming.
//
// Same wire contract as /api/pi/prompt and /api/nca/prompt:
//   data: {"text":"<delta>"}\n\n
//   ...
//   data: {"error":"..."}\n\n   (on failure)
//   data: [DONE]\n\n
//
// Why a new route instead of patching the pi route:
//   - pi-client is a long-lived subprocess with its own auth + binary
//     install. This route is stateless and talks directly to the
//     provider's HTTPS endpoint, so it works on Vercel serverless and
//     in the Tauri desktop process without any sidecar/binary plumbing.
//   - The SSE shape is identical, so lib/aiClient.ts can route to this
//     route by URL alone; no client-side reader changes.
//
// Provider selection priority (first env var wins):
//   1. OPENAI_API_KEY      → openai (default model: gpt-4o-mini)
//   2. ANTHROPIC_API_KEY   → anthropic (default model: claude-3-haiku-20240307)
//   3. OPENROUTER_API_KEY  → openrouter (default model: openai/gpt-4o-mini)
//
// Per-request `model` body field, or VERCEL_AI_MODEL env var, overrides
// the default. Per-request always wins over env.
//
// Memory + trending enrichment (used by /api/pi/prompt for `idea` mode)
// is intentionally NOT replicated here. Those are pi-specific quality
// improvements that depend on the long-lived process for caching state.
// If the user wants the full idea pipeline, they should stay on the pi
// or nca provider. This route prioritises predictable streaming with
// zero subprocess management.

import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';
import { getErrorMessage } from '@/lib/errors';

// Both the AI SDK provider clients and any future Node-only deps demand
// the Node runtime — edge stripped fetch agents the SDK relies on.
export const runtime = 'nodejs';

// Duplicated from lib/pi-client.ts on purpose (the brief forbids touching
// pi-client). If you change the wording here, mirror it there to keep
// the two routes producing comparable output.
const BASE_SYSTEM_PROMPT =
  "You are a creative AI assistant for the Multiverse Mashup Studio, a tool for generating crossover image prompts between Star Wars, Marvel, DC, and Warhammer 40k. Follow instructions precisely. When asked to return JSON, return ONLY valid JSON with no preamble, no commentary, and no markdown code fences. When asked for a single string, return ONLY that string.";

type AiMode =
  | 'chat'
  | 'generate'
  | 'idea'
  | 'enhance'
  | 'caption'
  | 'tag'
  | 'negative-prompt'
  | 'collection-info';

// Same directives as the pi route. Duplicated rather than imported because
// the pi module's `MODE_DIRECTIVES` is private to its file and the brief
// forbids touching pi-client / pi route. If you add a mode there, mirror
// it here.
const MODE_DIRECTIVES: Record<AiMode, string> = {
  chat:
    'You are an elite creative AI assistant. Be vivid, direct, and spectacular. No hedging.',
  generate:
    'You are a world-class prompt engineer. Every prompt you write must be visually breathtaking. Follow the output format exactly. No preamble.',
  idea:
    'You are a creative genius generating crossover concepts that break the internet. Marvel, DC, Star Wars, Warhammer 40k, anime, games — the wildest, most visually spectacular mashups imaginable. Avoid overused characters. Return ONLY the requested format.',
  enhance:
    'You are an elite prompt enhancer. Transform the input into the most visually stunning, cinematic prompt possible. Maximize drama, detail, and visual impact. Return ONLY the enhanced prompt.',
  caption:
    'You are a viral social-media copywriter. Captions that stop thumbs and drive engagement. Return ONLY valid JSON.',
  tag:
    'You are a hashtag and tag strategist for maximum reach. Return ONLY a JSON array of tag strings.',
  'negative-prompt':
    'Generate the most effective negative prompt to eliminate visual artifacts and low-quality output. Return ONLY the negative prompt text.',
  'collection-info':
    'Generate rich collection metadata. Return ONLY valid JSON.',
};

function directiveFor(mode: unknown): string | null {
  if (typeof mode !== 'string') return null;
  return (MODE_DIRECTIVES as Record<string, string>)[mode] || null;
}

function sanitizeStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map((s) => s.trim());
}

// V080-DES-003: same focus-block helper as pi route; duplicated to avoid
// a circular import through the pi route module.
function buildFocusBlock(niches: string[], genres: string[]): string {
  if (niches.length === 0 && genres.length === 0) return '';
  const nicheClause =
    niches.length > 0 ? `The user creates content in: ${niches.join(', ')}.` : '';
  const genreClause =
    genres.length > 0 ? `Favor themes and styles like: ${genres.join(', ')}.` : '';
  return [
    'Focus areas:',
    nicheClause,
    genreClause,
    'Every output should visibly reflect these areas.',
  ]
    .filter(Boolean)
    .join(' ');
}

interface ResolvedProvider {
  name: 'openai' | 'anthropic' | 'openrouter';
  model: LanguageModel;
  modelId: string;
}

/**
 * Pick a provider from env vars + optional per-request model override.
 * Returns null when no API key is configured — caller should 503.
 *
 * `modelOverride` (when present) is passed through verbatim. There's no
 * cross-provider validation: if a caller asks openai for an Anthropic
 * model name they get an opaque API error from the provider, which is
 * the right behaviour — we shouldn't second-guess the user.
 */
function resolveProvider(modelOverride?: string): ResolvedProvider | null {
  const envModel = process.env.VERCEL_AI_MODEL?.trim() || undefined;
  const requestedModel = modelOverride?.trim() || envModel;

  if (process.env.OPENAI_API_KEY) {
    const modelId = requestedModel || 'gpt-4o-mini';
    const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return { name: 'openai', model: openai(modelId), modelId };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    const modelId = requestedModel || 'claude-3-haiku-20240307';
    const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return { name: 'anthropic', model: anthropic(modelId), modelId };
  }
  if (process.env.OPENROUTER_API_KEY) {
    const modelId = requestedModel || 'openai/gpt-4o-mini';
    // OpenRouter exposes an OpenAI-compatible endpoint; the openai
    // provider with a custom baseURL is the canonical adapter.
    const openrouter = createOpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
    });
    return { name: 'openrouter', model: openrouter(modelId), modelId };
  }
  return null;
}

export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { message, mode, systemPrompt, niches, genres, model } = body || {};
  if (typeof message !== 'string' || !message.trim()) {
    return new Response(JSON.stringify({ error: 'message is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const provider = resolveProvider(typeof model === 'string' ? model : undefined);
  if (!provider) {
    return new Response(
      JSON.stringify({
        error:
          'No AI provider configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or OPENROUTER_API_KEY.',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const directive = directiveFor(mode);
  const focusBlock = buildFocusBlock(
    sanitizeStringArray(niches),
    sanitizeStringArray(genres),
  );
  const userSystem = typeof systemPrompt === 'string' ? systemPrompt.trim() : '';
  // Ordering matches the pi route: directive sets the role, user prompt
  // refines it, focus block targets niches. BASE_SYSTEM_PROMPT anchors
  // the whole stack so output formatting (JSON-only, no fences) stays
  // consistent across providers.
  const system =
    [BASE_SYSTEM_PROMPT, directive, userSystem, focusBlock]
      .filter((s): s is string => typeof s === 'string' && s.length > 0)
      .join('\n\n') || undefined;

  const encoder = new TextEncoder();

  // Synthesise our own SSE stream. The SDK exposes textStream as an
  // AsyncIterable<string>, which makes the per-delta SSE wrap trivial
  // and keeps the route's wire shape identical to /api/pi/prompt and
  // /api/nca/prompt without depending on Vercel's data-protocol wrapper.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const result = streamText({
          model: provider.model,
          system,
          prompt: message,
        });
        for await (const delta of result.textStream) {
          if (!delta) continue;
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ text: delta })}\n\n`),
          );
        }
      } catch (e: unknown) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: getErrorMessage(e) || 'AI stream error' })}\n\n`,
          ),
        );
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Surfaces in browser devtools for debugging which backend served
      // the request. Not used by the client code path.
      'X-AI-Provider': provider.name,
      'X-AI-Model': provider.modelId,
    },
  });
}
