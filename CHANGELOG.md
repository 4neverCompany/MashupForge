# Changelog

All notable changes to MashupForge are documented in this file.

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
