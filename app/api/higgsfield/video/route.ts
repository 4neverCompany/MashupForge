/**
 * POST /api/higgsfield/video
 *
 * Server-side MCP wrapper for Higgsfield video generation. Same
 * shape as /api/higgsfield/image, but the default model is
 * Seedance 2.0 (the "Hollywood film" default) and we forward
 * video-specific parameters (duration, mode, genre, start/end
 * frames, audio).
 *
 * Request shape:
 *   {
 *     prompt: string,                          // required
 *     model?: string,                          // default: seedance_2_0
 *     aspectRatio?: string,                    // 9:16 / 16:9 / etc.
 *     duration?: number,                       // seconds (model-specific)
 *     resolution?: '480p' | '720p' | '1080p',
 *     mode?: 'std' | 'fast' | 'pro',           // model-specific
 *     genre?: 'auto' | 'action' | 'horror' | 'comedy' | 'noir' | 'drama' | 'epic',
 *     startImageUrl?: string,                  // i2v first frame
 *     endImageUrl?: string,                    // i2v last frame
 *     sound?: 'on' | 'off' | boolean,          // Kling v3 etc.
 *   }
 *
 * Response: same as /api/higgsfield/image, with `videoUrl` instead
 * of `imageUrl`.
 */

import { NextResponse } from 'next/server';
import { readDesktopConfigValue } from '@/lib/desktop-env';
import { getErrorMessage } from '@/lib/errors';
import { callHiggsfieldTool, getValidAccessToken } from '@/lib/higgsfield/mcp-client';
import {
  HIGGSFIELD_DEFAULT_VIDEO_MODEL,
  getHiggsfieldVideoModel,
  type HiggsfieldVideoModelSlug,
} from '@/lib/higgsfield/models';

export const runtime = 'nodejs';

interface RequestBody {
  prompt?: unknown;
  model?: unknown;
  aspectRatio?: unknown;
  duration?: unknown;
  resolution?: unknown;
  mode?: unknown;
  genre?: unknown;
  startImageUrl?: unknown;
  endImageUrl?: unknown;
  sound?: unknown;
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
  if (prompt.length > 4000) {
    return NextResponse.json(
      { error: 'video prompt exceeds 4000 characters' },
      { status: 400 },
    );
  }

  const modelSlug = (asString(body.model) || HIGGSFIELD_DEFAULT_VIDEO_MODEL) as HiggsfieldVideoModelSlug;
  const modelMeta = getHiggsfieldVideoModel(modelSlug);
  if (!modelMeta) {
    return NextResponse.json(
      { error: `Unknown Higgsfield video model: ${modelSlug}` },
      { status: 400 },
    );
  }

  const aspectRatio = asString(body.aspectRatio);
  if (aspectRatio && modelMeta.aspectRatios.length > 0 && !modelMeta.aspectRatios.includes(aspectRatio)) {
    return NextResponse.json(
      {
        error: `Model ${modelSlug} doesn't support aspect ratio ${aspectRatio}. Supported: ${modelMeta.aspectRatios.join(', ')}`,
      },
      { status: 400 },
    );
  }

  const clientId = readDesktopConfigValue('HIGGSFIELD_OAUTH_CLIENT_ID');
  if (!clientId) {
    return NextResponse.json(
      { error: 'Higgsfield not configured. Visit Settings → AI Engine to connect.' },
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

  const toolArgs: Record<string, unknown> = {
    model: modelSlug,
    prompt,
  };
  if (aspectRatio) toolArgs.aspect_ratio = aspectRatio;
  const duration = asInt(body.duration);
  if (duration !== undefined) toolArgs.duration = duration;
  const resolution = asString(body.resolution);
  if (resolution && (resolution === '480p' || resolution === '720p' || resolution === '1080p')) {
    toolArgs.resolution = resolution;
  }
  const mode = asString(body.mode);
  if (mode && (mode === 'std' || mode === 'fast' || mode === 'pro')) {
    toolArgs.mode = mode;
  }
  const genre = asString(body.genre);
  if (genre) toolArgs.genre = genre;
  const startImageUrl = asString(body.startImageUrl);
  if (startImageUrl) {
    toolArgs.start_image = startImageUrl;
  }
  const endImageUrl = asString(body.endImageUrl);
  if (endImageUrl) {
    toolArgs.end_image = endImageUrl;
  }
  const sound = body.sound;
  if (sound === 'on' || sound === 'off') {
    toolArgs.sound = sound;
  } else if (typeof sound === 'boolean') {
    toolArgs.sound = sound ? 'on' : 'off';
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
    if (result.completed && result.videoUrl) {
      return NextResponse.json({
        completed: true,
        videoUrl: result.videoUrl,
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
      { error: result.error || 'Higgsfield returned no result. Try a different model or prompt.' },
      { status: 502 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: `Higgsfield video call failed: ${getErrorMessage(e)}` },
      { status: 502 },
    );
  }
}
