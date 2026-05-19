# Changelog

All notable changes to MashupForge are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## v0.9.34 (2026-05-19)

PROV-AGNOSTIC-PARAMS lands end-to-end: a vercel-ai user can now select MiniMax-M2.7 in Settings and idea-mode chats automatically run at temperature 0.95 / maxTokens 8192 with niches + genres injected, while pi/nca/mmx users see no behavioural change. Architecture doc: `docs/bmad/briefs/PROV-AGNOSTIC-PARAMS.md`.

### Features
- feat(model-specs): provider tagging schema + new `lib/model-specs/minimax-image-01.json`. Every existing spec carries a `provider` field (Leonardo for the 8 pre-existing image/video models, MiniMax for the first non-Leonardo entry). New `getModelProvider()` + `getModelSpecsByProvider()` helpers feed P2/P3.
- feat(ai): engine provider-awareness + new `lib/text-model-specs.ts`. `suggestParameters` accepts an optional provider filter (back-compat: undefined leaves the engine in its prior all-providers mode). Text-gen params now have a typed home — six initial specs across MiniMax (M2.5 / M2.7 / M2.7-highspeed), OpenAI (gpt-4o-mini), Anthropic (claude-3-haiku), OpenRouter (openai/gpt-4o-mini) with shared per-mode temperature profile (idea 0.95, chat 0.8, generate 0.6, caption 0.7, enhance 0.5, tag/neg-prompt 0.3). `/api/ai/prompt` + `/api/ai/image` thread the params into both the MiniMax direct-fetch branch (snake_case `temperature` / `max_tokens` / `top_p`) and the `streamText` branch (camelCase).
- feat(settings): Default Text Model picker + Image Model `<optgroup>` grouping. New "Default Text Model" dropdown renders only when `activeAiAgent === 'vercel-ai'`, optgroup'd by provider in the route's `resolveProvider` priority order. The image dropdown is renamed "Default Image Model" and gains provider-grouping `<optgroup>` blocks (Leonardo bucket first). New `settings.activeTextModel` field forwards through every streamAI callsite (Sidebar / useSocial / useImageGeneration / useCollections / MainContent) into `body.model`, which the route's `resolveProvider` already accepts as the model override.

## v0.9.33 (2026-05-17)

### Features
- feat(ai): WebSearch pre-enrichment now applies to `chat` mode as well as `idea` mode — vercel-ai chat answers can ground on recent web results. The user's message itself is used as the search query (capped at 400 chars; sub-8-char messages skip enrichment to avoid latency on greetings); top-3 DDG/Brave snippets are appended with a "Recent web context for the question above" label.

### Fixes
- fix(ai): MiniMax image generation no longer silently fails in the browser — MiniMax's `image_generation` endpoint returns Aliyun OSS signed URLs over plain http with a scheme-locked signature, which browsers refuse to load on the https production page (mixed-content). `/api/proxy-image` now allowlists `.aliyuncs.com` with a narrow http-permitted branch, and `/api/minimax-image` wraps every returned URL through the proxy so the frontend gets same-origin https paths.
- fix(ai): caption generation under vercel-ai/MiniMax-M2.5 no longer silently returns nothing — reasoning models prefix output with literal `<think>…</think>` blocks before the actual JSON, which the bare `JSON.parse` in `useSocial.ts` threw on. New `stripThinkBlocks` helper in `lib/aiClient.ts` is threaded into `parseJsonFromLLM`, so every `extractJsonObjectFromLLM` / `extractJsonArrayFromLLM` caller (Sidebar idea list, pipeline daemon, MainContent prompt parsing, captioning) transparently handles reasoning-model output.

## v0.9.32 (2026-05-16)

### Fixes
- fix(ui): show warning banner in vercel-ai Settings card when no API key is configured — prevents silent 503 on first chat for fresh installs. Banner names the required env vars (MINIMAX_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, OPENROUTER_API_KEY) and disappears once any key is detected.

## v0.9.31 (2026-05-13)

### Features
- feat(ai): add vercel-ai SDK provider — direct API streaming via Vercel AI SDK, no subprocess. New /api/ai/prompt and /api/ai/status routes. MiniMax first-priority provider (matches nca default); falls back to OpenAI → Anthropic → OpenRouter.
- feat(ai): MiniMax as first-priority vercel-ai provider with MiniMax-M2.5 default model

### Fixes
- fix(social): add runtime=nodejs to all queue/cron routes (crypto.timingSafeEqual + @upstash/redis are Node-only). Adds /api/social/instagram-refresh endpoint for token renewal. vercel.json cron config. cron-fire warns in logs when Instagram token < 10 days from expiry.

## [0.9.30] — 2026-05-05

### Fixed
- **scheduler:** forward credentials through cron-fire path
- **settings:** mutually exclude nca and pi.dev setup flows
- **settings:** NCA api-key form visibility gaps post-NCA-SETUP-UI-FIX

## [0.9.29] — 2026-05-05

### Fixed
- **tooling:** exclude src-tauri/target from tsconfig

## [0.9.27] — 2026-05-02

### Fixed
- **ci:** handle nca Windows build failure gracefully (continue-on-error on throw)
- **ci:** tolerate nca Windows build failure (upstream is Unix-only)

## [0.9.26] — 2026-05-02

### Added
- **nca:** bundle nca.exe inside the Windows installer (NCA-BUNDLE)

### Docs
- **QA:** NCA-INSTALL-QA report — CONCERNS 0.81, W-1 pre-empted by 4b367be

## [0.9.25] — 2026-05-02

_Internal-only release; no user-facing changes since v0.9.24._

## [0.9.24] — 2026-05-02

### Added
- **nca:** add install flow UX to settings (NCA-INSTALL-DESIGN)
- **nca:** add /api/nca/models route (NCA-INSTALL-DEV)

### Fixed
- **nca:** show hoisted CTA only when pi is active, not nca (QA W-1)

## [0.9.23] — 2026-05-02

### Added
- **nca:** update settings UI for nca provider (NCA-INTEGRATION-DESIGN)
- **nca:** replace broken mmx CLI with nca for chat (NCA-INTEGRATION-DEV)

### Fixed
- **mmx:** two bugs in text chat flow

### Docs
- **changelog:** v0.9.23 — nca integration (NCA-INTEGRATION)
- **changelog:** v0.9.22 entry for mmx chat fix

## [0.9.23] — 2026-05-02

### Added
- **nca:** new second AI provider — `nca` (native-cli-ai, Rust binary) replaces broken mmx chat path. Same MiniMax provider via `MINIMAX_API_KEY`. Clean ndjson subprocess contract, model selection via `NCA_MODEL` env var (default: MiniMax-M2.5, also M2.7 / M2.7-highspeed). `mmx` kept as back-compat alias for `nca` (NCA-INTEGRATION)

### Changed
- **settings:** renamed MMX card to nca, updated status text, added model display

## [0.9.22] — 2026-05-02

### Fixed
- **mmx:** stdin format `{ messages }` → bare array `[...]`; removed `--stream` flag (mixed SSE+JSON); now collect full stdout and parse as one JSON object (MMX-CHAT-STREAM-FIX)

## [0.9.21] — 2026-05-01

### Fixed
- **mmx:** stop auto-running broken OAuth flow (MMX-OAUTH-ERROR-FIX)

### Docs
- **qa:** MMX-CARD-VPASS-QA re-review — W-A fixed, status PASS (0.93)

## [0.9.20] — 2026-04-30

### Fixed
- **settings:** remove dead OAuth link, point users at API-key page (MMX-OAUTH-404-FIX)

## [0.9.19] — 2026-04-30

### Fixed
- **mmx:** spawn .cmd shims via shell + stop claiming success on pending auth

## [0.9.18] — 2026-04-30

### Fixed
- **mmx:** Windows install path resolution — PATH separator + .cmd shim

### Docs
- **qa:** MMX-CARD-VPASS-QA review report (CONCERNS — W-A already fixed)

## [0.9.17] — 2026-04-30

### Added
- **mmx:** paste API key in Settings to authenticate without tmux
- **mmx:** card click opens full MMX CLI for provider/model setup

### Fixed
- **settings:** preserve OAuth casing in MMX terminal-link copy
- **settings:** MMX install button visible + clickable during loading
- **settings:** show MMX install button regardless of active agent

### Changed
- **settings:** MMX card UX visual pass (MMX-CARD-VPASS-001)

### Docs
- **briefs:** MMX-CARD-VPASS-QA brief for visual-pass review
- **briefs:** MMX-AGENT-CARD-UX-VISUAL-PASS brief from Hermes

## [0.9.16] — 2026-04-30

### Added
- **mmx:** auto-install mmx-cli when not found on setup button click
- **model-specs:** add gpt-image-2 + drop deprecated `mode` param

### Fixed
- **mmx:** add macOS Homebrew npm fallbacks to auto-install resolver (QA W-B)
- **settings:** address QA W-1 + W-2 on MMX card

### Docs
- **qa:** MMX auto-install 3-state verify report
- **briefs:** MMX auto-install 3-state QA verify brief
- **discoveries:** IG scheduled posts fail — wrong token type on Vercel
- **discoveries:** record sched-post 401 root cause + fix
- **qa:** add MMX-CARD-SETUP-FIX review report

## [0.9.12] — 2026-04-29

QA-driven cleanup release: clears the MMX + calendar warnings (W1–W5)
surfaced in the v0.9.11 review and adds regression coverage for the
calendar UX fixes.

### Fixed
- **mmx-cli:** surface `PARSE` errors when the CLI exits 0 with empty
  stdout instead of swallowing them (QA-W1).
- **calendar:** remove the instant Delete button from the edit popover
  — the Cancel/Delete confirmation flow on the trash zone is the only
  destructive path now.
- **calendar:** Escape closes the trash-confirm modal (QA-W4).

### Docs
- **sunday-recap:** document the runner-local artifact paths the cron
  workflow writes to (QA-W2).
- **image-prompt:** document the `buildEnhancedPrompt` wiring follow-up
  for the MMX provider path (QA-W3).

### Tests
- **calendar:** regression tests pinning Fix 3 (trash zone behaviour),
  Fix 4 (chip thumbnails), and the QA-W4 Escape close (QA-W5).

### Not in this release
- Full MMX CLI integration (image / video / speech). The spec lives in
  `docs/bmad/briefs/mmx-cli-integration.md`; implementation is pending.
