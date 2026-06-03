# Changelog

All notable changes to MashupForge are documented in this file.


### 🎬 Highlights


> Hand-curated release notes. The auto-generated `### Added` / `### Fixed`
> sections below come from conventional-commit subjects; the **Highlights**
> block is the bit the user actually wants to read.

#### 🎬 Highlights

### Higgsfield AI is now a peer of Leonardo, not a replacement

MashupForge now ships with **Higgsfield** as a second image + video generation backend. Each user connects their own Higgsfield account via OAuth — no shared API key, no per-user metering headaches, no leaked-key support tickets. The user pays for their own generations through their existing Higgsfield subscription.

The integration fronts **30+ models** through a curated 7-image + 7-video surface in the Studio picker, and exposes 7 dedicated MCP tools (image gen, video gen, soul character training, cinema i2v, viral clip generator, virality predictor, video analyzer) via the same OAuth session.

**Why MCP, not REST+SDK?** The official Higgsfield YouTube tutorial (Julian Ivanov, "Claude kann jetzt Hollywood-Filme generieren") demonstrates ONLY the MCP path. Each user OAuths in with their own subscription; the server registers a public OAuth client via dynamic client registration on first connect. We preserve this as a clean multi-tenant-from-day-1 architecture — no shared key on the server, future SaaS path preserved.

### What this enables for users

- **4 new curated image models**: Nano Banana Pro (default, 4K-capable, <10¢/image), FLUX.2, GPT Image 2, Higgsfield Soul V2
- **3 new curated video models**: Seedance 2.0 (default, the "Hollywood film" model the YouTube video showcased), Kling v3.0, Veo 3.1
- **3-step character workflow** (Phase 2): lock character with feedback loop → multi-angle template (front/side/back/hands/nails) → scene still as image → video. Saves characters as "Soul Packs" reusable across video clips.
- **Per-user credit isolation**: each user has their own plan (Starter 200 / Plus 1,000 / Ultra 3,000 credits/mo). Typical weekly MashupForge run (5 images + 2 short videos) ≈ 150-200 credits — fits comfortably in the Plus plan.

### What's NOT in this release

The following are deferred to **v1.0.5+** (already researched, files in `docs/research/higgsfield-skills/`):

- **SLCT prompt framework** integration in `lib/image-prompt-builder.ts` (Surface / Lumina / Capture / Texture 4-layer structure for anti-AI-look image prompts)
- **MCSLA prompt formula** for video (Model · Camera · Subject · Look · Action)
- **Camera angles catalog** (14 angles from `camera-angles.md`: close-up 85mm, low angle 30°, OTS, POV, etc.) as a Settings picker
- **Per-cycle credit budget enforcement** (cap + running total + low-credit banner)
- **Full "long-form video with recurring character" feature** (the 3-step character template workflow above, end-to-end)

#### 🔧 Breaking changes

None. The integration is purely additive:

- New `imageProvider: 'higgsfield'` value in `GenerateOptions` (existing `'leonardo'` and `'minimax'` unchanged)
- New optional `UserSettings` fields: `defaultHiggsfieldImageModel`, `defaultHiggsfieldVideoModel`, `higgsfieldConnected`
- New OAuth keys in `config.json` (auto-populated, transparent to user)

#### 📋 Migration notes

**No action required for existing users.** Leonardo remains the default image provider. To enable Higgsfield:

1. Open **Settings → AI Engine** in the Studio
2. Click **Connect Higgsfield** (OAuth flow)
3. Grant permissions on the Higgsfield account
4. Pick default image + video models
5. The Higgsfield option appears in the per-idea provider picker

**Power users** can browse the full 35-model catalog via `npx @higgsfield/cli model list` (the CLI shares the same OAuth account).

#### 🧪 Test summary

- **1,243/1,243 tests pass** (up from 1,198 — added 45 new Higgsfield tests)
- TypeScript clean
- `next build` succeeds, all routes within 300KB gzipped first-load JS budget
- Studio: 218.2KB · Root: 214.9KB · Login: 197.1KB

#### 📚 Research artifacts (saved for future iterations)

- `docs/research/HIGGSFIELD-RESEARCH.md` — 713 lines, 13 sections (full YouTube transcript + Skills analysis)
- `docs/research/higgsfield-skills/` — 7 files (~130KB) of the Banana Pro Director + Cinema World Builder skills that informed this design

#### 🙏 Credits

Higgsfield MCP integration inspired by Julian Ivanov's YouTube tutorial on the Higgsfield + Claude + Seedance 2.0 workflow. The "Banana Pro Director" and "Cinema World Builder" Skills from the public Higgsfield skill community informed the default model picks and the deferred v1.0.5 prompt engineering work.

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
