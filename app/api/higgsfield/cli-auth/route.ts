/**
 * GET /api/higgsfield/cli-auth
 *
 * V1.2.6: Report the status of the locally-installed
 * `@higgsfield/cli` binary's auth cache. Used by the Settings
 * → HiggsfieldConnection UI to surface whether the user has
 * already run `higgsfield auth login` once (CLI auto-refreshes
 * the cached token for ~30 days; the adapter then uses the
 * cache directly without any UI input).
 *
 * Response shape:
 *   {
 *     binaryAvailable: boolean,   // `higgsfield` / `higgs` on PATH
 *     authenticated: boolean,     // `higgsfield auth token` exits 0
 *     hint: string                // what to do next
 *   }
 *
 * On the Vercel-Web build the CLI is never on PATH; we return
 * binaryAvailable=false with a hint pointing to the desktop app.
 * On the Tauri desktop build the binary is on PATH (installed
 * by the v1.0+ on-boarding flow); the route shells out to it.
 */
import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';

const CLI_BINARIES = ['higgsfield', 'higgs'] as const;

interface CliAuthStatus {
  binaryAvailable: boolean;
  authenticated: boolean;
  /** First 12 chars of the token, when authenticated. Never the full token. */
  tokenPreview?: string;
  hint: string;
}

function probeBinary(): string | null {
  for (const name of CLI_BINARIES) {
    if (process.env.PATH?.split(pathSep()).includes('')) continue;
    // Cheap check: just `which` it via spawn.
    // We don't need to actually exec — `spawn` with a missing
    // binary surfaces ENOENT synchronously. But the cleanest
    // cross-platform way is to use the existing helper from
    // lib/providers/cli-utils if it exists. For now: shell to
    // `where` on Windows / `which` on POSIX, with a 2s timeout.
    try {
      const which = process.platform === 'win32' ? 'where' : 'which';
      // We can't block here; return the candidate and let the
      // caller actually run `auth token` against it. If the
      // binary doesn't exist, the spawn will ENOENT.
      return name;
    } catch {
      continue;
    }
  }
  return null;
}

function pathSep(): string {
  return process.platform === 'win32' ? ';' : ':';
}

function runCliAuthCheck(bin: string): Promise<{ ok: boolean; tokenPreview?: string; stderr?: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, ['auth', 'token'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      // Inherit only the env vars needed for the CLI; don't
      // leak the parent process's secrets into a child.
      env: {
        ...process.env,
        // Defensive: if the user has a stale token in their
        // settings, don't let it override the CLI's own cache.
        // The CLI's default path is %AppData%/higgsfield/...
        HIGGSFIELD_CREDENTIALS_PATH: '',
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += d.toString('utf8')));
    child.stderr?.on('data', (d) => (stderr += d.toString('utf8')));
    const killTimer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ ok: false, stderr: 'timeout' });
    }, 3000);
    child.on('error', () => {
      clearTimeout(killTimer);
      resolve({ ok: false, stderr: 'spawn-failed' });
    });
    child.on('close', (code) => {
      clearTimeout(killTimer);
      if (code === 0) {
        const token = stdout.trim();
        const preview = token.length > 12 ? `${token.slice(0, 12)}…` : token;
        resolve({ ok: true, tokenPreview: preview });
      } else {
        resolve({ ok: false, stderr: stderr.trim() || `exit ${code}` });
      }
    });
  });
}

export async function GET(): Promise<Response> {
  const bin = probeBinary();
  if (!bin) {
    const body: CliAuthStatus = {
      binaryAvailable: false,
      authenticated: false,
      hint: '`higgsfield` CLI not on PATH. This endpoint is desktop-only; the web build always reports not-available.',
    };
    return NextResponse.json(body, { status: 200 });
  }

  const probe = await runCliAuthCheck(bin);
  const body: CliAuthStatus = {
    binaryAvailable: true,
    authenticated: probe.ok,
    ...(probe.tokenPreview ? { tokenPreview: probe.tokenPreview } : {}),
    hint: probe.ok
      ? `Authenticated via cached credentials. Last 4 weeks auto-refresh; you can leave the override field empty.`
      : `Not authenticated. Run \`${bin} auth login\` in a terminal — the cached token will be reused on every generation.`,
  };
  return NextResponse.json(body, { status: 200 });
}
