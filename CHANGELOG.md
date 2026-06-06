# Changelog

## [Unreleased] — v1.1.0 camofox-browser integration

> CAMOFOX-CAMOUFOX-1.1.0 (2026-06-06): final v1.1.0 entry will consolidate
> the 4 days of work on Day 4. This section grows incrementally.

### Day 1 (2026-06-06) — Tauri sidecar plumbing
- **camofox:** add `scripts/fetch-camofox-browser.ps1` to fetch + cache
  `@askjo/camofox-browser@1.11.2` from npm into `src-tauri/resources/camofox/`
- **camofox:** add Rust lifecycle in `src-tauri/src/lib.rs` — `CamofoxState`,
  `WEB_SEARCH_FALLBACK` atomic, 3-stage port discovery (9377 → reuse →
  9378-9380 → fallback), boot-probe with 60s timeout, KILL_ON_JOB_CLOSE
  Job Object, tray "Beenden" kills both sidecars
- **camofox:** add 1-line CSP diff to `tauri.conf.json` for ports
  9377-9380
- **ci:** add `Fetch camofox-browser sidecar` step + `actions/cache@v4`
  to `.github/workflows/tauri-windows.yml` (after Node fetch)
- **tests:** add 5 Rust integration tests in `src-tauri/tests/camofox_lifecycle.rs`
  (1 ignored — see test TODOs)

### Day 2 (2026-06-06) — TypeScript client + first integration
- **camofox:** add `lib/camofox/client.ts` (~470 lines) — typed API,
  Zod-validated responses, 15s timeout, 3-retry exponential backoff
  (only on 5xx/429, never on 4xx), `withCamofoxHealth` wrapper,
  PII scrubber for `@currentUser`-mentions, dedicated
  `CamofoxHttp4xxError` marker so 4xx isn't retried by the catch handler
- **camofox:** add `lib/camofox/macros.ts` (14-macro list, JSON-returning
  set for Reddit, `buildManualSearchUrl` helper for the R9 Pinterest
  workaround)
- **camofox:** add `lib/camofox/zod-schemas.ts` — Zod schemas for
  /health, /tabs, /links responses
- **camofox:** add `lib/camofox/index.ts` — barrel export
- **camofox:** add `zod@4.4.3` to `package.json` dependencies
- **integration:** wire `app/api/pi/prompt/route.ts:356` through
  `withCamofoxHealth(camofoxSearch, webSearch)` — first call-site,
  transparently falls back on camofox failure
- **tests:** add 22 vitest tests in `tests/lib/camofox/client.test.ts`
  (happy path, parse errors, 5xx retry-then-fail, 4xx no-retry, Reddit
  JSON path, count clamping, Zod skip, status reachable/healthy,
  withCamofoxHealth primary/fallback, PII scrubbing)
- **tests:** add 5 vitest tests in `tests/lib/camofox/macros.test.ts`
  (14-macro count, Pinterest URL builder, R9 gap flag)

---
## [1.0.4] — 2026-06-03

### Added
- **higgsfield:** v1.0.4 — MCP-server integration as peer of Leonardo (#28)

## [0.9.48] — 2026-05-24

### Docs
- **qa:** add v0.9.47 review (1089/1089 passing)

## [0.9.47] — 2026-05-23

### Fixed
- **pipeline:** quota-aware continue-gen + calendar-analysed schedule fallback
- **trademark+style:** dedupe style hint, remove stale preflightGenericize

## [0.9.46] — 2026-05-23

### Added
- **trademark:** per-model blocklist storage
- **trademark:** 3-stage retry pipeline + user whitelist UI

### Fixed
- **prompt-enhance:** force ON, drop our-side rewrite in Manual + Pipeline
- **suggest:** accumulate STYLE_RULES matches; add explicit Ray Traced rule
- **leonardo:** honor model-spec prompt_enhance instead of hardcoding ON
- **suggest-params:** honor settings.enabledProviders, don't re-add disabled models
- **suggest-card:** resync local state when suggestion prop changes

### Docs
- refresh README for v0.9.45 with Tailwind 4.3 and Motion 12
- refresh README for v0.9.45

## [0.9.45] — 2026-05-23

### Added
- **trademark:** per-model blocklist storage
- **trademark:** 3-stage retry pipeline + user whitelist UI

### Fixed
- **prompt-enhance:** force ON, drop our-side rewrite in Manual + Pipeline
- **suggest:** accumulate STYLE_RULES matches; add explicit Ray Traced rule
- **leonardo:** honor model-spec prompt_enhance instead of hardcoding ON
- **suggest-params:** honor settings.enabledProviders, don't re-add disabled models
- **suggest-card:** resync local state when suggestion prop changes

### Docs
- refresh README for v0.9.45 with Tailwind 4.3 and Motion 12
- refresh README for v0.9.45

## [0.9.45] — 2026-05-22

### Added
- **ai:** redesign agent role — MashupForge AI co-pilot, Content Pillars / Style Tags

### Fixed
- **moderation:** history-driven trademark filter + success-path 'allowed' marking
- **scheduler:** include today as a candidate day for slot picks
- **pipeline:** inter-idea daily-cap check stops batch when horizon fills
- **moderation:** deterministic TRADEMARK retry + drop proactive pre-flight rewrite
- **infra:** EVENT-LOG-AUTO-EMIT hooks survive simple-git-hooks reinstall

## [0.9.44] — 2026-05-22

### Added
- **infra:** EVENT-LOG-AUTO-EMIT — git hooks emit to project-events.jsonl

### Fixed
- **scheduler:** depth-first fill + pre-cycle week-filled check
- **tauri:** cover loopback URLs in capability remote scope — REAL autostart ACL fix
- **moderation:** surgical TRADEMARK rewrite — only swap the name, preserve everything else

### Docs
- **bmad:** DEPS-MAJOR-RESEARCH-MAY22 — @types/node 25 + eslint 10 research

## [0.9.43] — 2026-05-21

_Internal-only release; no user-facing changes since v0.9.43._

## [0.9.42] — 2026-05-21

### Added
- **moderation:** trademark-learning store + pre-flight name rewrite
- **pipeline:** trend-driven idea generation in autonomous daemon
- **param-suggest:** thread trending context into AI parameter picker

### Fixed
- **moderation:** classification-aware retry rewrites TRADEMARK blocks
- **scheduler:** hard postsPerDay cap to stop dominant-day stacking
- **pipeline:** respect user model deselections from Studio Mode

### Docs
- **bmad:** DEPS-TS-MAJOR-MAY21 — TS 5.9.3 → 6.0.3 research

## [0.9.41] — 2026-05-21

### Fixed
- **social:** proxy uguu uploads through /api/upload (413 fix v4 / CORS fix)
- **social:** client-side uguu upload before posting (413 fix v3)
- **watermark:** JPEG 92 output instead of PNG (413 fix v2)
- **social:** skip mediaBase64 when mediaUrl is present (413 fix)
- **social:** diagnostic patch for posting non-JSON failures
- **pipeline:** surface per-model image-gen failures + lock think-strip
- **aiClient:** strip <think> blocks in streamAIToString
- **release:** scripts/release.sh now refreshes src-tauri/Cargo.lock

### Docs
- refresh README for v0.9.40
- update version badge to v0.9.40

## [0.9.40] — 2026-05-20

### Fixed
- **AUTOPOST-INVALID-DATE-FIX**: Only one future-dated post fires per trigger, not all pending posts
- **Style picker**: Hidden for non-style-supporting models via capability-driven strip
- **AI variant**: Three v0.9.38-failure guards: rule-engine baseline, explicit capability table, post-merge filter

### Features
- **System tray**: Hide-on-close + autostart support for 24/7 autoposting

## [0.9.39] — 2026-05-20

### Fixed
- **autopost:** skip scheduled posts with malformed date/time

## [0.9.38] — 2026-05-20

### Fixed
- **release:** align Cargo.toml version with package.json and tauri.conf.json

## v0.9.37 (2026-05-16)
