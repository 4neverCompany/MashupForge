/**
 * nca client — wraps Aris's `nca` (native-cli-ai) binary as the second AI
 * provider alongside pi. Replaces the chat half of `lib/mmx-client.ts` (the
 * mmx multimodal helpers — image, music, video, speech, describe — stay in
 * place because nca does not provide those).
 *
 * Why nca over the mmx CLI: the mmx integration had three structural bugs
 * (wrong stdin shape `{messages:[...]}` vs bare `[...]`, `--stream` mixing
 * SSE+JSON making per-line parsing fragile, and `isAvailable()` reading env
 * vars when mmx itself reads its own `config.json`). nca exposes a clean
 * subprocess contract documented at https://github.com/madebyaris/native-cli-ai
 * — `nca run --prompt <text> --stream ndjson --permission-mode bypass-permissions`
 * emits one event per line with stable shapes.
 *
 * Configuration (env, evaluated dynamically — module-load capture would
 * make post-spawn mutation a no-op as it did with mmx-client):
 *   - NCA_BIN          override the binary path. Default: `/usr/local/bin/nca`
 *                      with PATH-based `'nca'` fallback.
 *   - MINIMAX_API_KEY  forwarded to the child process for the default
 *                      MiniMax provider. Same name nca expects natively.
 *   - NCA_MODEL        overrides the default model. nca defaults to
 *                      MiniMax-M2.5; M2.7 / M2.7-highspeed also available.
 *   - NCA_PERMISSION_MODE  overrides `bypass-permissions` if a stricter
 *                      mode is wanted. Default lets nca run unattended.
 *
 * Stream contract (ndjson, observed 2026-05-02 against nca 0.x):
 *   {"id":N,"ts":"...","event":{"type":"SessionStarted",...}}
 *   {"id":N,"ts":"...","event":{"type":"MessageReceived","role":"user",...}}
 *   {"id":N,"ts":"...","event":{"type":"BusyStateChanged","state":"thinking"}}
 *   {"id":N,"ts":"...","event":{"type":"Checkpoint",...}}
 *   {"id":N,"ts":"...","event":{"type":"BusyStateChanged","state":"streaming"}}
 *   {"id":N,"ts":"...","event":{"type":"TokensStreamed","delta":"<chunk>"}}  ← yield this
 *   {"id":N,"ts":"...","event":{"type":"CostUpdated",...}}
 *   {"id":N,"ts":"...","event":{"type":"MessageReceived","role":"assistant","content":"..."}}
 *   {"id":N,"ts":"...","event":{"type":"BusyStateChanged","state":"idle"}}
 *   {"id":N,"ts":"...","event":{"type":"SessionEnded","reason":"Completed"}}  ← stream end
 *
 * Exit codes (per nca docs): 0=success, 1=internal, 10=config, 11=provider/tool,
 * 13=approval-blocked, 130=cancelled. Surfaced in NcaError.code.
 */

import { spawn as nodeSpawn, type spawn as SpawnFn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Test-injection seam, mirroring lib/mmx-client.ts. Keeps the test surface
// in this module rather than vi.mock('node:child_process').
let _spawn: typeof SpawnFn = nodeSpawn;

// Read env dynamically. The same lesson from MMX-WIN-INSTALL: capturing
// `process.env.NCA_BIN` at module-load time makes post-install mutation a
// no-op for the very next call.
function ncaBin(): string {
  const env = process.env.NCA_BIN?.trim();
  if (env) return env;
  // Prefer the absolute path the nca installer drops on POSIX before the
  // PATH lookup so we don't accidentally pick up a half-installed shim
  // somewhere earlier in PATH (apt/snap wrappers etc.).
  if (process.platform !== 'win32' && existsSync('/usr/local/bin/nca')) {
    return '/usr/local/bin/nca';
  }
  return 'nca';
}

function ncaModel(): string | undefined {
  const m = process.env.NCA_MODEL?.trim();
  return m || undefined;
}

function ncaPermissionMode(): string {
  return process.env.NCA_PERMISSION_MODE?.trim() || 'bypass-permissions';
}

// ───────────────────────────────────────────────────────────────────────────
// Errors
// ───────────────────────────────────────────────────────────────────────────

export class NcaError extends Error {
  constructor(
    public readonly code: number | string,
    message: string,
  ) {
    super(message);
    this.name = 'NcaError';
  }
}

export class NcaSpawnError extends NcaError {
  constructor(message: string) {
    super('SPAWN', message);
    this.name = 'NcaSpawnError';
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Health probes
// ───────────────────────────────────────────────────────────────────────────

interface NcaDoctor {
  provider: string;
  default_model: string;
  providers: Array<{
    provider: string;
    selected: boolean;
    api_key_present: boolean;
    api_key_env: string;
    model: string;
    base_url: string;
  }>;
  mcp_server_count: number;
  skill_count: number;
  memory_path: string;
}

interface DoctorProbe {
  ok: boolean;
  doctor?: NcaDoctor;
  error?: string;
}

/**
 * One-shot `nca doctor --json` probe. Resolves quickly (`<2s` typical) and
 * returns the parsed doctor payload when nca is callable. Used by both
 * isAvailable() and the /api/nca/status route. Stderr is INFO-level log
 * lines that we deliberately discard — the JSON we need is always on stdout.
 */
function runDoctor(timeoutMs = 5000): Promise<DoctorProbe> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r: DoctorProbe) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    let child;
    try {
      child = _spawn(ncaBin(), ['doctor', '--json'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      finish({ ok: false, error: e instanceof Error ? e.message : String(e) });
      return;
    }

    const stdoutChunks: Buffer[] = [];
    child.stdout?.on('data', (c: Buffer) => stdoutChunks.push(c));
    child.stderr?.on('data', () => { /* INFO logs — discard */ });

    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* already dead */ }
      finish({ ok: false, error: `nca doctor timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    child.once('error', (err) => {
      clearTimeout(timer);
      finish({ ok: false, error: err.message });
    });

    child.once('close', (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
      if (code !== 0 || !stdout) {
        finish({ ok: false, error: `nca doctor exited ${code}` });
        return;
      }
      try {
        const doctor = JSON.parse(stdout) as NcaDoctor;
        finish({ ok: true, doctor });
      } catch (e) {
        finish({ ok: false, error: `nca doctor returned non-JSON: ${e instanceof Error ? e.message : String(e)}` });
      }
    });
  });
}

/**
 * Whether the nca binary is installed and runnable in this process. Cheap:
 * `nca doctor --json` exits within ~1s on a healthy install. Use this to
 * gate UI affordances (the AI agent selector card) instead of catching
 * exceptions deep inside a streaming hot path.
 */
export async function isAvailable(): Promise<boolean> {
  const r = await runDoctor();
  return r.ok;
}

/**
 * Whether at least one provider has an api-key configured.
 *
 * Synchronous so it can be called from request handlers without an extra
 * async hop. Two sources, in priority order:
 *
 *   1. `process.env.<PROVIDER>_API_KEY` — the env-var fast path. nca itself
 *      reads these at run time and they win over config.toml.
 *   2. `~/.nca/config.toml` (or `./.nca/config.toml` workspace-local, or the
 *      `$NCA_CONFIG` override) — nca persists keys here too via
 *      `nca auth login --method api-key`. The Next.js server process does
 *      not inherit shell env from `nca` invocations, so the env-only check
 *      used to falsely report unauth'd while `nca doctor` and `nca run`
 *      were happily reading the on-disk key.
 *
 * The async {@link getDoctor} probe remains the authoritative source — it
 * asks nca itself. Use this sync helper for hot-path gating; reach for the
 * doctor when you need per-provider status (the status route does this).
 */
export function isAuthenticated(): boolean {
  if (
    (process.env.MINIMAX_API_KEY && process.env.MINIMAX_API_KEY.trim()) ||
    (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim()) ||
    (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim()) ||
    (process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim())
  ) {
    return true;
  }
  return ncaConfigHasApiKey();
}

/**
 * Sync probe of nca's config.toml for any populated `api_key` field.
 *
 * nca's TOML schema places `api_key = "..."` directly inside each
 * `[provider.<name>]` block (alongside `api_key_env = "..."` which is
 * always present and does NOT imply auth). The negative lookahead in the
 * regex distinguishes the two so we don't get a false positive from
 * `api_key_env`.
 *
 * Search order matches nca's own resolution: `$NCA_CONFIG` if set and
 * present, then workspace-local `./.nca/config.toml`, then user-global
 * `~/.nca/config.toml`. First file found wins; we don't merge.
 */
function ncaConfigHasApiKey(): boolean {
  const candidates: string[] = [];
  const explicit = process.env.NCA_CONFIG?.trim();
  if (explicit) candidates.push(explicit);
  candidates.push(join(process.cwd(), '.nca', 'config.toml'));
  candidates.push(join(homedir(), '.nca', 'config.toml'));

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    // `api_key(?!_)` excludes `api_key_env`. The quoted-value capture
    // requires at least one non-quote character so we don't count
    // `api_key = ""` as authenticated.
    if (/^\s*api_key(?!_)\s*=\s*"[^"]+"\s*$/m.test(raw)) {
      return true;
    }
    // First file found is authoritative regardless of result — match
    // nca's own resolution semantics.
    return false;
  }
  return false;
}

/** Async richer probe — fetches the full doctor payload for the status route. */
export async function getDoctor(): Promise<NcaDoctor | null> {
  const r = await runDoctor();
  return r.ok && r.doctor ? r.doctor : null;
}

// ───────────────────────────────────────────────────────────────────────────
// Streaming prompt
// ───────────────────────────────────────────────────────────────────────────

export interface NcaPromptOptions {
  /** Per-request system instruction, prepended to the user message. nca's
   *  CLI doesn't expose a separate `--system-prompt` flag for `run`; the
   *  most reliable shape is to wrap the prompt with a leading directive
   *  block, mirroring how lib/pi-client.ts handles per-request systems. */
  systemPrompt?: string;
  /** Aborting kills the in-flight nca subprocess. */
  signal?: AbortSignal;
  /** Override the model for this call. Default: nca's own default
   *  (MiniMax-M2.5) unless NCA_MODEL is set globally. */
  model?: string;
}

interface NcaEventEnvelope {
  id?: number;
  ts?: string;
  event?: {
    type?: string;
    delta?: string;
    reason?: string;
    role?: string;
    content?: string;
    state?: string;
  };
}

/**
 * Stream text deltas from nca, yielding each chunk as it arrives. The
 * generator terminates when nca emits `SessionEnded` or the request
 * errors. Each call spawns a fresh child — nca's `run` subcommand is
 * one-shot and stateless, same shape as mmx's old `text chat`.
 *
 * We pick `--stream ndjson` over `--stream off --json` for the streaming
 * use-case: ndjson emits per-token events (TokensStreamed) the moment the
 * provider produces them, where `--stream off` only returns the final
 * payload. The caller (SSE route) wants progressive rendering, so ndjson
 * is the right choice.
 */
export async function* prompt(
  message: string,
  options?: NcaPromptOptions,
): AsyncGenerator<string, void, void> {
  // Compose the effective user message. Per-request systemPrompt is
  // prepended (nca's `run` has no separate --system-prompt flag), matching
  // the shape pi-client.prompt uses for the same reason.
  const composed = options?.systemPrompt
    ? `${options.systemPrompt}\n\n---\n\n${message}`
    : message;

  const args: string[] = [
    'run',
    '--prompt', composed,
    '--stream', 'ndjson',
    '--permission-mode', ncaPermissionMode(),
  ];
  const model = options?.model || ncaModel();
  if (model) {
    args.push('--model', model);
  }

  let child;
  try {
    child = _spawn(ncaBin(), args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: options?.signal,
    });
  } catch (e) {
    throw new NcaSpawnError(`failed to spawn ${ncaBin()}: ${e instanceof Error ? e.message : String(e)}`);
  }

  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');

  let stdoutBuffer = '';
  let stderrTail = '';
  const queue: string[] = [];
  let resolveNext: (() => void) | null = null;
  let finished = false;
  let streamError: Error | null = null;

  const wakeConsumer = () => {
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r();
    }
  };

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let envelope: NcaEventEnvelope;
    try {
      envelope = JSON.parse(trimmed) as NcaEventEnvelope;
    } catch {
      // Non-JSON output from nca shouldn't happen on stdout in ndjson
      // mode — drop silently rather than poison the stream.
      return;
    }
    const evt = envelope.event;
    if (!evt || typeof evt.type !== 'string') return;

    if (evt.type === 'TokensStreamed' && typeof evt.delta === 'string' && evt.delta.length > 0) {
      queue.push(evt.delta);
      wakeConsumer();
      return;
    }
    if (evt.type === 'SessionEnded') {
      const reason = evt.reason || '';
      if (reason && reason !== 'Completed') {
        streamError = new NcaError('END', `nca session ended: ${reason}`);
      }
      finished = true;
      wakeConsumer();
      return;
    }
    // Other events (BusyStateChanged, MessageReceived, CostUpdated, etc.)
    // carry no payload we yield to the caller.
  };

  child.stdout?.on('data', (chunk: string) => {
    stdoutBuffer += chunk;
    let nlIndex: number;
    while ((nlIndex = stdoutBuffer.indexOf('\n')) !== -1) {
      const line = stdoutBuffer.slice(0, nlIndex);
      stdoutBuffer = stdoutBuffer.slice(nlIndex + 1);
      handleLine(line);
    }
  });

  child.stderr?.on('data', (chunk: string) => {
    stderrTail += chunk;
    if (stderrTail.length > 8192) stderrTail = stderrTail.slice(-4096);
  });

  child.once('error', (err) => {
    streamError = new NcaSpawnError(`nca spawn error: ${err.message}`);
    finished = true;
    wakeConsumer();
  });

  child.once('close', (code) => {
    // Drain any unterminated tail line (rare — ndjson is line-delimited
    // and nca always closes with a SessionEnded line).
    if (stdoutBuffer.trim()) {
      handleLine(stdoutBuffer);
      stdoutBuffer = '';
    }
    if (code !== 0 && !streamError) {
      streamError = new NcaError(
        code ?? -1,
        `nca exited code ${code}: ${stderrTail.trim().slice(-400) || 'no stderr'}`,
      );
    }
    finished = true;
    wakeConsumer();
  });

  try {
    while (!finished || queue.length > 0) {
      if (queue.length === 0 && !finished) {
        await new Promise<void>((resolve) => { resolveNext = resolve; });
      }
      while (queue.length > 0) yield queue.shift()!;
    }
    if (streamError) throw streamError;
  } finally {
    if (!child.killed && child.exitCode === null) {
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Test-only seam
// ───────────────────────────────────────────────────────────────────────────

export function __setSpawnForTests(fn: typeof SpawnFn | null): void {
  _spawn = fn ?? nodeSpawn;
}
