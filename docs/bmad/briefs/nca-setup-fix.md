# BRIEF: NCA Setup UX Fix + Chat Debug

## Problem Statement

Three bugs in the NCA provider setup flow inside MashupForge Settings → AI Agent:

### Bug 1 — No API Key Input Field
When the NCA card shows "Not Authenticated" (amber dot), the user has no way to paste their `MINIMAX_API_KEY` directly in the UI. The card has no text input. The `postNcaSetup()` function accepts an `apiKey` parameter but the UI never renders an input field to supply it. The only "setup" action is the dead-link button "Open nca CLI to change provider/model" which calls `handleNcaSetup()` with no arguments (probe-only, no auth).

**Fix:** Add a text input + Save button inside the NCA card's "Not Authenticated" state. Mirror the pattern used by pi.dev for its API key input. Call `postNcaSetup(apiKey)` when the user submits.

### Bug 2 — Dead "Open nca CLI" Button
The button at `SettingsModal.tsx:1017` calls `handleNcaSetup()` (probe-only). There is no terminal opening, no tmux session spawned, no deep-link to the nca CLI. This button is misleading — it implies it will open a CLI but it just re-probes status.

**Fix:** Either remove this button, or make it actually open a tmux pane with `nca auth` or `nca config` for interactive auth. If the interactive path is complex, remove the button and rely on the API key input field from Bug 1.

### Bug 3 — NCA Chat Not Working
When NCA is selected as the active provider, the chat does not work. Likely causes:
- `process.env.MINIMAX_API_KEY` not being read by the Next.js server (config.json write vs server process env)
- NCA spawning failing silently
- SSE stream not being written correctly
- Or the routing itself is broken

**Debugging steps:**
1. Verify `nca run --prompt "hello" --stream off --json --permission-mode bypass-permissions` works in a standalone terminal with the current env
2. Check server logs when a chat message is sent with NCA selected
3. Verify the SSE stream from `/api/nca/prompt` is actually being written to the response
4. Check if there's a response format issue between nca's NDJSON output and what the frontend expects

## Expected Behavior (User Experience)

1. User opens Settings → AI Agent tab
2. NCA card shows amber "Not Authenticated" with a text input labeled "MiniMax API Key"
3. User pastes their `MINIMAX_API_KEY` and clicks Save
4. Server writes key to config.json AND injects into process.env
5. `nca doctor` confirms `api_key_present: true`
6. Card flips to green "Available" (or "Authenticated")
7. User clicks the NCA card to select it
8. Chat in the studio works via NCA

## Files to Modify

- `components/SettingsModal.tsx` — add API key input field to NCA card in "Not Authenticated" state; fix/remove dead button

## Agent Assignment

| Task | Agent | Notes |
|------|-------|-------|
| Bug 1 + 2 | Designer | UI changes, input field, button fix |
| Bug 3 | Developer | Debug and fix chat routing/processing |

## References

- `app/api/nca/setup/route.ts` — already handles `POST { apiKey }` and writes to config.json + process.env
- `lib/nca-client.ts` — isAuthenticated() checks process.env directly
- `lib/nca-client.ts` — prompt() spawns `nca run --stream ndjson`
- `app/api/nca/prompt/route.ts` — SSE streaming endpoint
- QA review: `docs/bmad/qa/NCA-INTEGRATION-QA.md` (AC1-AC6)
- Existing NCA card: `components/SettingsModal.tsx` lines 780–870
