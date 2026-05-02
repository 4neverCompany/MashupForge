# Brief: nca Install Flow UX

## Problem

When the nca binary is not installed on the user's machine, the Settings AI Agent tab shows "nca is not installed yet." with only an API key paste form. There is no way to:
1. Trigger an install from within the app
2. Open the nca CLI to configure provider/model
3. Select a model after authentication

The "not installed" state also shows an irrelevant API key form — the user hasn't even reached the "do you have a key" question yet.

## Current Behavior

When `ncaStatus == null || !ncaStatus.available`:
- Caption: "nca is not installed yet."
- API key input (misleading — user hasn't installed the binary)
- External link to platform.minimax.io (API key procurement, not install)
- No install CTA, no CLI access

When `available === true && !authenticated`:
- Caption: "nca is installed but not authenticated." (correct)
- API key form (correct)

When `available === true && authenticated === true`:
- Status: "nca is authenticated and ready (MiniMax-M2.5)."
- "Open MMX CLI to change provider/model" link (label says MMX, not nca)
- No model picker

## Desired Behavior

### State 1: Not Installed (`available === false`)
Show:
- "nca is not installed yet." caption
- A prominent **"Install nca"** button that opens the install page in the default browser: `https://github.com/madebyaris/native-cli-ai/releases`
- Small text: "Windows: `winget install Aris.native-cli-ai`" as an alternative
- HIDE the API key form at this stage — it is confusing before the binary exists

### State 2: Not Authenticated (`available === true && !authenticated`)
Show:
- API key paste form (already works)
- After key saved → status refreshes to State 3

### State 3: Authenticated (`available === true && authenticated === true`)
Show:
- Current: "nca is authenticated and ready (MiniMax-M2.5)."
- **New: Model picker** — dropdown/radio of available models from `nca models --json`
  - Fetches from `/api/nca/models` (new endpoint, or extend existing status route)
  - Saves selection to `NCA_MODEL` via existing `/api/nca/setup` with `{ model: "..." }`
  - Default to nca's own default model, highlight current selection
- **"Open nca CLI"** button (renamed from "Open MMX CLI")
  - Opens `nca` in a tmux session for interactive provider/model config
  - Same mechanism as the current `handleNcaSetup()`

## API Changes

### New: `GET /api/nca/models`
Returns the output of `nca models --json`:
```json
{
  "default_provider": "MiniMax",
  "default_model": "MiniMax-M2.5",
  "provider_models": [
    { "provider": "MiniMax", "model": "MiniMax-M2.5", "base_url": "...", "selected": true },
    { "provider": "MiniMax", "model": "MiniMax-M2.7", "base_url": "...", "selected": false },
    { "provider": "MiniMax", "model": "MiniMax-M2.7-highspeed", "base_url": "...", "selected": false },
    { "provider": "OpenAI", "model": "gpt-4o-mini", ... },
    ...
  ],
  "aliases": {...}
}
```

## Files to Change

- `components/SettingsModal.tsx` — state-aware nca setup block rendering
- `app/api/nca/models/route.ts` — new endpoint
- (optional) `app/api/nca/setup/route.ts` — already handles model save via POST body

## Acceptance Criteria

1. "Not Installed" state shows Install button + winget hint, hides API key form
2. Install button opens GitHub releases in external browser
3. After install + auth, model picker appears with all available models
4. Model selection saves to `NCA_MODEL` via existing setup route
5. "Open nca CLI" button is labeled correctly (not "MMX CLI")
6. All states re-probe status after the relevant action completes
