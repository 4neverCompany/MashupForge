/**
 * Higgsfield CLI adapter — ProviderAdapter implementation that
 * shells out to the locally-installed `@higgsfield/cli` binary
 * (`higgsfield` or `higgs`).
 *
 * Why CLI over MCP (DECISIONS.md ADR-005):
 *   The agentic tool-use loop in lib/agent-tools spawns a CLI per
 *   call. The MCP server at https://mcp.higgsfield.ai/mcp stays
 *   reserved for the deterministic OAuth flow (lib/higgsfield/oauth.ts)
 *   and token storage (lib/higgsfield/token-store.ts) — those need a
 *   long-lived connection; the model-generation calls don't.
 *
 * CLI surface we depend on (per @higgsfield/cli v0.1.40):
 *   higgsfield generate create <model> --prompt <text> [--seed N] [--out file]
 *       Generates a single image synchronously. Returns JSON to stdout
 *       (we force --json to be safe across versions).
 *   higgsfield generate create <model> --prompt <text> --image <ref>
 *       Image-to-image / character reference path.
 *   higgsfield video create <model> --prompt <text> [--image <ref>] [--duration N]
 *       Video generation. Some models are async; the CLI returns
 *       {"status": "queued", "request_id": "..."} in that case.
 *
 * Behaviour matrix:
 *   - If the CLI binary isn't on PATH the adapter's isAvailable()
 *     returns false; the Director skips it. generateImage/generateVideo
 *     throw ProviderUnavailableError.
 *   - If the binary errors on spawn (vendor/ missing) we surface the
 *     same error class.
 *   - Successful JSON output is validated against the schemas below.
 *   - We do NOT call the binary with shell:true unless it's a .cmd
 *     shim (handled by cli-utils.spawnNeedsShell).
 */

import { z } from 'zod';
import {
  type AssetRef,
  type GenerateImageOptions,
  type GenerateVideoOptions,
  type ProviderAdapter,
  ProviderParseError,
  ProviderRejectedError,
  ProviderUnavailableError,
  UnsupportedOperationError,
} from '../interface';
import {
  binaryExists,
  clampTimeout,
  cliInvoke,
  isBinaryAvailable,
  pushFlag,
  type CliInvokeOptions,
} from '../cli-utils';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

/** Response shape for a successful synchronous image generation.
 *  Matches what `@higgsfield/cli` returns with `--json`. */
const HiggsfieldImageResponse = z.object({
  /** Public URL to the generated image. */
  url: z.string().url().optional(),
  /** Local file path if the CLI wrote the image to disk. */
  path: z.string().optional(),
  /** Provider-internal request id, present even on sync calls. */
  request_id: z.string().optional(),
  /** Wall-clock duration the CLI reports. Useful for budget tracking. */
  duration: z.number().optional(),
  /** Generation metadata echoed back for debugging. */
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type HiggsfieldImageResponseT = z.infer<typeof HiggsfieldImageResponse>;

/** Response shape for video generation. Async when `status === 'queued'`. */
const HiggsfieldVideoResponse = z.object({
  url: z.string().url().optional(),
  path: z.string().optional(),
  request_id: z.string().optional(),
  status: z.enum(['completed', 'queued', 'failed']).optional(),
  duration: z.number().optional(),
  error: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type HiggsfieldVideoResponseT = z.infer<typeof HiggsfieldVideoResponse>;

/** Common error payload shape. */
const HiggsfieldErrorPayload = z.object({
  error: z.object({
    code: z.union([z.string(), z.number()]).optional(),
    message: z.string(),
    hint: z.string().optional(),
  }),
});

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

const DEFAULT_BINARIES = ['higgsfield', 'higgs'] as const;
const DEFAULT_IMAGE_MODEL = 'text2image_soul_v2';
const DEFAULT_VIDEO_MODEL = 'seedance_2_0';

export class HiggsfieldCliAdapter implements ProviderAdapter {
  readonly name = 'higgsfield';
  readonly label = 'Higgsfield (CLI)';

  private resolvedBinary: string | null = null;
  private resolveAttempted = false;

  /**
   * Probe for the CLI binary. We try `higgsfield` first, then `higgs`
   * (both are exported by @higgsfield/cli). The result is cached
   * after the first successful probe so the hot path stays O(1).
   */
  async isAvailable(): Promise<boolean> {
    if (this.resolvedBinary) return true;
    if (this.resolveAttempted && !this.resolvedBinary) return false;

    // Honour explicit override.
    if (process.env.HIGGSFIELD_BIN && binaryExists(process.env.HIGGSFIELD_BIN)) {
      this.resolvedBinary = process.env.HIGGSFIELD_BIN;
      this.resolveAttempted = true;
      return true;
    }

    for (const name of DEFAULT_BINARIES) {
      if (await isBinaryAvailable(name)) {
        this.resolvedBinary = name;
        this.resolveAttempted = true;
        return true;
      }
    }
    this.resolveAttempted = true;
    return false;
  }

  async generateImage(opts: GenerateImageOptions): Promise<AssetRef> {
    if (!opts.prompt) {
      throw new ProviderParseError(this.name, 'generateImage requires a non-empty prompt');
    }
    const bin = await this.requireBinary();
    const model = opts.model ?? DEFAULT_IMAGE_MODEL;

    const args = ['generate', 'create', model, '--json'];
    pushFlag(args, '--prompt', opts.prompt);
    pushFlag(args, '--seed', opts.seed);
    pushFlag(args, '--width', opts.width);
    pushFlag(args, '--height', opts.height);
    if (opts.aspectRatio) pushFlag(args, '--aspect-ratio', opts.aspectRatio);
    if (opts.negativePrompt) pushFlag(args, '--negative-prompt', opts.negativePrompt);
    if (opts.referenceImage?.path) pushFlag(args, '--image', opts.referenceImage.path);
    else if (opts.referenceImage?.url) pushFlag(args, '--image-url', opts.referenceImage.url);
    else if (opts.referenceImage?.id) pushFlag(args, '--image-id', opts.referenceImage.id);

    const invokeOpts: CliInvokeOptions<unknown> = {
      provider: this.name,
      binary: bin,
      args,
      timeoutMs: opts.timeoutMs,
      signal: opts.signal,
    };

    const result = await this.runWithErrorMapping(invokeOpts, HiggsfieldImageResponse);
    return imageResponseToAssetRef(result, this.name);
  }

  async generateVideo(opts: GenerateVideoOptions): Promise<AssetRef> {
    if (!opts.prompt && !opts.imagePath && !opts.imageUrl && !opts.imageId) {
      throw new ProviderParseError(
        this.name,
        'generateVideo requires a prompt or a start-frame image',
      );
    }
    const bin = await this.requireBinary();
    const model = opts.model ?? DEFAULT_VIDEO_MODEL;

    const args = ['video', 'create', model, '--json'];
    pushFlag(args, '--prompt', opts.prompt);
    pushFlag(args, '--duration', opts.durationSec);
    if (opts.imagePath) pushFlag(args, '--image', opts.imagePath);
    else if (opts.imageUrl) pushFlag(args, '--image-url', opts.imageUrl);
    else if (opts.imageId) pushFlag(args, '--image-id', opts.imageId);

    const invokeOpts: CliInvokeOptions<unknown> = {
      provider: this.name,
      binary: bin,
      args,
      // Video gen is the slow path; clampTimeout applies the spec
      // 60s default when no override is supplied. Callers needing
      // longer (e.g. slow models behind a queue) pass an explicit
      // `opts.timeoutMs` and clampTimeout honours it.
      timeoutMs: clampTimeout(opts.timeoutMs),
      signal: opts.signal,
    };

    const result = await this.runWithErrorMapping(invokeOpts, HiggsfieldVideoResponse);
    return videoResponseToAssetRef(result, this.name);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async requireBinary(): Promise<string> {
    if (this.resolvedBinary) return this.resolvedBinary;
    const ok = await this.isAvailable();
    if (!ok || !this.resolvedBinary) {
      throw new ProviderUnavailableError(
        this.name,
        process.env.HIGGSFIELD_BIN ?? DEFAULT_BINARIES[0],
      );
    }
    return this.resolvedBinary;
  }

  /**
   * Shared run helper. Wraps cliInvoke, then re-checks the parsed
   * JSON for an error payload that didn't surface as a non-zero
   * exit (some CLIs exit 0 with a JSON error blob).
   */
  private async runWithErrorMapping<S extends z.ZodTypeAny>(
    opts: CliInvokeOptions<unknown>,
    schema: S,
  ): Promise<z.infer<S>> {
    // We do a manual invoke because we need to inspect the JSON for
    // an `error` key even when the CLI exits 0. cliInvoke already
    // handles non-zero exit; this is the zero-exit-but-still-error
    // path. We bypass cliInvoke's Zod validation by passing
    // `schema: undefined` and re-validating the parsed JSON against
    // both the error and the success schemas ourselves.
    //
    // Order matters: we check the error schema FIRST because the
    // success schemas are intentionally permissive (all fields
    // optional) so an `{ error: { ... } }` payload would otherwise
    // pass the success schema with all fields undefined and the
    // adapter would silently return an empty AssetRef.
    const invoked = await cliInvoke<unknown>({ ...opts, schema: undefined });
    const raw = invoked.parsed;
    // First: is this an error payload? The CLI exits 0 but reports
    // a failure via the `error` key. Surface as ProviderRejectedError
    // so the Director treats it as non-recoverable.
    const errPayload = HiggsfieldErrorPayload.safeParse(raw);
    if (errPayload.success) {
      throw new ProviderRejectedError(
        this.name,
        errPayload.data.error.code ?? 'UNKNOWN',
        errPayload.data.error.message,
        errPayload.data.error.hint,
      );
    }
    // Then: validate against the success schema.
    const parsed = schema.safeParse(raw);
    if (parsed.success) return parsed.data;
    // Neither: real parse error.
    throw new ProviderParseError(
      this.name,
      `response did not match schema: ${parsed.error.message}`,
      invoked.stdout.slice(0, 500),
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function imageResponseToAssetRef(
  r: HiggsfieldImageResponseT,
  provider: string,
): AssetRef {
  if (r.url) {
    return {
      kind: 'image',
      provider,
      url: r.url,
      path: r.path,
      jobId: r.request_id,
      raw: r,
    };
  }
  if (r.path) {
    return { kind: 'image', provider, path: r.path, jobId: r.request_id, raw: r };
  }
  if (r.request_id) {
    // Async shape — caller will need to poll.
    return { kind: 'job', provider, jobId: r.request_id, raw: r };
  }
  // Schema-valid but no asset fields. Treat as a parse failure
  // because the CLI shape has changed.
  throw new ProviderParseError(
    provider,
    'Higgsfield response had no url/path/request_id',
    JSON.stringify(r).slice(0, 500),
  );
}

function videoResponseToAssetRef(
  r: HiggsfieldVideoResponseT,
  provider: string,
): AssetRef {
  if (r.status === 'failed') {
    throw new ProviderRejectedError(
      provider,
      'FAILED',
      r.error ?? 'Higgsfield video generation failed',
    );
  }
  if (r.status === 'queued' || (!r.url && !r.path && r.request_id)) {
    return {
      kind: 'job',
      provider,
      jobId: r.request_id,
      durationSec: r.duration,
      raw: r,
    };
  }
  if (r.url || r.path) {
    return {
      kind: 'video',
      provider,
      url: r.url,
      path: r.path,
      jobId: r.request_id,
      durationSec: r.duration,
      raw: r,
    };
  }
  throw new ProviderParseError(
    provider,
    'Higgsfield video response had no url/path/request_id',
    JSON.stringify(r).slice(0, 500),
  );
}

// ---------------------------------------------------------------------------
// Public singleton (matches the rest of lib/providers/)
// ---------------------------------------------------------------------------

export const higgsfieldAdapter: ProviderAdapter = new HiggsfieldCliAdapter();

// Suppress unused-warning for the type-only import in some configs.
export type { ProviderAdapter, UnsupportedOperationError };
