/**
 * POST /api/nca/setup
 *
 * Two flows:
 *
 * 1. **Non-interactive** — body contains `{ apiKey: "..." }` (and
 *    optionally `{ model: "MiniMax-M2.7" }`). The route:
 *      - persists the value(s) to the desktop config.json via the same
 *        path /api/desktop/config PATCH uses (also injecting into
 *        process.env so the running server picks them up immediately);
 *      - runs `nca doctor --json` to verify the key was accepted
 *        (`api_key_present: true` for the selected provider).
 *
 * 2. **Probe-only** — empty body. The route just runs `nca doctor` and
 *    reports the current install state. No writes. Useful for the UI
 *    to refresh status after a manual env change.
 *
 * Why no auto-install: nca is shipped as a Rust binary, not an npm
 * package. There is no equivalent of `npm install -g mmx-cli` we can
 * run on demand — the binary either exists at `/usr/local/bin/nca`
 * (or wherever NCA_BIN points) or it doesn't. If absent we surface a
 * 503 with installation instructions and let the user / installer
 * handle it.
 *
 * Desktop-only: this route writes to a local config file. Returns 503
 * on serverless runtimes (Vercel, Lambda, …) so the caller sees a
 * clean error instead of a silent EROFS write.
 */

import { NextResponse } from 'next/server';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { getDesktopConfigPath } from '@/lib/desktop-env';
import { getDoctor, isAuthenticated } from '@/lib/nca-client';
import { isServerless } from '@/lib/runtime-env';
import { getErrorMessage } from '@/lib/errors';
import { DESKTOP_CONFIG_KEYS } from '@/lib/desktop-config-keys';

export const runtime = 'nodejs';

// Allow-list for the setup-driven config write. We accept only nca-related
// keys here (rather than reusing the full DESKTOP_CONFIG_KEYS) so a
// well-meaning UI bug can't smuggle Twitter/Instagram keys through this
// endpoint. The intersection-with-allow-list logic mirrors
// /api/desktop/config PATCH for consistency.
const NCA_SETUP_KEYS = new Set<string>(['MINIMAX_API_KEY', 'NCA_MODEL']);

interface SetupBody {
  apiKey?: unknown;
  model?: unknown;
}

export async function POST(req: Request) {
  if (isServerless()) {
    return NextResponse.json(
      {
        success: false,
        error:
          'nca setup is desktop-only. The route writes to a local config.json — it cannot run on serverless platforms. Use the Tauri desktop build instead.',
      },
      { status: 503 },
    );
  }

  // Parse body. Empty / non-JSON falls through to probe-only mode.
  let body: SetupBody = {};
  try {
    body = ((await req.json()) ?? {}) as SetupBody;
  } catch {
    // probe-only
  }

  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const model = typeof body.model === 'string' ? body.model.trim() : '';

  // Persist write — only when caller actually supplied a value. Empty
  // strings are intentionally a no-op rather than a delete (use the
  // /api/desktop/config endpoint directly to delete).
  if (apiKey || model) {
    const updates: Record<string, string> = {};
    if (apiKey) updates.MINIMAX_API_KEY = apiKey;
    if (model) updates.NCA_MODEL = model;

    const allowedSet = new Set(DESKTOP_CONFIG_KEYS.map(({ key }) => key));
    for (const k of Object.keys(updates)) {
      if (!NCA_SETUP_KEYS.has(k) || !allowedSet.has(k)) {
        return NextResponse.json(
          { success: false, error: `key not allowed: ${k}` },
          { status: 400 },
        );
      }
    }

    const configPath = getDesktopConfigPath();
    let existing: Record<string, string> = {};
    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, 'utf8');
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof v === 'string') existing[k] = v;
          }
        }
      } catch {
        // Corrupt config — treat as empty; we'll overwrite below.
      }
    }

    for (const [k, v] of Object.entries(updates)) {
      existing[k] = v;
      // Inject so the verify step below + any downstream nca calls in this
      // process see the new key without waiting for a server restart.
      process.env[k] = v;
    }

    try {
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, JSON.stringify(existing, null, 2) + '\n', {
        encoding: 'utf8',
        // 0o600: owner read/write only — config.json holds API keys.
        mode: 0o600,
      });
    } catch (e: unknown) {
      return NextResponse.json(
        { success: false, error: `failed to write config.json: ${getErrorMessage(e)}` },
        { status: 500 },
      );
    }
  }

  // Verify with nca doctor. If apiKey was provided, we expect doctor to
  // report api_key_present:true for the selected provider after the
  // process.env.MINIMAX_API_KEY mutation above. If apiKey was empty
  // (probe-only), we just report whatever doctor sees today.
  const doctor = await getDoctor();
  if (!doctor) {
    return NextResponse.json(
      {
        success: false,
        error:
          'nca binary not callable. Ensure /usr/local/bin/nca exists (or set NCA_BIN to its path). See https://github.com/madebyaris/native-cli-ai for install instructions.',
      },
      { status: 503 },
    );
  }

  const selected = doctor.providers.find((p) => p.selected);
  const authed = isAuthenticated();

  // If the caller supplied a key but the selected provider doesn't see it,
  // surface a 500 — likely the provider doesn't read MINIMAX_API_KEY (e.g.
  // they switched the default to OpenAI somehow) or the env var didn't
  // propagate. Better to fail loud than to claim success on a no-op write.
  if (apiKey && selected && selected.api_key_env === 'MINIMAX_API_KEY' && !selected.api_key_present) {
    return NextResponse.json(
      {
        success: false,
        error:
          'API key was written but nca doctor does not see it. Check that nca is reading MINIMAX_API_KEY from the live process environment (you may need to restart the desktop app to pick up config.json on next launch).',
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    written: apiKey || model ? true : false,
    available: true,
    authenticated: authed,
    provider: doctor.provider,
    model: doctor.default_model,
    providers: doctor.providers.map((p) => ({
      provider: p.provider,
      selected: p.selected,
      api_key_present: p.api_key_present,
      api_key_env: p.api_key_env,
      model: p.model,
    })),
    message: apiKey
      ? 'MiniMax API key saved and verified. nca is ready to use.'
      : model
        ? `nca model preference saved (${model}).`
        : 'nca status refreshed.',
  });
}
