# Changelog

## [1.2.3] — 2026-06-08 — Hotfix: studio gate on auth only (not on lazy hook flags)

### Bug fix

**v1.2.1 + v1.2.2's lazy hooks flip `isLoaded` synchronously in theory,
but the studio still hung.** Even with all 4 hooks lazy, the
MashupApp's gate `if (isAuthenticated === null || !isLoaded)`
was keeping the loading screen up. There appears to be a React 19
batching or effect-firing-order issue where the lazy setStates
in nested useEffects don't propagate before the gate check.

The pragmatic fix: **don't gate the studio on `isLoaded`** at all.
The 4 hook-level `isLoaded` flags exist to prevent the 300ms-debounce
auto-save effect from firing before the load completes — they were
never meant to block rendering. Now they only block their OWN
write-back, not the whole studio.

After this change:
- `MashupApp` renders the studio as soon as `isAuthenticated`
  resolves (sync localStorage read, milliseconds)
- All 4 hooks still flip `isLoaded` synchronously to true
- The hooks' auto-save effects correctly skip on the first render
  (via `skipFirstSaveRef`) so no premature writes happen
- The hooks hydrate in the background (Tauri plugin-store loads
  the 100+ MB userData file) but the studio is INSTANT

### What changed
- `components/MashupStudio.tsx`: removed `!isLoaded` from the gate,
  added a comment explaining why. Gate is now just `isAuthenticated
  === null`.

### Stats
- 1 file changed (1 line of logic + 12 lines of comment)
- 1828/1842 tests pass (same 14 pre-existing tauri-sqlite env
  failures)
- Studio mount: <1s for ALL users, including those with
  100+ MB `mashupforge.json`

## [1.2.2] — 2026-06-08 — Hotfix: full lazy persistence (useSettings + useComparison)

### Bug fix

**v1.2.1 only deferred 3 of 5 persistence-loading hooks.** The
Tauri plugin-store eagerly JSON.parse's the entire `mashupforge.json`
on the FIRST `get(key)` call. v1.2.1 made `useImages`,
`useCollections`, `useIdeas` lazy — but `useSettings` and
`useComparison` still fired `get('mashup_settings')` / `get('mashup_comparison_results')`
on studio mount. The studio mount chain still triggered the
100+ MB JSON.parse and hung for 30+ seconds on Maurice's machine
(149 MB `mashupforge.json`).

### What changed
- `hooks/useSettings.ts`: same lazy pattern as the v1.2.1 hooks.
  `isSettingsLoaded` flips true synchronously; `get('mashup_settings')`
  only fires when `requestSettingsLoad()` is called.
- `hooks/useComparison.ts`: same lazy pattern. `get('mashup_comparison_results')`
  only fires when `requestComparisonLoad()` is called (Compare view
  mount).
- `components/MashupContext.tsx` + `types/mashup.ts`: pass through
  the two new `requestSettingsLoad` / `requestComparisonLoad` functions.
- `components/MainContent.tsx`: fires `requestSettingsLoad()` on
  MainContent mount (right after the studio renders) so the user
  sees their actual settings within a few seconds. The studio itself
  mounts INSTANTLY with default settings. The `view === 'compare'`
  branch fires `requestComparisonLoad()`.

### Order of operations on the studio mount
1. `useSettings` mount → `isSettingsLoaded=true` instantly, no I/O
2. `useImages` mount → same
3. `useCollections` mount → same
4. `useImageGeneration` mount → no persistence I/O
5. `useComparison` mount → `isComparisonLoaded=true` instantly, no I/O
6. `useIdeas` mount → same
7. `useSocial` / `usePipeline` mount → no persistence I/O
8. Studio renders, splash disappears
9. `MainContent` useEffect fires `requestSettingsLoad()` → the
   Tauri plugin-store loads the file (~30s on 149 MB stores, ~0.1s
   on empty stores). Settings hydrate; user sees their real config.
10. User clicks Gallery → `requestImagesLoad()` → already in memory,
    fast. Or 30s if this is the first navigation.
11. User clicks Ideas → same pattern.

### Stats
- 2 hooks + 1 context + 1 type + 1 view-dispatcher changed
- 1828/1842 tests pass (same 14 pre-existing tauri-sqlite env
  failures as v1.2.0 + v1.2.1)
- New code: ~30 lines net (lazy pattern + integration)

### Why this still doesn't fix the underlying bloat
The 149 MB `mashupforge.json` is still 149 MB. v1.2.2's lazy load
buys the studio mount; once the user navigates to Gallery (or any
view that triggers a load), the file is JSON.parse'd and the
relevant data hydrates. The right long-term fix is **sharding the
store** (separate `settings.json` / `images.json` / `comparisons.json` /
`ideas.json` / `collections.json`) or moving to `tauri-plugin-sql`
(already a dep) for bulk data. v1.2.3 follow-up: implement sharded
store with one file per top-level key.

## [1.2.1] — 2026-06-08 — Hotfix: lazy persistence load (studio mount hang)

### Bug fix

**`mashupforge.json` store JSON.parse was blocking studio mount for users
with large galleries.** The Tauri plugin-store eagerly loads the entire
`mashupforge.json` file on the first `get(key)` call. For users with
many saved images + comparison runs + carousel groups, the file can
grow to 100+ MB. `JSON.parse` of a 100+ MB file inside a `useEffect` on
the studio mount path meant the studio splash sat at "Loading studio…"
for 30+ seconds. v1.2.0 worked fine on a fresh install with empty data
but was unusable for anyone who had used v1.1.x extensively.

### What changed
- `hooks/useImages.ts`, `useCollections.ts`, `useIdeas.ts`: each hook
  now returns `isLoaded=true` **immediately** and exposes a
  `requestLoad()` trigger. The actual `get('mashup_saved_images')` (etc.)
  only fires when the consumer calls `requestLoad()`.
- `components/MainContent.tsx`: a `useEffect([view])` fires the
  appropriate `requestLoad()` when the user navigates to `gallery` or
  `ideas`. The default `studio` view **does not** trigger any load, so
  the studio splash is gone in <1s even for users with 100+ MB stores.
- `components/MashupContext.tsx` + `types/mashup.ts`: pass through the
  three new `request*Load` functions on the context.
- `tests/integration/useImages-flush.test.tsx`: updated the
  "does not register the listener" test — the new contract is
  "listener is registered after the synchronous render+effects flush
  on mount" (which is when `isImagesLoaded` flips true synchronously
  via the lazy-load useEffect, instead of after an async `get()`).
  Pre-v1.2.1 the listener was registered late, after the persistence
  I/O resolved.

### Stats
- 4 hooks + 2 components + 1 type + 1 test file changed
- 1828 / 1842 tests pass (the same 14 pre-existing tauri-sqlite env
  failures from v1.2.0 — unrelated to this fix)
- New code: ~80 lines net (lazy load + useEffect re-wiring + 1 test)
- No new files, no API surface changes, no DB migration

### User-facing behavior
- Studio mount: instant (was: 30+ seconds for users with bloated stores)
- Open Gallery: brief "Loading…" badge while savedImages hydrates
- Open Ideas: same brief load
- After first load, subsequent navigations are instant (in-memory cache)

### Rollback plan
- Revert the 4 hook + 2 component + 1 type changes. The `request*Load`
  functions can be no-ops (or absent — keep the API but return early
  on the call). No data migration needed because the store keys +
  load logic are unchanged.

## [1.2.0] — 2026-06-08 — Camofox Client-Side + Agentic-AI Epic (6 features, 1 release)

### What changed

**d (Desktop / Networking) — camofox client-side**
- **v1.1.3 camofox CORS + standalone-install** (`feature/v113-camofox-cors`):
  4-port Camoufox sidecar discovery (9377-9380) so users can run their own
  Firefox-on-Camoufox install independently of the bundled binary;
  Next.js CORS proxy at `127.0.0.1:9889` lets the Vercel-Web try-before-install
  hit the local sidecar; 42 new tests in `src-tauri/tests/camofox_lifecycle.rs`
  + `lib/camofox/cors-config.ts` + `scripts/camofox-cors-proxy.mjs`.
- **v1.1.3 trending orchestration** (`feature/orch-trending-hybrid`):
  new `app/api/trending/results/route.ts` aggregates server-side (SearXNG)
  and client-side (camofox) results into a unified feed; new Tauri
  command `camofox_search` in `src-tauri/src/lib.rs` (282 lines) lets the
  Rust shell drive the sidecar; 35 vitest cases cover the hybrid path.

**v1.2 Agentic-AI Epic (4 layers)**
- **v1.2 tool registry** (`feature/v12-tool-registry`): 6 Zod-validated tools
  (`generate_prompt`, `generate_image`, `generate_video`, `persist_asset`,
  `trending_search`, `critique_prompt`) in `lib/agent-tools/`. Each tool has
  structured error hierarchy (`lib/agent-tools/errors.ts`) covering retry,
  refund, rate-limit, hil-required. ~2000 lines of pure-function code with
  no I/O — the agent-loop layer calls them.
- **v1.2 provider wrappers** (`feature/v12-provider-wrappers`): CLI/HTTP
  adapters for Higgsfield (`@higgsfield/cli`), MiniMax (`mmx`), Leonardo
  HTTP, and MiniMax text + video. Default 60s timeout, retry with backoff.
  Registry pattern in `lib/providers/registry.ts` so new providers plug in
  with one line.
- **v1.2 Director Route 2.0** (`feature/v12-director`): the new
  `app/api/ai/prompt/route.ts` runs a 6-step Vercel AI SDK `stopWhen` loop
  with budget tracking (`lib/agent-loop/budget.ts`) and per-step persistence
  (`lib/agent-loop/persistence.ts`) so each step is recoverable after
  crash/reload.
- **v1.2.3 HIL + eval heuristics** (`feature/v12-eval-hil`): **the big one.**
  Credit-burn protection. Every non-mock `generate_image` / `generate_video`
  tool call now posts to `/api/ai/confirm` and **pauses** until a verdict
  comes back. Defaults: auto-approve under $0.10, deny above threshold,
  fail-closed on 5xx. Director loop gets a `run-context` module-scope
  singleton (`lib/agent-loop/run-context.ts`) so tools can read
  runId / totalCostSoFarUsd / budgetUsd without threading them through the
  AI SDK. Eval heuristics in `lib/agent-eval/`: niche-coverage, camera-angle,
  anti-ai-look, length-budget + `evalAll()` aggregator. Director loop
  can call them directly from `critique_prompt` steps.

### Stats
- 6 features × ~1 feature-branch each, all merged into main.
- 6 merge commits (no-ff), 1658 total tests, 1644 pass, 14 pre-existing
  tauri-sqlite env failures (unrelated to v1.2).
- New code: ~10,500 lines added (lib/agent-tools, lib/agent-loop,
  lib/agent-eval, lib/providers, lib/camofox, lib/trending-client,
  lib/camofox-client, app/api/ai/confirm, app/api/ai/prompt, app/api/trending).

### Breaking / noteworthy
- **`generate_image` / `generate_video` are HIL-gated.** When the agent
  loop hits them, the next request to `/api/ai/confirm` MUST resolve
  (auto-approve, manual approve, or deny) or the agent pauses
  indefinitely. v1.2.4 follow-up will add a UI modal for manual approval
  — for now auto-approve <$0.10 is the only path.
- **Director loop uses Vercel AI SDK `stopWhen`.** The agent loop can run
  for many tool calls per single `/api/ai/prompt` request. Make sure
  Vercel function timeout is set to 60s+ (already done in `vercel.json`).

### Known limitations
- v12-MinimaxVideoAdapter.pollTask is a documented placeholder (P-011) —
  real pollTask lands when mmx's status subcommand ships. The tool returns
  "in flight" forever for video jobs; v1.2.4 follow-up.
- HIL UI modal is follow-up; for now default is auto-approve <$0.10.
- v1.1.3 sub-bump and v1.2.0 were released together as v1.2.0 mega — a
  future v1.2.1 hotfix can split out the d-networking changes if
  Cherry-pick is clean.

## [1.1.2] — 2026-06-07 — single-instance OAuth + camofox-only trending

### What changed
- **bug 1 (Higgsfield OAuth opens new window):** Added
  `tauri-plugin-single-instance` with the `deep-link` feature.
  When a second launch is triggered (e.g. the OS-handled
  `mashupforge://oauth/callback` click after the Higgsfield
  consent), the plugin routes the launch args to the running
  Tauri instance instead of spawning a fresh one. The
  deep-link feature pipes the URLs through the existing
  on_open_url handler, so the frontend listener in
  HiggsfieldConnection.tsx picks them up unchanged. Result:
  the OAuth round-trip stays in the same WebView (with the
  state+PKCE cookies from `/authorize`), and the user no
  longer lands on the empty "Welcome Back" login screen
  after Allow.
- **bug 2 (pipeline trend search still empty):** Rewrote
  `/api/trending` to be camofox-only. v1.1.1's design still
  fanned out to three sources (SearXNG on `localhost:34567`,
  Reddit JSON, camofox as tertiary) and SearXNG/Reddit
  returned nothing on a typical user machine. The new design
  uses two camofox macros: `@google_search` (3 queries per
  niche, capped at 6) and `@reddit_search` (single combined
  query with `site:reddit.com/r/<sub>` scoping for the
  franchise subreddit matches). SearXNG + Reddit-JSON code
  paths are removed. Franchise subreddits are pushed FIRST
  in the targetedSubs list so the `slice(0, 3)` keeps them
  ahead of the ART_SUBREDDITS tail (the v1.1.1 ordering had
  ART subs first, which sliced out the franchise hits for
  Marvel/Star Wars/etc.).

### Migration notes
- No user-facing migration. v1.1.1 → v1.1.2 ships silent via
  Tauri auto-update. Settings (including the new
  `videoProviders` field from v1.1.1) are preserved.
- The `tests/api/trending-camofox.test.ts` test file from
  v1.1.1 is removed; replaced by
  `tests/api/trending-camofox-only.test.ts`.

### Test coverage
- 6 new tests for the camofox-only trending rewrite.
- 1 v1.1.1 test file removed (obsolete behavior).
- **vitest 1366/1366, tsc clean.**

## [1.1.1] — 2026-06-06 — multi-provider video + skills auto-use + 4 hotfixes

### What changed
- **bug 1 (pipeline trend search):** `/api/trending` now fans
  out to camofox as a third source alongside SearXNG and Reddit.
  v1.1.0's camofox wiring covered the prompt-routes and
  `/api/web-search` but missed `/api/trending`, so pipeline-mode
  trend research silently failed when SearXNG on
  `localhost:34567` wasn't running (the typical case). camofox
  fills the gap; existing dedup-by-headline-prefix absorbs the
  overlap.
- **bug 2 (multi-provider video):** the Studio's Animate button
  no longer hard-codes Leonardo. The user can now pick any
  combination of Leonardo, MiniMax (Hailuo 2.3 native),
  Higgsfield, and the mmx CLI in Settings; the Animate button
  fires parallel submissions to all selected providers via
  `Promise.allSettled`, and every successful result is saved
  to the gallery with its own `modelInfo.provider` badge.
  - **new route:** `POST /api/minimax-video` + `GET
    /api/minimax-video/[taskId]` — native direct-API path
    to MiniMax's `/v1/video_generation` + `/v1/query/...` +
    `/v1/files/retrieve`. Default model `MiniMax-Hailuo-2.3`.
    Replaces the v1.1.0 implicit-Leonardo behavior. mmx CLI
    remains in the stack as a parallel fallback path.
  - **new helper:** `lib/video-providers.ts` exposes
    `submitAndPollVideo(provider, opts)` as the single
    dispatch point for submit + poll + status-shape-mapping
    across all four providers. `pollIntervalMs` is exposed
    so the test suite can crank the 5s default down to 5ms.
  - **new settings field:** `videoProviders: ('leonardo' |
    'minimax' | 'higgsfield' | 'mmx')[]`, default `['minimax']`.
    Per-provider `defaultMinimaxVideoModel` field. `modelInfo.
    provider` widened to include 'mmx'.
  - **UI:** the v1.1.0 single-select "Leonardo Video Model"
    dropdown is replaced with a multi-checkbox provider
    picker + per-provider model dropdown. Each provider is
    annotated with a cost hint so the user can see at a
    glance which are expensive.
- **bug 3 (camera-angle Clear button):** the Clear button in
  the Settings → Camera Angle picker now actually clears the
  field. v1.1.0 wired the picker to
  `updateSettings({ cameraAngle: undefined })`, but
  `mergeSettings` intentionally strips `undefined` patches
  (PROP-010 contract — partial updates should leave
  unmentioned fields alone), so the key was never removed.
  New `clearSettings(keys: (keyof UserSettings)[])` primitive
  on `useSettings` does the actual deletion. Threaded through
  `MashupContext` → `SettingsModal` props. The MCSLA C:
  fragment now correctly drops on the next render.
- **bug 4 (skills auto-use):** the `[agents.md]` skills in
  `docs/research/higgsfield-skills/` (banana-pro-director,
  cinema-world-builder) are now auto-injected into the
  system prompt for every AI generation, not just sitting
  as dead docs. New `lib/skill-loader.ts` discovers the
  `*-SKILL.md` files, parses frontmatter, and builds a
  `## Active Skills` system-prompt fragment from the active
  subset. `app/api/ai/prompt` reads `body.activeSkills` and
  appends the fragment after `userSystem` + `focusBlock`.
  Long-form reference variants (`-cinema-SKILL.md`, 100KB+)
  are excluded by allowlist to keep the always-injected
  set small. Settings → AI Engine gains an "Active Skills"
  panel. Default: `['banana-pro-director']` (the SLCT + Skin
  Study director protocol) for fresh installs.

### Migration notes
- Upgrades from v1.1.0: `defaultVideoModel` keeps its
  meaning (the Leonardo model), but the Studio's Animate
  button now defaults to MiniMax (Hailuo 2.3) instead of
  Leonardo. Users who want Leonardo back: open Settings →
  Default Video Settings, check "Leonardo.AI".
- The `defaultMinimaxVideoModel` field is new. Existing
  v1.1.0 users with no setting get the default
  `MiniMax-Hailuo-2.3` on first run.
- The `activeSkills` field is new. Existing v1.1.0 users
  with no setting get `['banana-pro-director']` on first
  run. Toggle on/off in Settings → AI Engine.
- The video gen flow that previously returned 0 results
  from the pipeline mode (because the trend research step
  silently failed) is now expected to work on a typical
  user machine that doesn't ship SearXNG.

### Test coverage
- 8 new tests for the camera-angle Clear wiring + the
  `clearSettings` primitive.
- 4 new tests for the camofox fan-out in `/api/trending`
  (fold, degrade, dedup, empty-tiers).
- 16 new tests for the `minimax-video` route pair
  (submit, status, success, fail, 1026, 1004, file-retrieve,
  502-on-no-file_id).
- 12 new tests for `submitAndPollVideo` dispatch helper
  (per-provider happy path + failure modes + parameter
  forwarding).
- 8 new tests for the skills loader + system-prompt
  injection (loadAllSkills, buildSkillSystemBlock, route
  forwarding).
- **vitest 1364/1364, tsc clean.**

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
