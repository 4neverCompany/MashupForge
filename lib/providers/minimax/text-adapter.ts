/**
 * MiniMax M3 text+vision adapter — ProviderAdapter implementation
 * for MiniMax's M3 model via the `mmx` CLI.
 *
 * M3 is a text+vision INPUT multimodal model: it takes text and
 * (optionally) one or more images and produces TEXT output. It
 * does NOT generate images or video. The unified ProviderAdapter
 * contract still requires `generateImage` and `generateVideo`, so
 * we implement them as throws of `UnsupportedOperationError`. The
 * Director uses that to fall back to a different adapter rather
 * than treating it as a transient failure.
 *
 * The actual generation is delegated to `lib/mmx-client.ts`
 * (mmx `text chat` and `vision describe` subcommands). M3 maps to
 * mmx's `text` family with model name `M3` or `MiniMax-M3` — we
 * pass it through verbatim via the `model` field.
 *
 * Two non-ProviderAdapter methods are added because the M3 use case
 * is text/describe, not image/video:
 *   - `generateText({ messages, systemPrompt, signal, timeoutMs })`
 *   - `describeImage({ image|fileId, prompt, signal, timeoutMs })`
 *
 * This module-extension pattern (add methods beyond the interface)
 * is supported: the registry only knows about ProviderAdapter, so
 * the Director must opt-in to M3 by name. The lib/agent-tools
 * layer is responsible for that.
 */

import { z } from 'zod';
import {
  type AssetRef,
  type GenerateImageOptions,
  type GenerateVideoOptions,
  type ProviderAdapter,
  ProviderParseError,
  ProviderError,
  UnsupportedOperationError,
} from '../interface';
import {
  describeImage as mmxDescribeImage,
  isAvailable as mmxIsAvailable,
  prompt as mmxPromptStream,
  MmxError,
  MmxSpawnError,
  type MmxPromptOptions,
  type MmxVisionResult,
} from '../../mmx-client';

// ---------------------------------------------------------------------------
// Zod schemas for the result shapes
// ---------------------------------------------------------------------------

const VisionResultSchema = z.object({
  description: z.string(),
  raw: z.unknown().optional(),
});

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export interface MinimaxTextAdapterOptions {
  /** Default model id passed to mmx. Default "M3". */
  defaultModel?: string;
}

export class MinimaxTextAdapter implements ProviderAdapter {
  readonly name = 'minimax-text';
  readonly label = 'MiniMax M3 (text+vision)';

  private readonly opts: MinimaxTextAdapterOptions;

  constructor(opts: MinimaxTextAdapterOptions = {}) {
    this.opts = opts;
  }

  get defaultModel(): string {
    return this.opts.defaultModel ?? 'M3';
  }

  async isAvailable(): Promise<boolean> {
    try {
      return await mmxIsAvailable();
    } catch {
      return false;
    }
  }

  /**
   * M3 doesn't generate images. The Director must catch this and
   * try the next adapter (mmx's image adapter or the MiniMax video
   * adapter's `generateImage` if it has one).
   */
  async generateImage(_opts: GenerateImageOptions): Promise<AssetRef> {
    throw new UnsupportedOperationError(this.name, 'image');
  }

  /** M3 is text-only. */
  async generateVideo(_opts: GenerateVideoOptions): Promise<AssetRef> {
    throw new UnsupportedOperationError(this.name, 'video');
  }

  /**
   * Send a single-turn prompt to M3 and stream the response.
   * Yielded strings are text deltas; the caller concatenates them.
   *
   * Note: mmx's `text chat` is a one-shot subprocess per prompt.
   * The Director should batch the prompt into a single `generateText`
   * call to avoid per-token spawn overhead. If the agent needs real
   * streaming UX, a separate long-lived transport (e.g. Vercel AI
   * SDK's streamText) should be used instead of this adapter.
   */
  async *generateText(
    message: string,
    options?: MmxPromptOptions,
  ): AsyncGenerator<string, void, void> {
    if (!message || !message.trim()) {
      throw new ProviderParseError(this.name, 'generateText requires a non-empty message');
    }
    try {
      for await (const delta of mmxPromptStream(message, options)) {
        yield delta;
      }
    } catch (e) {
      throw remapMmxError(e, this.name);
    }
  }

  /**
   * Describe / answer a question about an image. mmx's
   * `vision describe` subcommand under the hood. Returns the full
   * description as a single string (not streamed — vision outputs
   * are short).
   */
  async describeImage(
    source: { image: string } | { fileId: string },
    opts: { prompt?: string; signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<{ description: string; raw: unknown }> {
    let result: MmxVisionResult;
    try {
      result = await mmxDescribeImage(
        source,
        { prompt: opts.prompt },
        { timeoutMs: opts.timeoutMs, signal: opts.signal },
      );
    } catch (e) {
      throw remapMmxError(e, this.name);
    }
    const parsed = VisionResultSchema.safeParse(result);
    if (!parsed.success) {
      throw new ProviderParseError(
        this.name,
        `M3 vision result failed schema: ${parsed.error.message}`,
        JSON.stringify(result).slice(0, 500),
      );
    }
    return { description: parsed.data.description, raw: parsed.data.raw };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function remapMmxError(e: unknown, provider: string): ProviderError {
  if (e instanceof MmxSpawnError) {
    return new ProviderError('UNAVAILABLE', e.message, provider, e.hint, e);
  }
  if (e instanceof MmxError) {
    return new ProviderError(String(e.code), e.message, provider, e.hint, e);
  }
  if (e instanceof Error) {
    return new ProviderError('UNKNOWN', e.message, provider, undefined, e);
  }
  return new ProviderError('UNKNOWN', String(e), provider);
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const minimaxTextAdapter: ProviderAdapter = new MinimaxTextAdapter();
