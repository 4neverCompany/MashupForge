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
 */
import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const CLI_BINARIES = ['higgsfield', 'higgs'] as const;

function pathSep(): string {
  return process.platform === 'win32' ? ';' : ':';
}

/**
 * V1.3.8-CLI-PROBE: Node doesn't honour Windows PATHEXT the way
 * cmd/PowerShell do. `spawn('higgsfield', ...)` from Node fails
 * with ENOENT if the file on disk is `higgsfield.cmd` or
 * `higgsfield.ps1` (the shim wrappers that `npm i -g` produces).
 * We have to look at the PATH directories ourselves and check
 * for the .cmd / .ps1 / .exe variants — and on POSIX, accept
 * `higgsfield` directly.
 *
 * Returns the absolute path of the binary if found, null otherwise.
 */
function findBinary(name: string): string | null {
  const exts = process.platform === 'win32'
    ? ['.cmd', '.bat', '.ps1', '.exe', '']
    : [''];
  // V1.4.4: prefer the user's globally-installed @higgsfield/cli
  // (lives at %USERPROFILE%\AppData\Roaming\npm on Windows). The
  // local node_modules/.bin symlink that dev tools create is missing
  // the `hf.exe` vendor binary — every CLI call via the local copy
  // fails with "binary not found". Preferring the global install
  // avoids that for the user-facing desktop build.
  const preferred: string[] = [];
  if (process.platform === 'win32' && process.env.USERPROFILE) {
    preferred.push(join(process.env.USERPROFILE, 'AppData', 'Roaming', 'npm'))
  }
  for (const dir of preferred) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  const pathDirs = (process.env.PATH || '').split(pathSep()).filter(Boolean);
  for (const dir of pathDirs) {
    if (preferred.includes(dir)) continue;
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null
}

function runCliAuthCheck(bin: string): Promise<{ ok: boolean; tokenPreview?: string; stderr?: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, ['auth', 'token'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
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
  // V1.3.8-CLI-PROBE: find the actual binary on PATH (with
  // .cmd/.ps1/.exe extensions on Windows). Old code returned
  // the bare name, which then made `spawn('higgsfield', ...)`
  // fail with ENOENT because Node doesn't resolve PATHEXT.
  const bin = (['higgsfield', 'higgs'] as const)
    .map((n) => findBinary(n))
    .find((p): p is string => p !== null);
  if (!bin) {
    return NextResponse.json({
      binaryAvailable: false,
      authenticated: false,
      hint: '`higgsfield` CLI not on PATH. Install with `npm i -g @higgsfield/cli` and re-launch.',
    });
  }
  const check = await runCliAuthCheck(bin);
  if (check.ok) {
    return NextResponse.json({
      binaryAvailable: true,
      authenticated: true,
      tokenPreview: check.tokenPreview,
      hint: `Authenticated via cached credentials (${bin}).`,
    });
  }
  return NextResponse.json({
    binaryAvailable: true,
    authenticated: false,
    hint: `CLI found at ${bin}, but not authenticated. Run \`higgsfield auth login\` in a terminal.${check.stderr ? ` (${check.stderr})` : ''}`,
  });
}
