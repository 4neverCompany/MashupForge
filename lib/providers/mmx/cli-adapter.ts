/**
 * MMX CLI adapter — ProviderAdapter implementation that delegates
 * to the canonical `lib/mmx-client.ts` module.
 *
 * lib/mmx-client.ts is the long-lived, well-tested spawner for the
 * `mmx` binary (the Multi-Modal MiniMax wrapper CLI). It already
 * implements:
 *   - cross-platform spawn (with the .cmd/.bat shell:true fix for
 *     Windows, see lib/mmx-client.ts line 61)
 *   - structured error mapping (MmxError, MmxQuotaError,
 *     MmxSpawnError)
 *   - JSON parsing of --output json responses
 *   - a __setSpawnForTests seam that the existing test suite
 *     uses (tests/lib/mmx-client.test.ts)
 *
 * This adapter's job is the thin one of re-shaping those results
 * into the ProviderAdapter contract (AssetRef with kind: 'image'
 * | 'video' | 'job'). We intentionally do NOT re-implement the
 * spawn logic — that would duplicate the working test surface and
 * drift over time.
 *
 * Per DECISIONS.md ADR-005: mmx is a CLI-first path. We keep MCP
 * out of the loop entirely for image/video generation; MCP is
 * reserved for the OAuth/token flows in lib/higgsfield/ (different
 * provider — not this one).
 */

import { z } from 'zod';
import {
  type AssetRef,
  type GenerateImageOptions,
  type GenerateVideoOptions,
  type ProviderAdapter,
  ProviderParseError,
  ProviderUnavailableError,
  ProviderError,
} from '../interface';
import {
  generateImage as mmxGenerateImage,
  generateVideo as mmxGenerateVideo,
  isAvailable as mmxIsAvailable,
  MmxError,
  MmxSpawnError,
  type MmxImageResult,
  type MmxVideoResult,
} from '../../mmx-client';

// ---------------------------------------------------------------------------
// Zod schemas for the inputs we accept
// ---------------------------------------------------------------------------

/**
 * mmx returns these shapes depending on the responseFormat option.
 * We re-validate the typed result before mapping to AssetRef so a
 * regression in mmx-client surfaces here (not in the Director).
 */
const MmxImageResultSchema = z.object({
  urls: z.array(z.string()).default([]),
  files: z.array(z.string()).default([]),
  base64: z.array(z.string()).default([]),
});
const MmxVideoResultSchema = z.object({
  taskId: z.string().optional(),
  path: z.string().optional(),
  raw: z.unknown().optional(),
});

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class MmxCliAdapter implements ProviderAdapter {
  readonly name = 'mmx';
  readonly label = 'MiniMax mmx (CLI)';

  async isAvailable(): Promise<boolean> {
    try {
      return await mmxIsAvailable();
    } catch {
      return false;
    }
  }

  async generateImage(opts: GenerateImageOptions): Promise<AssetRef> {
    if (!opts.prompt) {
      throw new ProviderParseError(this.name, 'generateImage requires a non-empty prompt');
    }
    let result: MmxImageResult;
    try {
      result = await mmxGenerateImage(
        opts.prompt,
        {
          aspectRatio: opts.aspectRatio,
          n: opts.n,
          seed: opts.seed,
          width: opts.width,
          height: opts.height,
          // mmx doesn't expose promptOptimizer/negativePrompt as
          // separate flags from its core image API; pass them via
          // extra so a future mmx version can pick them up.
          ...(opts.extra ?? {}),
        },
        {
          timeoutMs: opts.timeoutMs,
          signal: opts.signal,
        },
      );
    } catch (e) {
      throw remapMmxError(e, this.name);
    }

    const validated = MmxImageResultSchema.safeParse(result);
    if (!validated.success) {
      throw new ProviderParseError(
        this.name,
        `mmx image result failed schema: ${validated.error.message}`,
        JSON.stringify(result).slice(0, 500),
      );
    }

    const r = validated.data;
    const firstUrl = r.urls[0];
    const firstFile = r.files[0];

    if (firstUrl) {
      return {
        kind: 'image',
        provider: this.name,
        url: firstUrl,
        mimeType: 'image/png',
        raw: r,
      };
    }
    if (firstFile) {
      return {
        kind: 'image',
        provider: this.name,
        path: firstFile,
        mimeType: 'image/png',
        raw: r,
      };
    }
    // mmx returned no asset — surface as parse error so the Director
    // doesn't think the call succeeded.
    throw new ProviderParseError(
      this.name,
      'mmx image result had no url or file',
      JSON.stringify(r).slice(0, 500),
    );
  }

  async generateVideo(opts: GenerateVideoOptions): Promise<AssetRef> {
    if (!opts.prompt && !opts.imagePath && !opts.imageUrl) {
      throw new ProviderParseError(
        this.name,
        'generateVideo requires a prompt or a reference image',
      );
    }
    let result: MmxVideoResult;
    try {
      result = await mmxGenerateVideo(
        opts.prompt ?? 'Animate this image',
        {
          model: opts.model,
          // mmx CLI accepts file paths for first/last frame.
          firstFrame: opts.imagePath ?? (opts.imageUrl ? await downloadToTmp(opts.imageUrl) : undefined),
          callbackUrl: undefined,
          // Don't make mmx poll for us — the Director handles polling
          // via AssetRef.jobId and lib/post-lifecycle.
          noWait: true,
        },
        {
          timeoutMs: opts.timeoutMs ?? 5 * 60 * 1000,
          signal: opts.signal,
        },
      );
    } catch (e) {
      throw remapMmxError(e, this.name);
    }

    const validated = MmxVideoResultSchema.safeParse(result);
    if (!validated.success) {
      throw new ProviderParseError(
        this.name,
        `mmx video result failed schema: ${validated.error.message}`,
        JSON.stringify(result).slice(0, 500),
      );
    }
    const r = validated.data;
    if (r.taskId) {
      return {
        kind: 'job',
        provider: this.name,
        jobId: r.taskId,
        path: r.path,
        durationSec: opts.durationSec,
        raw: r,
      };
    }
    if (r.path) {
      return {
        kind: 'video',
        provider: this.name,
        path: r.path,
        durationSec: opts.durationSec,
        raw: r,
      };
    }
    throw new ProviderParseError(
      this.name,
      'mmx video result had no taskId or path',
      JSON.stringify(r).slice(0, 500),
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Re-map mmx-client's MmxError hierarchy into the unified
 * ProviderError hierarchy. MmxSpawnError → ProviderUnavailableError,
 * MmxQuotaError → ProviderRejectedError, anything else → ProviderExecError.
 */
function remapMmxError(e: unknown, provider: string): ProviderError {
  if (e instanceof MmxSpawnError) {
    return new ProviderUnavailableError(provider, process.env.MMX_BIN ?? 'mmx', e);
  }
  if (e instanceof MmxError) {
    return new ProviderError(String(e.code), e.message, provider, e.hint, e);
  }
  if (e instanceof Error) {
    return new ProviderError('UNKNOWN', e.message, provider, undefined, e);
  }
  return new ProviderError('UNKNOWN', String(e), provider);
}

/**
 * Best-effort: download a URL to a temp file and return the path,
 * so mmx can consume it as `--first-frame`. We don't fail loud
 * here — the caller's downloadToTmp failure surfaces as a regular
 * generateVideo rejection.
 */
async function downloadToTmp(url: string): Promise<string> {
  // Avoid pulling in node:fs/url at the top level so this module
  // stays importable in environments that don't have those. The
  // require is local so bundlers tree-shake it in the browser.
  const os = require('node:os') as typeof import('node:os');
  const path = require('node:path') as typeof import('node:path');
  const fs = require('node:fs/promises') as typeof import('node:fs/promises');

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mmx-'));
  const filename = path.join(dir, 'first-frame');
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`downloadToTmp: HTTP ${res.status} for ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(filename, buf);
  return filename;
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const mmxAdapter: ProviderAdapter = new MmxCliAdapter();
