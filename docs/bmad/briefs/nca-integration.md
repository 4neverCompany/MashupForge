# Brief: Replace mmx CLI with nca (native-cli-ai) as Second AI Provider

## Context

MashupForge has two AI providers: `pi.dev` (primary, working) and `mmx` CLI (broken, multiple integration issues). The goal is to replace the broken mmx integration with `nca` (native-cli-ai), a Rust-native CLI that supports MiniMax by default and has a clean orchestration contract.

## What is nca

- Rust binary: `/usr/local/bin/nca`
- Built by Aris (https://github.com/madebyaris/native-cli-ai), MIT licensed
- Default provider: MiniMax (M2.5 and M2.7 models)
- Auth: reads `MINIMAX_API_KEY` from environment (same as mmx)
- Already tested: `nca doctor`, `nca run --prompt ... --stream off --json`, `nca models --json` all work correctly
- Multi-provider: MiniMax (default), OpenAI, Anthropic, OpenRouter
- Clean subprocess contract for orchestration (see `docs/orchestration.md`)

## Integration Contract (nca automation interface)

```bash
# One-shot, returns clean JSON
nca run --prompt "say hello" --stream off --json --permission-mode bypass-permissions

# Streaming NDJSON events
nca run --prompt "say hello" --stream ndjson --permission-mode bypass-permissions

# Exit codes: 0=success, 1=internal, 10=config, 11=provider/tool, 13=approval-blocked, 130=cancelled
```

## What Needs to Change

### 1. New file: `lib/nca-client.ts`

Replace `lib/mmx-client.ts`. Shape:

```typescript
// isAvailable(): boolean — check nca binary exists
export async function isAvailable(): Promise<boolean>

// isAuthenticated(): boolean — check MINIMAX_API_KEY is set
export function isAuthenticated(): boolean

// prompt(message, options?): AsyncGenerator<string>
export async function* prompt(
  message: string,
  options?: { systemPrompt?: string; signal?: AbortSignal }
): AsyncGenerator<string, void, void>
```

Implementation: spawn `nca run --prompt <msg> --stream off --json --permission-mode bypass-permissions`, collect stdout, parse JSON for `output` field. System prompt via `NCA_ORCH_TASK_REF` env var (optional). Model selection via `--model` flag (default is MiniMax-M2.5).

### 2. API route: `app/api/nca/` (mirror of `app/api/mmx/`)

Create these routes mirroring the mmx API structure:
- `app/api/nca/prompt/route.ts` — SSE stream, same contract as `/api/mmx/prompt` and `/api/pi/prompt`
- `app/api/nca/status/route.ts` — returns provider, model, auth status
- `app/api/nca/setup/route.ts` — nca doctor + models info

### 3. Settings UI update

Update `components/ai-agent-selector.tsx` (or wherever mmx card is):
- Rename "MMX" card to "nca" 
- Change references from `mmxClient.isAvailable()` to `ncaClient.isAvailable()`
- Add nca to the provider router

### 4. Router / Provider Selection

Update the streamAI router to include nca as a selectable provider. The `activeAiAgent` setting should offer: `pi`, `nca`.

### 5. Optional: add M2.7 model selection

nca defaults to MiniMax-M2.5. Allow M2.7 via `--model MiniMax-M2.7` flag. Add this to the settings card.

### 6. Cleanup

- Archive `lib/mmx-client.ts` → `lib/mmx-client.ts.archive` (keep for reference)
- Archive `app/api/mmx/` → `app/api/mmx.archive/`
- Remove or comment out mmx from `components/ai-agent-selector.tsx`

## Known Issues with mmx (do NOT try to fix — replace instead)

- Wrong stdin format `{ messages: [...] }` instead of bare `[...]`
- `--stream` flag produces mixed SSE+JSON making per-line parsing fragile
- `isAvailable()` checks env vars but mmx reads its own config.json
- Multiple OAuth attempts fixed but API key flow was always unreliable

## Acceptance Criteria

1. `nca run --prompt "test" --stream off --json` returns clean JSON with `output` field
2. `lib/nca-client.ts` exports `isAvailable()`, `isAuthenticated()`, `prompt()`
3. `/api/nca/prompt` returns SSE stream with same format as `/api/pi/prompt`
4. Settings UI shows nca as a selectable provider alongside pi
5. Selecting nca in settings causes chat/generate/idea flows to use nca
6. `nca run --model MiniMax-M2.7 --prompt "test" --stream off --json` works

## Models Available via nca

- `MiniMax-M2.5` (default)
- `MiniMax-M2.7` (use `--model MiniMax-M2.7`)
- `MiniMax-M2.7-highspeed` (use `--model MiniMax-M2.7-highspeed`)
- Plus OpenAI/Anthropic/OpenRouter if keys are set

## Files to Create/Modify

```
lib/nca-client.ts          (new)
app/api/nca/prompt/route.ts    (new)
app/api/nca/status/route.ts    (new)
app/api/nca/setup/route.ts     (new)
components/ai-agent-selector.tsx  (modify)
app/api/stream-ai/route.ts     (modify if needed)
docs/bmad/briefs/nca-integration.md  (this file)
```

## Agent Assignments

- **Dev**: Create `lib/nca-client.ts`, create API routes, update router
- **Designer**: Update settings UI, rename/rebrand mmx card to nca
- **QA**: Verify nca works end-to-end, verify SSE format matches pi spec, test model switching
