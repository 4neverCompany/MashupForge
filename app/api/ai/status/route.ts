// LLM-INTEGRATION-0513: status probe for the vercel-ai provider.
//
// GET → JSON { available, provider, model, authenticated }
//
// Mirrors the shape of /api/nca/status so the SettingsModal can render
// a "vercel-ai" card with the same dot/label/model conventions. There
// is no install state — direct HTTPS API calls work as long as the env
// var is set, so `available` and `authenticated` collapse to the same
// signal: MINIMAX_API_KEY (preferred) or OPENAI_API_KEY is present on
// the server.
//
// 0513-CONSOLIDATION: v1.0 chain was MiniMax → OpenAI → Anthropic →
// OpenRouter. The v1.0.1 trim keeps only MiniMax and OpenAI.
//
// The picked provider's default model is reported so the UI can show
// e.g. "gpt-4o-mini" without hitting the underlying API.

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

interface AiStatus {
  available: boolean;
  authenticated: boolean;
  // 0513-CONSOLIDATION: chain trimmed to {minimax, openai}. See module
  // header for rationale.
  provider: 'minimax' | 'openai' | null;
  model: string | null;
}

// Detection priority MUST mirror resolveProvider() in
// app/api/ai/prompt/route.ts — the status badge must agree with the
// provider that will actually serve the next request.
function detect(): AiStatus {
  const envModel = process.env.VERCEL_AI_MODEL?.trim() || undefined;
  if (process.env.MINIMAX_API_KEY) {
    return {
      available: true,
      authenticated: true,
      provider: 'minimax',
      model: envModel || 'MiniMax-M2.5',
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      available: true,
      authenticated: true,
      provider: 'openai',
      model: envModel || 'gpt-4o-mini',
    };
  }
  return { available: false, authenticated: false, provider: null, model: null };
}

export async function GET(): Promise<Response> {
  return NextResponse.json(detect());
}
