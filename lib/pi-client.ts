/**
 * Pi RPC client — runs pi as a long-lived child process and drives it via
 * JSONL over stdin/stdout.
 *
 * Singleton: one pi process serves the whole Next.js server. Prompts are
 * queued so only one runs at a time (pi's RPC mode is single-threaded per
 * process and mixing streams would be unsafe).
 *
 * Protocol (probed 2026-04-10 against @mariozechner/pi-coding-agent):
 *
 *   Spawn:   pi --mode rpc --no-session --no-tools --system-prompt "<base>"
 *   Command: {"id":"<n>","type":"prompt","message":"<text>"}\n
 *   Ack:     {"id":"<n>","type":"response","command":"prompt","success":true}
 *            (immediate, NOT the end signal)
 *   Deltas:  {"type":"message_update","assistantMessageEvent":
 *              {"type":"text_delta","contentIndex":0,"delta":"hi"}}
 *   End:     {"type":"agent_end","messages":[...]}
 *   Errors:  responses with success:false, or internal message errorMessage
 *
 * Notes:
 *   - Node's readline cannot be used: it splits on U+2028/U+2029 which
 *     corrupt JSON payloads containing those characters. We buffer + split
 *     on \n manually.
 *   - Pi ignores the `system` field in RPC commands. Per-request system
 *     variation is achieved by prepending a mode directive to the message.
 *   - There is no `exit` command; we kill the child process to stop it.
 */

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { getPiPath, resolvePiJsEntry } from './pi-setup';

export interface PiPromptOptions {
  /** Extra per-request instruction prepended to the user message. */
  systemPrompt?: string;
  /** Optional abort signal — aborting kills the in-flight pi request. */
  signal?: AbortSignal;
}

export interface PiClientStatus {
  running: boolean;
  provider: string | null;
  model: string | null;
  lastError: string | null;
}

interface PendingRequest {
  id: string;
  onDelta: (text: string) => void;
  onDone: (lastMessage: PiAssistantMessage | null) => void;
  onError: (err: Error) => void;
}

interface PiAssistantMessage {
  role: 'assistant';
  content: Array<{ type: string; text?: string }>;
  provider?: string;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
}

// ── Configuration ────────────────────────────────────────────────────
const BASE_SYSTEM_PROMPT =
  "You are a creative AI assistant for MashupForge, an AI-driven studio that generates crossover image prompts across Star Wars, Marvel, DC, Warhammer 40k, and other fictional universes. Follow instructions precisely. When asked to return JSON, return ONLY valid JSON with no preamble, no commentary, and no markdown code fences. When asked for a single string, return ONLY that string.";

// ── Singleton state ──────────────────────────────────────────────────
let proc: ChildProcessWithoutNullStreams | null = null;
let stdoutBuffer = '';
let stderrBuffer = '';
let nextRequestId = 1;
let currentRequest: PendingRequest | null = null;
let requestQueue: Array<() => void> = [];
let lastProvider: string | null = null;
let lastModel: string | null = null;
let lastError: string | null = null;
let userSystemPrompt: string | null = null;

// ── Public API ───────────────────────────────────────────────────────

export function isRunning(): boolean {
  return proc !== null && !proc.killed && proc.exitCode === null;
}

export function getStatus(): PiClientStatus {
  return {
    running: isRunning(),
    provider: lastProvider,
    model: lastModel,
    lastError,
  };
}

/** Configure a custom system prompt before start() / on next restart. */
export function setUserSystemPrompt(prompt: string | null | undefined) {
  userSystemPrompt = prompt?.trim() || null;
}

/**
 * Spawn pi if it's not already running. Safe to call repeatedly — returns
 * the same process. Rejects if pi isn't installed.
 */
export async function start(): Promise<void> {
  if (isRunning()) return;

  const piPath = getPiPath();
  if (!piPath) {
    throw new Error('pi binary not found. Install with: npm install -g @mariozechner/pi-coding-agent');
  }

  // Reset singleton state in case we're restarting after a crash.
  proc = null;
  stdoutBuffer = '';
  stderrBuffer = '';
  currentRequest?.onError(new Error('pi restarted mid-request'));
  currentRequest = null;
  requestQueue = [];
  lastError = null;

  const fullSystemPrompt = userSystemPrompt
    ? `${BASE_SYSTEM_PROMPT}\n\n${userSystemPrompt}`
    : BASE_SYSTEM_PROMPT;

  // Provider/model resolution order:
  //   1. PI_PROVIDER / PI_DEFAULT_MODEL env (hydrated from config.json by
  //      the Tauri wrapper — set via the Desktop Settings dropdown)
  //   2. First provider key in ~/.pi/agent/auth.json (users who ran
  //      `pi /login` for OAuth providers)
  //   3. Pi's own default (no flag passed)
  let piProvider = process.env.PI_PROVIDER?.trim() || '';
  if (!piProvider) {
    try {
      const { existsSync, readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { homedir } = await import('node:os');
      const authFile = join(homedir(), '.pi', 'agent', 'auth.json');
      if (existsSync(authFile)) {
        const auth = JSON.parse(readFileSync(authFile, 'utf8'));
        const providers = Object.keys(auth);
        if (providers.length > 0) {
          piProvider = providers[0];
        }
      }
    } catch { /* no auth file — pi will error gracefully */ }
  }
  const piModel = process.env.PI_DEFAULT_MODEL?.trim() || '';

  const args = [
    '--mode', 'rpc',
    '--no-session',
    '--no-tools',
  ];

  if (piProvider) {
    args.push('--provider', piProvider);
  }
  if (piModel) {
    args.push('--model', piModel);
  }

  args.push('--system-prompt', fullSystemPrompt);

  // Forward AI provider env vars so pi can authenticate via the same
  // keys the user configured in DesktopSettingsPanel. Previously we
  // stripped every `*_API_KEY` to force pi to use its own
  // ~/.pi/agent/auth.json, which broke the ZAI fallback flow: pi needs
  // ZAI_API_KEY (and GEMINI_API_KEY etc.) in env to route to the
  // matching provider — see providers.md in @mariozechner/pi-coding-agent.
  const cleanEnv = { ...process.env };

  // Windows: `pi.cmd` is an npm shim and Node 18.20.2+ refuses to spawn
  // `.cmd` / `.bat` files without `shell: true` (CVE-2024-27980). Shell mode
  // would mangle our stdin/stdout RPC pipe, so bypass the shim by spawning
  // the bundled `node.exe` (= `process.execPath` inside the Tauri sidecar)
  // against pi's resolved JS entry point. STORY-120: without this, the
  // first spawn attempt fired `error: EINVAL` on the async 'error' event
  // and prompts hung forever writing into a dead child's stdin.
  let spawnCmd = piPath;
  let spawnArgs = args;
  if (process.platform === 'win32' && piPath.toLowerCase().endsWith('.cmd')) {
    const jsEntry = resolvePiJsEntry(piPath);
    if (jsEntry) {
      spawnCmd = process.execPath;
      spawnArgs = [jsEntry, ...args];
    }
  }

  const child = spawn(spawnCmd, spawnArgs, {
    env: cleanEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  child.stdout.on('data', handleStdoutChunk);
  child.stderr.on('data', (chunk: string) => {
    stderrBuffer += chunk;
    if (stderrBuffer.length > 8192) {
      stderrBuffer = stderrBuffer.slice(-4096);
    }
  });

  child.on('exit', (code, signal) => {
    const wasRunning = proc === child;
    proc = null;
    if (currentRequest) {
      currentRequest.onError(
        new Error(`pi exited (code=${code} signal=${signal}) mid-stream: ${stderrBuffer.slice(-400)}`)
      );
      currentRequest = null;
    }
    if (wasRunning) {
      lastError = `pi exited code=${code} signal=${signal}`;
    }
    // Flush any queued requests so they don't wait forever.
    const queue = requestQueue;
    requestQueue = [];
    for (const resume of queue) resume();
  });

  child.on('error', (err) => {
    lastError = `pi spawn error: ${err.message}`;
    if (currentRequest) {
      currentRequest.onError(err);
      currentRequest = null;
    }
  });

  proc = child;
  // Pi has no explicit ready event — it accepts commands as soon as stdin
  // is writable. Give the event loop a tick so listeners are wired up.
  await new Promise((r) => setImmediate(r));
}

export function stop(): void {
  if (!proc) return;
  try {
    proc.kill('SIGTERM');
  } catch {
    // ignore
  }
  proc = null;
}

/**
 * Send a prompt to pi and yield each text delta as it arrives. The async
 * iterator terminates when pi emits `agent_end` or the request errors.
 * Prompts are serialized through a queue so concurrent callers don't
 * interleave outputs.
 */
export async function* prompt(
  message: string,
  options?: PiPromptOptions
): AsyncGenerator<string, void, void> {
  if (!isRunning()) {
    await start();
  }

  // Wait our turn in the queue.
  if (currentRequest) {
    await new Promise<void>((resolve) => requestQueue.push(resolve));
  }
  if (!isRunning()) {
    throw new Error(lastError || 'pi process not running');
  }

  // Compose the effective user message. Per-request systemPrompt is
  // prepended because pi ignores the RPC `system` field.
  const composed = options?.systemPrompt
    ? `${options.systemPrompt}\n\n---\n\n${message}`
    : message;

  const id = String(nextRequestId++);

  // Buffer of yielded deltas so the generator stays non-blocking even if
  // pi emits faster than the consumer reads.
  const deltaBuffer: string[] = [];
  let resolveDelta: (() => void) | null = null;
  let finished = false;
  let streamError: Error | null = null;

  const onDelta = (delta: string) => {
    deltaBuffer.push(delta);
    if (resolveDelta) {
      const r = resolveDelta;
      resolveDelta = null;
      r();
    }
  };

  const onDone = () => {
    finished = true;
    if (resolveDelta) {
      const r = resolveDelta;
      resolveDelta = null;
      r();
    }
    currentRequest = null;
    const next = requestQueue.shift();
    if (next) next();
  };

  const onError = (err: Error) => {
    streamError = err;
    finished = true;
    if (resolveDelta) {
      const r = resolveDelta;
      resolveDelta = null;
      r();
    }
    currentRequest = null;
    const next = requestQueue.shift();
    if (next) next();
  };

  currentRequest = { id, onDelta, onDone, onError };

  // Wire up abort.
  const onAbort = () => {
    // Killing the process is the only reliable way to stop pi mid-stream.
    stop();
    onError(new Error('aborted'));
  };
  options?.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const cmd = JSON.stringify({ id, type: 'prompt', message: composed }) + '\n';
    proc!.stdin.write(cmd);

    while (!finished) {
      if (deltaBuffer.length === 0) {
        await new Promise<void>((resolve) => {
          resolveDelta = resolve;
        });
      }
      while (deltaBuffer.length > 0) {
        yield deltaBuffer.shift()!;
      }
    }

    if (streamError) throw streamError;
  } finally {
    options?.signal?.removeEventListener('abort', onAbort);
  }
}

// ── stdout parsing ───────────────────────────────────────────────────

function handleStdoutChunk(chunk: string) {
  stdoutBuffer += chunk;

  let nlIndex: number;
  while ((nlIndex = stdoutBuffer.indexOf('\n')) !== -1) {
    const rawLine = stdoutBuffer.slice(0, nlIndex);
    stdoutBuffer = stdoutBuffer.slice(nlIndex + 1);
    if (!rawLine.trim()) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawLine) as Record<string, unknown>;
    } catch {
      // Non-JSON output (unlikely from pi in rpc mode) — ignore.
      continue;
    }

    dispatchEvent(parsed);
  }
}

function dispatchEvent(evt: Record<string, unknown>) {
  // Ack for the command we just sent (arrives immediately, not the end).
  if (evt.type === 'response' && evt.command === 'prompt') {
    if (!evt.success && currentRequest) {
      currentRequest.onError(new Error((evt.error as string) || 'pi command failed'));
    }
    return;
  }

  // Main event stream: pi wraps each assistant message event in a
  // message_update envelope.
  if (evt.type === 'message_update' && evt.assistantMessageEvent) {
    const inner = evt.assistantMessageEvent as Record<string, unknown>;
    const partial = (inner.partial || evt.message) as Record<string, unknown> | undefined;
    if (partial?.provider) lastProvider = partial.provider as string;
    if (partial?.model) lastModel = partial.model as string;

    if (inner.type === 'text_delta' && typeof inner.delta === 'string' && inner.delta.length > 0) {
      currentRequest?.onDelta(inner.delta);
    }
    return;
  }

  // End of the whole agent turn — signal completion.
  if (evt.type === 'agent_end') {
    const lastMsg: PiAssistantMessage | null =
      Array.isArray(evt.messages) && evt.messages.length > 0
        ? evt.messages[evt.messages.length - 1] as PiAssistantMessage
        : null;

    if (lastMsg?.stopReason === 'error' && lastMsg.errorMessage) {
      currentRequest?.onError(new Error(`pi: ${lastMsg.errorMessage}`));
      return;
    }

    currentRequest?.onDone(lastMsg);
    return;
  }

  // Errors outside the agent loop (e.g., invalid command shape).
  if (evt.type === 'error' || (evt.type === 'response' && evt.success === false)) {
    const msg = (evt.error || evt.errorMessage || 'pi error') as string;
    currentRequest?.onError(new Error(msg));
    return;
  }

  // Other event types (agent_start, turn_start, message_start/end, etc.)
  // carry no payload we need.
}
