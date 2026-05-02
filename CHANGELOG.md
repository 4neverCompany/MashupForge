# Changelog

All notable changes to MashupForge are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
