// LLM-INTEGRATION-0513: status probe for the vercel-ai provider.
//
// GET → JSON { available, provider, model, authenticated }
//
// Mirrors the shape of /api/nca/status so the SettingsModal can render
// a "vercel-ai" card with the same dot/label/model conventions. There
// is no install state — direct HTTPS API calls work as long as the env
// var is set, so `available` and `authenticated` collapse to the same
// signal: at least one of OPENAI_API_KEY, ANTHROPIC_API_KEY, or
// OPENROUTER_API_KEY is present on the server.
//
// The picked provider's default model is reported so the UI can show
// e.g. "openai/gpt-4o-mini" without hitting the underlying API.

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

interface AiStatus {
  available: boolean;
  authenticated: boolean;
  provider: 'openai' | 'anthropic' | 'openrouter' | null;
  model: string | null;
}

function detect(): AiStatus {
  const envModel = process.env.VERCEL_AI_MODEL?.trim() || undefined;
  if (process.env.OPENAI_API_KEY) {
    return {
      available: true,
      authenticated: true,
      provider: 'openai',
      model: envModel || 'gpt-4o-mini',
    };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      available: true,
      authenticated: true,
      provider: 'anthropic',
      model: envModel || 'claude-3-haiku-20240307',
    };
  }
  if (process.env.OPENROUTER_API_KEY) {
    return {
      available: true,
      authenticated: true,
      provider: 'openrouter',
      model: envModel || 'openai/gpt-4o-mini',
    };
  }
  return { available: false, authenticated: false, provider: null, model: null };
}

export async function GET(): Promise<Response> {
  return NextResponse.json(detect());
}
