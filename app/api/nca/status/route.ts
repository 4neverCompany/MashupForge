/**
 * GET /api/nca/status
 *
 * Detailed probe used by the AI Agent settings tab. Reports:
 *   - available:     nca binary callable (`nca doctor --json` exits 0)
 *   - authenticated: at least one provider's api-key env var is populated;
 *                    we trust nca's own `api_key_present` reading rather
 *                    than re-implementing it here so the answer stays
 *                    correct when nca adds providers
 *   - provider:      currently selected provider (e.g. "MiniMax")
 *   - model:         default model for that provider (e.g. "MiniMax-M2.5")
 *   - providers:     full list with per-provider availability flags so the
 *                    UI can render a multi-provider picker if it wants
 *
 * Replaces the chat half of /api/mmx/status. Same auth model — unauth'd,
 * intended for the single-user desktop deployment.
 */

import { NextResponse } from 'next/server';
import { getDoctor, isAuthenticated } from '@/lib/nca-client';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const doctor = await getDoctor();
  if (!doctor) {
    return NextResponse.json(
      {
        available: false,
        authenticated: false,
        provider: null,
        model: null,
        providers: [],
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.json(
    {
      available: true,
      authenticated: isAuthenticated(),
      provider: doctor.provider,
      model: doctor.default_model,
      providers: doctor.providers.map((p) => ({
        provider: p.provider,
        selected: p.selected,
        api_key_present: p.api_key_present,
        api_key_env: p.api_key_env,
        model: p.model,
      })),
      mcpServerCount: doctor.mcp_server_count,
      skillCount: doctor.skill_count,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
