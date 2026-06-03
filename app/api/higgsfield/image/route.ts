/**
 * POST /api/higgsfield/image
 *
 * Server-side MCP wrapper for Higgsfield image generation. Pulls the
 * user's OAuth access token (from IDB), refreshes it if expiring
 * soon, calls the `higgsfield_generate` MCP tool with the requested
 * model + prompt, and returns either a direct imageUrl (sync) or a
 * requestId to poll (async).
 *
 * Request shape:
 *   {
 *     prompt: string,                   // required, 1-2000 chars
 *     model?: string,                   // default: nano_banana_2
 *     aspectRatio?: string,             // e.g. '9:16', '1:1'
 *     resolution?: '1k' | '2k' | '4k',  // image models that take resolution
 *     quality?: 'low' | 'medium' | 'high',  // gpt_image_2 etc.
 *     soulId?: string,                  // for soul_v2 model
 *     seed?: number,                    // for reproducibility
 *     referenceImageUrl?: string,       // for img2img / character ref
 *   }
 *
 * Response (success, sync):
 *   { completed: true, imageUrl: string, requestId?: string, model: string }
 *
 * Response (async, needs polling):
 *   { completed: false, requestId: string, model: string }
 *
 * Errors return { error: string } with a 4xx/5xx status. Specific
 * status codes:
 *   401 → not connected (caller should redirect to /api/higgsfield/oauth/authorize)
 *   402 → user out of credits (forwarded from MCP server)
 *   429 → rate limited
 *   502 → MCP server error / network
 */

import { NextResponse } from 'next/server';
import { readDesktopConfigValue } from '@/lib/desktop-env';
import { getErrorMessage } from '@/lib/errors';
import { callHiggsfieldTool, getValidAccessToken } from '@/lib/higgsfield/mcp-client';
import {
  HIGGSFIELD_DEFAULT_IMAGE_MODEL,
  getHiggsfieldImageModel,
  type HiggsfieldImageModelSlug,
} from '@/lib/higgsfield/models';

export const runtime = 'nodejs';

interface RequestBody {
  prompt?: unknown;
  model?: unknown;
  aspectRatio?: unknown;
  resolution?: unknown;
  quality?: unknown;
  soulId?: unknown;
  seed?: unknown;
  referenceImageUrl?: unknown;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

function asInt(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string' && /^\d+$/.test(v)) return parseInt(v, 10);
  return undefined;
}

export async function POST(req: Request): Promise<Response> {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const prompt = asString(body.prompt);
  if (!prompt) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
  }
  if (prompt.length > 2000) {
    return NextResponse.json(
      { error: 'prompt exceeds 2000 characters' },
      { status: 400 },
    );
  }

  const modelSlug = (asString(body.model) || HIGGSFIELD_DEFAULT_IMAGE_MODEL) as HiggsfieldImageModelSlug;
  const modelMeta = getHiggsfieldImageModel(modelSlug);
  if (!modelMeta) {
    return NextResponse.json(
      { error: `Unknown Higgsfield image model: ${modelSlug}. Known: ${HIGGSFIELD_DEFAULT_IMAGE_MODEL} and others in lib/higgsfield/models.ts.` },
      { status: 400 },
    );
  }

  // Validate aspect ratio against the model's allow-list. The MCP
  // server will reject invalid ratios with a 400, but failing fast
  // here gives the user a clearer error.
  const aspectRatio = asString(body.aspectRatio);
  if (aspectRatio && modelMeta.aspectRatios.length > 0 && !modelMeta.aspectRatios.includes(aspectRatio)) {
    return NextResponse.json(
      {
        error: `Model ${modelSlug} doesn't support aspect ratio ${aspectRatio}. Supported: ${modelMeta.aspectRatios.join(', ')}`,
      },
      { status: 400 },
    );
  }
  const resolution = asString(body.resolution);
  if (resolution && modelMeta.resolutions && !modelMeta.resolutions.includes(resolution)) {
    return NextResponse.json(
      {
        error: `Model ${modelSlug} doesn't support resolution ${resolution}. Supported: ${modelMeta.resolutions.join(', ')}`,
      },
      { status: 400 },
    );
  }

  // Auth: require a connected account.
  const clientId = readDesktopConfigValue('HIGGSFIELD_OAUTH_CLIENT_ID');
  if (!clientId) {
    return NextResponse.json(
      { error: 'Higgsfield not configured. Visit Settings → AI Engine to connect your Higgsfield account.' },
      { status: 401 },
    );
  }
  const auth = await getValidAccessToken({ clientId });
  if (!auth) {
    return NextResponse.json(
      { error: 'Higgsfield account not connected. Click "Connect Higgsfield" in Settings → AI Engine.' },
      { status: 401 },
    );
  }

  // Compose the MCP `higgsfield_generate` arguments. The tool takes a
  // `model` field plus the model's specific parameters; we forward
  // aspect_ratio, resolution, quality, soul_id, seed, and a single
  // reference image. The MCP tool's exact field names match the
  // underlying REST API (modeled on the official SDK).
  const toolArgs: Record<string, unknown> = {
    model: modelSlug,
    prompt,
  };
  if (aspectRatio) toolArgs.aspect_ratio = aspectRatio;
  if (resolution) toolArgs.resolution = resolution;
  const quality = asString(body.quality);
  if (quality && (quality === 'low' || quality === 'medium' || quality === 'high')) {
    toolArgs.quality = quality;
  }
  const soulId = asString(body.soulId);
  if (soulId) toolArgs.soul_id = soulId;
  const seed = asInt(body.seed);
  if (seed !== undefined) toolArgs.seed = seed;
  const referenceImageUrl = asString(body.referenceImageUrl);
  if (referenceImageUrl) {
    toolArgs.input_images = [{ type: 'image_url', image_url: referenceImageUrl }];
  }

  try {
    const result = await callHiggsfieldTool({
      clientId,
      accessToken: auth.accessToken,
      tool: 'higgsfield_generate',
      arguments: toolArgs,
    });

    if (result.blocked) {
      return NextResponse.json(
        { error: result.error || 'Higgsfield blocked the prompt (content moderation).' },
        { status: 422 },
      );
    }
    if (result.completed && result.imageUrl) {
      return NextResponse.json({
        completed: true,
        imageUrl: result.imageUrl,
        requestId: result.requestId,
        model: modelSlug,
        enhancedPrompt: prompt,
      });
    }
    if (result.requestId) {
      return NextResponse.json({
        completed: false,
        requestId: result.requestId,
        model: modelSlug,
      });
    }
    return NextResponse.json(
      { error: result.error || 'Higgsfield returned no result. Try again or pick a different model.' },
      { status: 502 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: `Higgsfield image call failed: ${getErrorMessage(e)}` },
      { status: 502 },
    );
  }
}
