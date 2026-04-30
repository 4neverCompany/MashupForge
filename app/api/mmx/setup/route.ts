import { NextResponse } from 'next/server';
import { isAvailable } from '@/lib/mmx-client';
import { getErrorMessage } from '@/lib/errors';
import { isServerless } from '@/lib/runtime-env';
import { spawn, spawnSync } from 'node:child_process';
import { platform } from 'node:os';
import { delimiter as PATH_DELIMITER } from 'node:path';
import { existsSync } from 'node:fs';

export const runtime = 'nodejs';

interface InstallResult {
  ok: boolean;
  stdout?: string;
  stderr?: string;
  globalBin?: string;
}

/**
 * Run `npm install -g mmx-cli` synchronously and return the npm global bin
 * directory so the caller can prepend it to PATH for the live process.
 *
 * We resolve npm via PATH first (`npm`); on non-Windows, if that fails with
 * ENOENT we fall back to the homebrew/linuxbrew path. On Windows, npm is
 * `npm.cmd`, which `spawnSync` only resolves correctly when `shell: true`.
 *
 * Bounded at 5 minutes — npm fetching mmx-cli + transitive deps over a slow
 * link can be slow, but should never legitimately exceed that. The caller
 * is the Next.js route handler, which the user is staring at, so we'd
 * rather time out cleanly than hang.
 */
function installMmxCli(): InstallResult {
  const isWin = platform() === 'win32';
  // npm-on-PATH first; then common managed-install locations users hit when
  // PATH is not set up (Tauri/Electron sometimes inherit a sparse env on
  // macOS GUI launches, and Linuxbrew dot-files only kick in for login shells).
  // Order: Apple-silicon Homebrew → Intel-mac Homebrew + most Linux distros →
  // Linuxbrew. First match wins via the ENOENT-fallback loop below.
  const candidates: string[] = ['npm'];
  if (!isWin) {
    candidates.push(
      '/opt/homebrew/bin/npm',
      '/usr/local/bin/npm',
      '/home/linuxbrew/.linuxbrew/bin/npm',
    );
  }

  const installArgs = ['install', '-g', '--no-fund', '--no-audit', 'mmx-cli'];
  let lastResult: ReturnType<typeof spawnSync> | undefined;
  let usedNpm: string | undefined;

  for (const npmBin of candidates) {
    const result = spawnSync(npmBin, installArgs, {
      encoding: 'utf8',
      timeout: 5 * 60 * 1000,
      shell: isWin, // npm is npm.cmd on Windows
    });
    lastResult = result;
    // ENOENT (no such binary) surfaces as `error.code === 'ENOENT'` — try next.
    const err = result.error as NodeJS.ErrnoException | undefined;
    if (err && err.code === 'ENOENT') continue;
    usedNpm = npmBin;
    break;
  }

  if (!lastResult || (lastResult.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
    return {
      ok: false,
      stderr:
        'Could not find `npm`. Install Node.js (which ships with npm), make sure it is on PATH, then click "Set up MMX" again.',
    };
  }
  if (lastResult.status !== 0) {
    return {
      ok: false,
      stdout: lastResult.stdout?.toString() ?? '',
      stderr: lastResult.stderr?.toString() ?? `npm exited with status ${lastResult.status}.`,
    };
  }

  // Resolve npm global prefix → bin dir, so we can prepend to PATH and verify.
  // `npm prefix -g` is stable across npm 6+ (unlike `npm bin -g`, which was
  // removed in npm 9). bin dir = prefix on Windows, prefix/bin elsewhere.
  let globalBin: string | undefined;
  const prefixResult = spawnSync(usedNpm ?? 'npm', ['prefix', '-g'], {
    encoding: 'utf8',
    timeout: 10_000,
    shell: isWin,
  });
  if (prefixResult.status === 0) {
    const prefix = prefixResult.stdout?.toString().trim();
    if (prefix) globalBin = isWin ? prefix : `${prefix}/bin`;
  }

  return {
    ok: true,
    stdout: lastResult.stdout?.toString() ?? '',
    stderr: lastResult.stderr?.toString() ?? '',
    globalBin,
  };
}

/**
 * POST /api/mmx/setup
 *
 * Two flows:
 *
 * 1. **Non-interactive** — body contains `{ apiKey: "sk-..." }`. The route
 *    auto-installs mmx-cli if missing, then runs
 *    `mmx auth login --method api-key --api-key <key>`, which writes the
 *    credential into the user's local mmx config. No terminal opens.
 *    This is the canonical path documented at
 *    https://platform.minimax.io/docs/token-plan/minimax-cli — it is the
 *    fastest setup for users who already have an API key in hand.
 *
 * 2. **Interactive** — empty body. The route auto-installs if missing,
 *    then spawns a tmux session (POSIX) or new cmd window (Windows)
 *    that runs the OAuth/device-code flow followed by an interactive
 *    shell, so users without an API key can authenticate via OAuth and
 *    configure provider/model afterwards.
 *
 * Desktop-only: this route spawns subprocesses and is incompatible with
 * serverless runtimes. If we detect a serverless environment we
 * short-circuit with 503 so the caller sees a clear error instead of a
 * raw shell failure.
 */

export async function POST(req: Request) {
  if (isServerless()) {
    return NextResponse.json(
      {
        success: false,
        error:
          'MMX setup is desktop-only. This feature requires local subprocess execution — it cannot run on serverless platforms. Use the Tauri desktop build instead.',
      },
      { status: 503 },
    );
  }

  // Optional non-interactive flow. JSON-parse errors fall through to the
  // interactive flow below — empty body / invalid JSON is fine, just no key.
  let apiKey: string | null = null;
  try {
    const body = (await req.json()) as { apiKey?: unknown };
    if (typeof body?.apiKey === 'string' && body.apiKey.trim()) {
      apiKey = body.apiKey.trim();
    }
  } catch {
    // No body / non-JSON body — interactive flow.
  }

  let available = await isAvailable();
  if (!available) {
    // Auto-install: the user clicked "Set up MMX" without mmx-cli on PATH,
    // so install it for them via npm and re-check.
    //
    // Why prepend npm's global bin to PATH after install: lib/mmx-client
    // captures `MMX_BIN = process.env.MMX_BIN ?? 'mmx'` at module-load time,
    // so mutating MMX_BIN here is a no-op. spawn('mmx', …) instead does a
    // live PATH lookup at call time, so updating process.env.PATH lets the
    // existing isAvailable() find the just-installed binary without any
    // changes to mmx-client.ts.
    const install = installMmxCli();
    if (!install.ok) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Failed to install mmx-cli automatically. Run `npm install -g mmx-cli` in a terminal and try again.\n\n' +
            (install.stderr || install.stdout || 'No output from npm.'),
        },
        { status: 500 },
      );
    }
    if (install.globalBin) {
      // BUGFIX 2026-04-30: previously hard-coded `:` as the PATH separator,
      // which corrupts PATH on Windows (separator is `;`). The split/join
      // were both wrong, so a Windows install would silently break PATH and
      // the follow-up isAvailable() probe would fail with "tried PATH and
      // C:\Users\…\npm". Use node:path.delimiter for the OS-correct char.
      const existing = process.env.PATH ?? '';
      const segments = existing.split(PATH_DELIMITER);
      if (!segments.includes(install.globalBin)) {
        process.env.PATH = `${install.globalBin}${PATH_DELIMITER}${existing}`;
      }

      // Belt-and-suspenders for Windows: spawn() without shell:true cannot
      // resolve npm shims (mmx.cmd / mmx.ps1), so even a corrected PATH
      // wouldn't help lib/mmx-client.ts find the binary. Set MMX_BIN to the
      // absolute path of the .cmd shim so spawn() invokes it directly.
      // mmx-client reads process.env.MMX_BIN dynamically (per the matching
      // bugfix in lib/mmx-client.ts on the same date), so this propagates
      // to subsequent isAvailable() calls in the same process.
      if (platform() === 'win32') {
        const cmdShim = `${install.globalBin}\\mmx.cmd`;
        if (existsSync(cmdShim)) {
          process.env.MMX_BIN = cmdShim;
        }
      }
    }
    available = await isAvailable();
    if (!available) {
      return NextResponse.json(
        {
          success: false,
          error:
            `npm install -g mmx-cli reported success but mmx is still not runnable. Tried PATH and ${install.globalBin || '(unknown global bin)'}.\n\n` +
            (install.stdout || install.stderr || 'No output from npm.'),
        },
        { status: 500 },
      );
    }
  }

  // Non-interactive auth path: caller supplied an API key, so write it into
  // mmx's local config via `mmx auth login --method api-key --api-key <key>`.
  // `mmx auth status` afterwards confirms the credential was accepted.
  if (apiKey) {
    const authResult = spawnSync(
      'mmx',
      ['auth', 'login', '--method', 'api-key', '--api-key', apiKey],
      { encoding: 'utf8', timeout: 30_000 },
    );

    // Redact the API key from anything we echo back to the client. mmx
    // generally doesn't include the key in its own output, but defence in
    // depth — the route's response is also written to browser console / dev
    // logs, and we never want the secret to land there.
    const redact = (s: string | undefined): string => {
      if (!s) return '';
      return s.replace(apiKey, '<api-key-redacted>').trim();
    };

    if ((authResult.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
      return NextResponse.json(
        { success: false, error: 'mmx not found on PATH after install. Try `which mmx` and `npm prefix -g`.' },
        { status: 500 },
      );
    }
    if (authResult.status !== 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            `mmx auth login --api-key failed (exit ${authResult.status}).\n\n` +
            (redact(authResult.stderr) || redact(authResult.stdout) || 'No output from mmx.'),
        },
        { status: 500 },
      );
    }

    // Verify with `mmx auth status` so we don't claim success on a no-op.
    const statusResult = spawnSync('mmx', ['auth', 'status'], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    if (statusResult.status !== 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            `API key accepted but mmx auth status reports unauthenticated (exit ${statusResult.status}). The key may be invalid or expired.\n\n` +
            (redact(statusResult.stderr) || redact(statusResult.stdout) || ''),
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      message:
        'MMX authenticated with API key. You can now select MMX as the active agent. To pick a provider/model, click "Open MMX CLI" and run `mmx config set provider <name>` / `mmx config set model <name>`.',
      method: 'api-key',
    });
  }

  try {
    if (platform() === 'win32') {
      // Windows: pop a native console window running `mmx auth login`.
      // `start "Title" cmd /k ...` opens a new cmd window; detached + shell
      // because `start` is a cmd builtin, not an executable.
      spawn(
        `start "MashupForge — MiniMax mmx Sign In" cmd /k "mmx auth login"`,
        { shell: true, detached: true, stdio: 'ignore' },
      ).unref();

      return NextResponse.json({
        success: true,
        message: 'A new terminal window opened running `mmx auth login`. Follow the OAuth prompts to sign in.',
        platform: 'win32',
      });
    }

    // POSIX desktop: use tmux so the setup session is persistent and visible.
    // The session does three things in order:
    //   1. Skip auth if the user is already authenticated (`mmx auth status`),
    //      otherwise run `mmx auth login --no-browser`.
    //   2. Print a help banner pointing at config commands.
    //   3. Drop into an interactive bash shell so the user can run `mmx config
    //      set provider …`, `mmx config set model …`, `mmx --help`, etc.
    //      without leaving the session.
    //
    // Idempotency: if the session already exists, return `alreadyRunning`
    // instead of killing it. Belt-and-suspenders alongside the mmxBusyRef
    // double-click guard in the UI — the route is also callable via
    // curl/scripts, so the server must protect itself.
    const hasSession = spawnSync('tmux', ['has-session', '-t', 'mmx-setup'], {
      stdio: 'ignore',
    });
    if (hasSession.status === 0) {
      return NextResponse.json({
        success: true,
        message:
          'An MMX setup session is already running.\n\nAttach to it with:\n  tmux attach -t mmx-setup\n\nIf you need to start fresh, close that tmux session first:\n  tmux kill-session -t mmx-setup',
        tmuxSession: 'mmx-setup',
        platform: 'posix',
        alreadyRunning: true,
      });
    }
    spawnSync('tmux', ['kill-session', '-t', 'mmx-setup'], { stdio: 'ignore' });

    // Inline bash script: run the auth flow only if needed, print a banner,
    // then exec an interactive shell. Single-quoted to avoid shell expansion
    // happening in this Node string before tmux passes it to bash.
    const setupScript = [
      'if mmx auth status >/dev/null 2>&1; then',
      '  echo "MMX is already authenticated."',
      'else',
      '  mmx auth login --no-browser || true',
      'fi',
      'echo',
      'echo "─── MMX CLI ready ────────────────────────────────────────────"',
      'echo "Configure provider, model, or other settings:"',
      'echo "  mmx config show               # show current config"',
      'echo "  mmx config set <key> <value>  # set a config value"',
      'echo "  mmx --help                    # all commands"',
      'echo "──────────────────────────────────────────────────────────────"',
      'exec bash -i',
    ].join('\n');

    const tmuxResult = spawnSync(
      'tmux',
      ['new-session', '-d', '-s', 'mmx-setup', '-x', '120', '-y', '30', 'bash', '-c', setupScript],
      { encoding: 'utf8' },
    );
    if (tmuxResult.status !== 0) {
      throw new Error(
        `tmux new-session failed (exit ${tmuxResult.status}): ${tmuxResult.stderr?.trim() || 'unknown error'}`,
      );
    }

    return NextResponse.json({
      success: true,
      message:
        'MMX CLI opened in tmux session "mmx-setup". Attach with:\n  tmux attach -t mmx-setup\n\nIf not yet authenticated, follow the OAuth/device-code prompts. Once in the shell, run `mmx config set provider <name>` and `mmx config set model <name>` to choose your provider and model. `mmx --help` lists every resource.',
      tmuxSession: 'mmx-setup',
      platform: 'posix',
    });
  } catch (e: unknown) {
    return NextResponse.json({ success: false, error: getErrorMessage(e) }, { status: 500 });
  }
}
