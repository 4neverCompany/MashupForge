/**
 * V1.6: opt-in agentic Director pipeline — the network call that turns an
 * idea concept into a planned image prompt via the multi-step tool-use
 * loop (`/api/ai/prompt` mode:director → lib/agent-loop).
 *
 * Extracted from hooks/useIdeaProcessor.ts so the request + fallback logic
 * is unit-testable without rendering the pipeline hook. The function NEVER
 * throws and NEVER blocks the pipeline: any failure (no provider, route
 * 4xx, empty prompt, network error) resolves to `{ ok: false, reason }`
 * and the caller falls back to the verbatim concept.
 */

export interface DirectorPromptRequest {
  /** The idea concept (the "angle"). Trimmed + capped to 400 chars here. */
  ideaConcept: string;
  /** 1-6 content pillars. The Director route 400s on an empty list. */
  niches: string[];
  /** 0-10 style tags. */
  genres: string[];
  /** Optional text-AI model id (falls back to the server default). */
  model?: string;
  /** Active skill names folded into the prompt template. */
  activeSkills?: string[];
}

export type DirectorPromptOutcome =
  | { ok: true; prompt: string; cost?: number; truncatedBy?: string }
  | { ok: false; reason: string };

/**
 * POST the Director request and return the final prompt, or a reason to
 * fall back. `fetchImpl` is injectable for tests.
 */
export async function requestDirectorPrompt(
  req: DirectorPromptRequest,
  opts: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<DirectorPromptOutcome> {
  const doFetch = opts.fetchImpl ?? fetch;
  const niches = req.niches.filter(Boolean).slice(0, 6);
  if (niches.length === 0) {
    return { ok: false, reason: 'no content pillars configured' };
  }
  const concept = req.ideaConcept.trim().slice(0, 400);
  if (concept.length < 3) {
    return { ok: false, reason: 'concept too short' };
  }

  try {
    const res = await doFetch('/api/ai/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'director',
        ideaConcept: concept,
        niches,
        genres: req.genres.filter(Boolean).slice(0, 10),
        ...(req.model ? { model: req.model } : {}),
        skillContext: (req.activeSkills ?? []).filter(Boolean).map((name) => ({ name })),
        userId: 'pipeline',
      }),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });

    if (!res.ok) {
      let reason = `HTTP ${res.status}`;
      try {
        const e = (await res.json()) as { error?: string };
        if (e.error) reason = e.error;
      } catch {
        /* non-JSON error body — keep the status string */
      }
      return { ok: false, reason };
    }

    const data = (await res.json()) as { prompt?: string; cost?: number; truncatedBy?: string };
    const prompt = (data.prompt ?? '').trim();
    if (prompt.length === 0) {
      return { ok: false, reason: 'empty prompt' };
    }
    return {
      ok: true,
      prompt,
      ...(typeof data.cost === 'number' ? { cost: data.cost } : {}),
      ...(typeof data.truncatedBy === 'string' ? { truncatedBy: data.truncatedBy } : {}),
    };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'network error' };
  }
}
