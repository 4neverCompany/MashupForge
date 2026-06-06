# Changelog

## [1.1.0] — 2026-06-06 — camofox-browser integration

### What changed
- **camofox:** bundled `@askjo/camofox-browser@1.11.2` as an optional
  second sidecar (analog to the existing Node-Next sidecar) to harden
  the web-search enrichment path against CAPTCHA waves + rate limits.
  Falls back transparently to the existing DDG/Brave path on any
  camofox failure.
- **integrations:** 5 call-sites now route through
  `withCamofoxHealth(camofoxSearch, webSearch)`:
  `app/api/{pi,mmx,nca,ai}/prompt/route.ts` (trending enrichment) +
  `app/api/web-search/route.ts` (standalone endpoint).
- **ci:** new `actions/cache@v4` step for the npm tarball; new
  `camofox_enabled: bool` input on the smoke-test workflow (default
  off); new manual `camofox-integration.yml` for the 3-scenario
  boot/crash/port-conflict test.
- **docs:** new `docs/camofox-integration.md` covering setup, runtime,
  troubleshooting, and what's intentionally NOT in v1.1.0.
- **license:** new `THIRD_PARTY_LICENSES.md` acknowledging MIT
  (camofox-browser) and MPL-2.0 (Camoufox engine) — both compatible
  with our AGPL-3.0-or-later.
- **cleanup:** dropped the dead `webSearch()` function from
  `lib/mmx-client.ts` (and its `MmxSearchResult` /
  `MmxSearchJsonResponse` types). No production caller; the only
  test that exercised it is updated.

### Migration notes
- The Rust side flips `WEB_SEARCH_FALLBACK` internally on crash
  detection (3 crashes in 5 min). The JS wrapper
  `withCamofoxHealth()` short-circuits to `webSearch()` on
  `CamofoxUnavailableError` or `CamofoxParseError`.
- The Tauri commands `camofox_status` + `set_camofox_fallback` are
  not registered in v1.1.0; the JS-side `trySetFallbackFlag()` is a
  no-op stub. Wiring the commands is a small follow-up.
- The `ai/prompt` route shows title-only enrichment lines (no
  snippets) because `camofoxSearch` returns empty snippets. A future
  release can wire the `/extract` + JSON-schema path for full
  snippets.

### Known limitations
- **Snippet extraction** (master plan §4) is not wired. The
  `ai/prompt` enrichment degrades to title-only.
- **`@pinterest_search`** is not shipped by upstream camofox v1.11.2
  (R9 in the master plan). The `buildManualSearchUrl('pinterest',
  ...)` helper is the workaround entry point; the call-site that
  uses it is a follow-up.
- **macOS / Linux Tauri builds** don't bundle camofox (Windows is
  the primary target per `docs/runbook/nsis-release.md`). The
  DDG/Brave path is used on those platforms.
- **First-run download** of the ~300 MB Camoufox binary takes 30-60s
  on cold install. The boot probe polls `/health` for 60s before
  declaring failure.

### Verification
- `cargo check` (Rust): 0 errors, 0 warnings
- `cargo test --test camofox_lifecycle`: 5 passed, 1 ignored
  (the ignored test needs injectable port lists — see test TODO)
- `bunx tsc --noEmit`: clean
- `bunx vitest run`: 1313 / 1313 pass (1289 baseline + 25 camofox
  tests - 1 deleted mmx webSearch test)
- `bunx eslint lib/camofox/ tests/lib/camofox/ app/api/{pi,mmx,
  nca,ai,web-search}/`: 0 errors

### Commits
- `2af48d3` Day 1: Tauri sidecar plumbing
- `971fcbd` Day 2: TypeScript client + Instagram integration
- `34c79e8` Day 3: remaining call-sites + dead-code cleanup
- (Day 4: CI + docs + license + version bump — see PR)

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
