/**
 * Client-side helpers for streaming AI text. /api/pi/prompt and
 * /api/nca/prompt expose the same text/event-stream contract:
 *
 *   data: {"text":"<delta>"}\n\n
 *   ...
 *   data: {"error":"..."}\n\n   (on failure)
 *   data: [DONE]\n\n
 *
 * AI-AGENT-ROUTING: callers pass `provider: settings.activeAiAgent` to pick
 * which backend handles the request. Default is pi for back-compat
 * with installs that haven't toggled the AI Agent setting yet.
 *
 * Provider history:
 *   - 'pi'  — legacy default. Long-lived RPC subprocess via lib/pi-client.
 *   - 'mmx' — @deprecated 2026-06-02. Replaced by 'nca' on 2026-05-02
 *             (NCA-INTEGRATION-DEV). The mmx chat path had structural
 *             bugs (wrong stdin shape, SSE/JSON mixing); nca exposes
 *             a clean ndjson contract. The 'mmx' alias is kept as a
 *             back-compat redirect to nca so existing
 *             settings.activeAiAgent values keep working without a
 *             one-shot migration. Multimodal mmx routes
 *             (image/music/video/speech/describe) are NOT replaced —
 *             nca is text-only.
 *   - 'nca' — @deprecated 2026-06-02. Replaced by 'vercel-ai' as the
 *             second / fallback provider (0513-CONSOLIDATION). The
 *             nca subprocess path is still wired for installs that
 *             pinned `activeAiAgent: 'nca'` before v1.0.1 — the value
 *             keeps working and routes to /api/nca/prompt. New code
 *             should pick 'vercel-ai' for the default AI Agent. ndjson
 *             stream, MiniMax by default (M2.5; M2.7 / M2.7-highspeed
 *             available via NCA_MODEL env or per-call `model` param).
 *   - 'vercel-ai' — current default. Vercel AI SDK provider (no
 *             subprocess), served by /api/ai/prompt. LLM-INTEGRATION-
 *             0513. 0513-CONSOLIDATION trimmed the backend chain from
 *             {MiniMax, OpenAI, Anthropic, OpenRouter} to {MiniMax,
 *             OpenAI}; MiniMax is the default and OpenAI is the
 *             fallback. The 'vercel-ai' route is the only one
 *             recommended for new code.
 */

export type PiMode =
  | 'chat'
  | 'generate'
  | 'idea'
  | 'enhance'
  | 'caption'
  | 'tag'
  | 'negative-prompt'
  | 'collection-info';

/**
 * Source-attribution record emitted by `/api/ai/prompt` when web-search
 * pre-enrichment yields hits (DDG/Brave snippets layered into the user
 * message). Shape is intentionally identical to `TrendSource` in
 * `Sidebar.tsx` so the existing trending-sources render path can show
 * /api/trending + /api/ai/prompt sources side-by-side without a second
 * UI affordance. The server fills `topic` with the bucket label
 * (`'web search'` / `'trending'`) and `source` with the URL's hostname.
 */
export interface AiSource {
  topic: string;
  headline: string;
  source: string;
  url: string;
}

export interface StreamAIOptions {
  mode?: PiMode;
  systemPrompt?: string;
  signal?: AbortSignal;
  /**
   * Active niches/genres from Settings. Forwarded verbatim to the route
   * so the server can tailor the trending web-search query (see
   * `buildTrendingQuery` in app/api/pi/prompt/route.ts). Only used for
   * `mode: 'idea'`; ignored for other modes.
   */
  niches?: string[];
  genres?: string[];
  /**
   * AI-AGENT-ROUTING: which AI agent backend handles this call. Mirrors
   * UserSettings.activeAiAgent. Default 'pi' so callers that don't yet
   * thread the user setting through stay on the pre-routing behavior.
   * 'mmx' is kept as a back-compat alias for 'nca' (see module-level
   * comment) — existing settings values keep working post-migration.
   *
   * LLM-INTEGRATION-0513 added 'vercel-ai' — direct Vercel AI SDK
   * provider, no subprocess. Same SSE wire contract as pi/nca, served
   * by /api/ai/prompt.
   *
   * 0513-CONSOLIDATION: the vercel-ai backend chain was trimmed from
   * {MiniMax, OpenAI, Anthropic, OpenRouter} to {MiniMax, OpenAI}.
   * MiniMax stays the default; OpenAI is the only fallback. 'nca'
   * and 'mmx' are kept as deprecated aliases for back-compat with
   * installs that selected them before v1.0.1.
   */
  provider?: 'pi' | 'nca' | 'mmx' | 'vercel-ai';
  /**
   * Optional per-call model override, forwarded to the underlying
   * provider route as `body.model`. Currently only honoured by the
   * nca route (e.g. 'MiniMax-M2.7'); pi reads its model from server
   * env and ignores this field.
   */
  model?: string;
  /**
   * Invoked once per stream when the server emits a `sources` SSE
   * event — currently /api/ai/prompt sends one immediately after the
   * web-search pre-enrichment step, before any text deltas. Callbacks
   * are best-effort; throwing from the callback aborts the stream.
   * Non-vercel-ai providers don't emit this event and the callback
   * never fires.
   */
  onSources?: (sources: AiSource[]) => void;
  /**
   * V1.1.1-SKILLS-AUTO-USE: list of skill names from
   * `docs/research/higgsfield-skills/` to inject into the system
   * prompt for this stream. The frontend reads
   * `settings.activeSkills` and forwards the list here; the server
   * route loads + concatenates the skill bodies before calling
   * the model. Unknown names are silently ignored.
   */
  activeSkills?: string[];
}

/**
 * Stream text deltas from /api/pi/prompt. Yields each token/chunk as it
 * arrives so callers can render progressively. The generator ends when
 * the server emits `[DONE]`.
 *
 * The per-request `systemPrompt` (e.g. `settings.agentPrompt`) is
 * forwarded verbatim and layered on top of the mode directive on the
 * server side. There is no longer a separate "global" client-side
 * system prompt — callers pass the single `agentPrompt` when they need
 * one.
 */
export async function* streamAI(
  message: string,
  options?: StreamAIOptions
): AsyncGenerator<string, void, void> {
  // AI-AGENT-ROUTING: pick the route based on the caller's provider hint.
  // 'mmx' is a back-compat alias for 'nca' — the mmx chat path was retired
  // on 2026-05-02 (NCA-INTEGRATION-DEV) but old settings.activeAiAgent
  // values keep working without forcing a one-shot migration. All
  // provider routes expose the same SSE contract, so the rest of the
  // streaming/parsing loop is provider-agnostic.
  //
  // LLM-INTEGRATION-0513: 'vercel-ai' routes to /api/ai/prompt (direct
  // Vercel AI SDK call, no subprocess). 0513-CONSOLIDATION trimmed the
  // underlying provider chain in that route from
  // {MiniMax, OpenAI, Anthropic, OpenRouter} to {MiniMax, OpenAI}; the
  // client-side provider enum is unchanged.
  const provider = options?.provider ?? 'pi';
  let url: string;
  if (provider === 'vercel-ai') {
    url = '/api/ai/prompt';
  } else if (provider === 'nca' || provider === 'mmx') {
    url = '/api/nca/prompt';
  } else {
    url = '/api/pi/prompt';
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      message,
      mode: options?.mode,
      systemPrompt: options?.systemPrompt,
      niches: options?.niches,
      genres: options?.genres,
      model: options?.model,
      // V1.1.1-SKILLS-AUTO-USE: forward the active skill list to
      // the server so it can load + inject the skill bodies into
      // the system prompt. Pi and nca routes ignore this field
      // (they build the system prompt server-side from their own
      // state), but vercel-ai honors it.
      activeSkills: options?.activeSkills,
    }),
    signal: options?.signal,
  });

  if (!res.ok || !res.body) {
    let errMsg = `${provider} request failed (${res.status})`;
    try {
      const err = await res.json() as Record<string, unknown>;
      if (typeof err?.error === 'string') errMsg = err.error;
    } catch {
      // ignore
    }
    throw new Error(errMsg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sepIndex: number;
    while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);

      for (const line of rawEvent.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data) as Record<string, unknown>;
          if (parsed.error) throw new Error(String(parsed.error));
          if (Array.isArray(parsed.sources) && options?.onSources) {
            // Best-effort cast: server-side shape matches AiSource by
            // construction (see /api/ai/prompt's sources emission).
            // Filter defensively so a malformed entry doesn't poison
            // the callback's downstream renderer.
            const clean: AiSource[] = [];
            for (const s of parsed.sources) {
              if (s && typeof s === 'object') {
                const r = s as Record<string, unknown>;
                if (
                  typeof r.topic === 'string' &&
                  typeof r.headline === 'string' &&
                  typeof r.source === 'string' &&
                  typeof r.url === 'string'
                ) {
                  clean.push({ topic: r.topic, headline: r.headline, source: r.source, url: r.url });
                }
              }
            }
            if (clean.length > 0) options.onSources(clean);
          }
          if (typeof parsed.text === 'string' && parsed.text.length > 0) {
            yield parsed.text;
          }
        } catch (e) {
          if (e instanceof Error && e.message && !e.message.startsWith('Unexpected')) {
            throw e;
          }
          // Ignore malformed lines — keepalives or partial frames.
        }
      }
    }
  }
}

/**
 * Convenience: consume the whole stream and return the concatenated text.
 * Use this for callers that parse JSON output and don't need progressive
 * rendering.
 */
export async function streamAIToString(
  message: string,
  options?: StreamAIOptions
): Promise<string> {
  let out = '';
  for await (const delta of streamAI(message, options)) {
    out += delta;
  }
  // Reasoning models (MiniMax-M2.5, GLM-5.1, DeepSeek-R1…) emit
  // <think>…</think> chain-of-thought before the answer. Callers like
  // expandIdeaToPrompt forward this string straight to Leonardo as an
  // image prompt, so leaking reasoning tags corrupts generation for
  // every non-MiniMax model. Strip here at the boundary; downstream
  // JSON parsers re-strip idempotently.
  return stripThinkBlocks(out);
}

/**
 * Strip `<think>…</think>` reasoning blocks from a model response.
 *
 * MiniMax-M2.5 (and other reasoning models — GLM-5.1, DeepSeek-R1
 * family, etc.) emit their chain-of-thought wrapped in literal
 * `<think>…</think>` tags before the actual answer. The reasoning
 * block can itself contain JSON-like text or stray brace characters,
 * which trips up the first-open/last-close brace-slice strategy in
 * `parseJsonFromLLM` and produces a swallowed `JSON.parse` error.
 *
 * Exported so server-side helpers (e.g. /api/ai/image's prompt
 * cleaner) can share the same logic. Greedy across newlines because
 * a single `<think>` block can span dozens of lines. Tolerates a
 * runaway opening tag without a closing tag — that's the model
 * truncating mid-reasoning; we discard everything from the unmatched
 * `<think>` to end-of-string rather than parse partial reasoning as
 * the answer.
 */
export function stripThinkBlocks(raw: string): string {
  let out = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
  // Drop any unterminated leading <think>… block (model truncated
  // before emitting the closing tag).
  const openIdx = out.indexOf('<think>');
  if (openIdx !== -1 && !out.slice(openIdx).includes('</think>')) {
    out = out.slice(0, openIdx);
  }
  return out.trim();
}

/**
 * Robust JSON extraction from an LLM response.
 *
 * Reasoning models (GLM-5.1, MiniMax-M2.5, et al.) frequently wrap
 * their output in `<think>…</think>` blocks AND markdown code fences,
 * sometimes append explanatory commentary after the closing bracket.
 * JSON.parse rejects anything around the top-level value, so this
 * helper strips think blocks, strips fences, then slices from the
 * first `[` to the last `]` (or `{` / `}` for objects) before
 * parsing. Falls back to an empty array / object on empty input.
 */
function parseJsonFromLLM(raw: string, kind: 'array' | 'object'): unknown {
  let text = stripThinkBlocks(raw)
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();
  const fallback = kind === 'array' ? [] : {};
  if (!text) return fallback;
  const open = kind === 'array' ? '[' : '{';
  const close = kind === 'array' ? ']' : '}';
  const first = text.indexOf(open);
  const last = text.lastIndexOf(close);
  if (first !== -1 && last > first) {
    text = text.slice(first, last + 1);
  }
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/**
 * Typed entry points for LLM JSON parsing. Each helper enforces the
 * top-level shape at runtime — callers get an empty array / object
 * (not a cast lie) if the LLM returns the wrong kind.
 */
export function extractJsonArrayFromLLM(raw: string): unknown[] {
  const parsed = parseJsonFromLLM(raw, 'array');
  return Array.isArray(parsed) ? parsed : [];
}

export function extractJsonObjectFromLLM(raw: string): Record<string, unknown> {
  const parsed = parseJsonFromLLM(raw, 'object');
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}
