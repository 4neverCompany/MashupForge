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
 *   - 'mmx' — replaced by 'nca' on 2026-05-02 (NCA-INTEGRATION-DEV).
 *             The mmx chat path had structural bugs (wrong stdin shape,
 *             SSE/JSON mixing); nca exposes a clean ndjson contract.
 *             The 'mmx' alias is kept as a back-compat redirect to nca
 *             so existing settings.activeAiAgent values keep working
 *             without a one-shot migration. Multimodal mmx routes
 *             (image/music/video/speech/describe) are NOT replaced —
 *             nca is text-only.
 *   - 'nca' — current default second provider. ndjson stream, MiniMax
 *             by default (M2.5; M2.7 / M2.7-highspeed available via
 *             NCA_MODEL env or per-call `model` param).
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
   */
  provider?: 'pi' | 'nca' | 'mmx';
  /**
   * Optional per-call model override, forwarded to the underlying
   * provider route as `body.model`. Currently only honoured by the
   * nca route (e.g. 'MiniMax-M2.7'); pi reads its model from server
   * env and ignores this field.
   */
  model?: string;
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
  const provider = options?.provider ?? 'pi';
  const url =
    provider === 'nca' || provider === 'mmx' ? '/api/nca/prompt' : '/api/pi/prompt';
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
  return out;
}

/**
 * Robust JSON extraction from an LLM response.
 *
 * Reasoning models (GLM-5.1 et al.) frequently wrap their output in
 * markdown code fences AND append explanatory commentary after the
 * closing bracket. JSON.parse rejects anything after the top-level
 * value, so this helper strips fences, then slices from the first
 * `[` to the last `]` (or `{` / `}` for objects) before parsing.
 * Falls back to an empty array / object on empty input.
 */
function parseJsonFromLLM(raw: string, kind: 'array' | 'object'): unknown {
  let text = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
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
