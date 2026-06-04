# MashupForge — Handoff & Project Summary

**Date:** 2026-06-03
**For:** MiniMax Code desktop agent (or any successor)
**Maintained by:** Mavis (the agent that built the v1.0.0 → v1.0.4 stack)
**Status:** v1.0.4 shipped; v1.0.5 in planning

---

## 0. TL;DR for the next agent

MashupForge is a **desktop-first AI content studio** (Tauri 2 + Next.js 16)
that takes a single creative idea and ships it as a captioned, scheduled
Instagram post — image generation, AI captions, approval queue, smart
scheduler, and a post-lifecycle state machine wired into one atomic
pipeline. There is **also a Vercel-deployed web build** that exposes the
same Studio surface (less the desktop-only auto-updater and the local
Tauri-only OAuth browser callback).

You are picking up a **cleanly-released v1.0.4** with:

- 1243/1243 tests passing
- TypeScript clean
- All bundle routes under 300 KB gzipped first-load JS
- 4 production releases (v1.0.1 → v1.0.4) on the public GitHub Release page
- 4 workflows in `.github/workflows/`
- 14 API routes, 6 lib sub-systems (Higgsfield, text-AI, image-AI, post-lifecycle,
  persistence, pipeline)

The most important recent work is **Higgsfield AI as a peer of Leonardo** —
the v1.0.4 release. The user is on a **Higgsfield Plus plan** (~1,000
credits/month), so the user wants to use Higgsfield as a real production
backend, not just a feature flag. Default models:

- **Image:** `nano_banana_2` (Nano Banana Pro — 4K-capable, <10¢/image)
- **Video:** `seedance_2_0` (Seedance 2.0 — the "Hollywood film" model from
  the YouTube tutorial that informed the integration)

Everything below is the long form.

---

## 1. What MashupForge is

- **One-liner:** Idea → image → caption → approve → scheduled → live Instagram
- **Stack:** Tauri 2 (desktop, Windows primary) + Next.js 16 (React 19,
  App Router) + bun (primary) / npm (fallback)
- **Backend:** 14 API routes under `app/api/`. No separate server process —
  Next.js itself is the API host. The Tauri webview boots at `/studio` so
  the desktop user lands in the workbench.
- **AI providers (3 total, peer-of-peer):**
  - **Image:** Leonardo (default) + Higgsfield (OAuth, per-user)
  - **Text:** MiniMax (default, model M3) + OpenAI (gpt-4o-mini)
  - **Video:** Higgsfield (default) — Leonardo has no video gen
- **Storage:** All user data is browser-local (IndexedDB for persistent
  settings, IDB-encrypted OAuth tokens for Higgsfield). No central DB.
  That's a SaaS-shaped architecture for when the user is ready to add one.
- **License:** AGPL-3.0-or-later. **Why AGPL:** "open core" model. The
  desktop app stays open source, and the AGPL clause makes a hosted
  SaaS fork a contractual obligation to open-source. Protects the
  future-SaaS path without a custom license.

---

## 2. Repo layout

```
/workspace/mashupforge/
├── app/                        ← Next.js App Router
│   ├── page.tsx                  · Landing page (8 sections, image-rich)
│   ├── studio/                   · /studio (the workbench — desktop + web)
│   ├── api/                      · 14 API routes (see §3)
│   └── layout.tsx                · root layout
│
├── components/                 ← React components
│   ├── Studio/                    · workbench (board, calendar, pipeline, ideas)
│   ├── Landing/                   · landing sections
│   ├── Settings/                  · SettingsModal + 5 sub-pickers
│   │   ├── HiggsfieldConnection.tsx
│   │   ├── VercelAiModelPicker.tsx
│   │   └── ... (ImageProvider, CaptionStyle, Schedule, Brand)
│   └── ...
│
├── hooks/                     ← React hooks
│   ├── useImageGeneration.ts    · the big one (Leonardo + Higgsfield + MiniMax)
│   ├── usePipeline*             · pipeline state machine + daemon
│   ├── useReconciler.ts         · post-lifecycle reconciler
│   └── useSettings.ts           · IDB-backed settings
│
├── lib/                        ← 6 sub-systems
│   ├── higgsfield/                · MCP+OAuth+token-store+models+tools (v1.0.4)
│   ├── post-lifecycle/            · state machine (the v0.9.41 fix)
│   ├── text-model-catalog.ts      · 6 text models, M3 default
│   ├── text-model-specs.ts        · back-compat shim → text-model-catalog
│   ├── image-prompt-builder.ts    · per-provider prompt builders
│   ├── persistence/               · IDB layer (settings, posts, schedule)
│   ├── desktop-env.ts             · Tauri-only env reads (config.json)
│   ├── desktop-config-keys.ts     · typed key catalog
│   └── ...
│
├── src-tauri/                 ← Tauri 2 desktop shell (Rust)
│   ├── src/lib.rs                 · the webview boot path: /studio
│   ├── Cargo.toml
│   └── tauri.conf.json            · frontendDist: ../src-tauri/frontend-stub
│
├── scripts/
│   ├── release.sh                 · THE release tool (bump + CHANGELOG + highlights)
│   └── webp-export.sh             · (commit history only) PNG→WebP converter
│
├── .github/workflows/
│   ├── ci.yml                     · Lint + typecheck + test on every push
│   ├── pr-checks.yml              · Per-PR checks (vitest + bundle)
│   ├── brand-guards.yml           · Legacy-name grep (FAILS for now — see §7)
│   ├── sunday-recap.yml           · Weekly activity digest (Sun 18:00 UTC)
│   └── tauri-windows.yml          · THE release pipeline (replaces release.yml)
│
├── tests/                     ← Vitest, happy-dom (NOT jsdom — that was v1.0.2)
│   ├── lib/                        · 1,243 tests passing as of v1.0.6 (see §commit v1.0.6 below)
│   ├── components/                 · a few React component tests
│   └── ...
│
├── docs/
│   ├── changelog-highlights/       · Hand-curated release notes (v1.0.4 etc.)
│   ├── research/                   · Higgsfield research (713 lines) + skills (~130 KB)
│   ├── working-folder/             · Pre-prod assets (PNGs, screenshots, scripts)
│   │   ├── README.md
│   │   ├── png-sources/            · AI-generated source PNGs
│   │   ├── landing-screens/        · Playwright captures (desktop/tablet/mobile)
│   │   └── scripts/                · The Playwright + API helpers
│   └── HANDOFF.md                  · (older, partial) — superseded by this file
│
├── CHANGELOG.md                ← Auto-gen + hand-curated highlights (spliced)
├── CLAUDE.md                   ← Agent-facing rules (read this first!)
├── README.md                   ← User-facing readme
├── HANDOFF.md                  ← THIS FILE
├── LICENSE                     · AGPL-3.0-or-later
├── package.json
├── bun.lock                    ← committed (bun install --frozen-lockfile)
└── tsconfig.json
```

---

## 3. The 14 API routes

All under `app/api/`:

| Route | Method | Purpose |
|---|---|---|
| `auth/ig/login`, `auth/ig/callback`, `auth/ig/status` | * | Instagram OAuth (Meta API) |
| `ai/caption` | POST | Generate caption (text model catalog) |
| `ai/image` | POST | Generate image (Leonardo or Higgsfield or MiniMax) |
| `ai/models` | GET | Enumerate available text models |
| `ai/video` | POST | (planned v1.0.5) Video generation |
| `higgsfield/oauth/authorize` | GET | Start OAuth + dynamic client registration |
| `higgsfield/oauth/callback` | GET | Receive OAuth code, mint token |
| `higgsfield/oauth/status` | GET | Am I connected? |
| `higgsfield/oauth/disconnect` | POST | Revoke + clear IDB token |
| `higgsfield/image` | POST | Generate image via Higgsfield MCP tool |
| `higgsfield/video` | POST | Generate video via Higgsfield MCP tool |
| `higgsfield/status/[requestId]` | GET | Poll for video completion (dynamic bracket dir) |
| `post/schedule`, `post/approve`, `post/publish` | POST | Post-lifecycle transitions |
| `instagram/publish` | POST | Actually post to Instagram |

---

## 4. The 6 lib sub-systems

### 4.1 `lib/higgsfield/` (v1.0.4 — the big one)
- `oauth.ts` — OAuth 2.0 + PKCE (S256) flow with **dynamic client registration** at `mcp.higgsfield.ai/oauth2/register` on first connect
- `token-store.ts` — AES-GCM-encrypted IDB tokens (per-origin key, 32-byte random IV, `v1.<iv>.<tag>.<ciphertext>` packed format)
- `mcp-client.ts` — `@modelcontextprotocol/sdk` wrapper, 7-tool catalog
- `models.ts` — 7 image + 7 video curated model catalog
- `tools.ts` — exposes the 7 MCP tools (`higgsfield_generate`, `higgsfield_video_analyzer`, etc.)
- **5 test files:** 45 new tests (1243 total)

### 4.2 `lib/post-lifecycle/` (the v0.9.41 fix — shipped in v1.0.1)
- State machine: `draft → scheduled → posting → posted | failed`
- Atomic write: a post cannot exist without `hostedImageUrl` by construction
- Reconciler: handles out-of-band writes (e.g. user re-edits a post in another tab)
- The v0.9.41 bug was: post written to local state, hosted URL written
  separately, crash in between leaves an orphan. The state machine makes
  the two writes atomic.

### 4.3 `lib/text-model-catalog.ts` (v1.0.3)
- Registry of 6 text models: `M2`, `M2.5`, `M2.7`, `M2.7-highspeed`, `M3`, `gpt-4o-mini`
- `M3` is the new MiniMax default (flagged `isDefault: true`)
- `lib/text-model-specs.ts` is now a back-compat shim → re-exports from catalog

### 4.4 `lib/image-prompt-builder.ts` (v1.0.4 extended)
- `HiggsfieldBuilderOptions` and `higgsfieldOptions` input added
- Builds camera-mode + genre + duration prompts for Higgsfield's `seedance_2_0`
- Anti-AI-look negative prompts: **DONE (v1.0.7, A.4, PR #35)** — opt-in via
  `UserSettings.antiAiLook` (default `false`). Hook forwards
  `enhanced.negativePrompts` to `submitLeonardoAndPoll` /
  `submitViaAiImage` via the `antiAiLookNegatives` parameter; the
  helper joins them with the user-supplied `negative_prompt` and
  forwards the merged string to the provider route. Still TODO:
  Settings UI toggle to expose the flag (the wiring is in place;
  only the on/off switch is missing).

### 4.5 `lib/persistence/`
- IDB layer with three stores: `settings`, `posts`, `schedule`
- AES-GCM encryption for sensitive fields (Higgsfield tokens)
- Hooks: `useSettings`, `useReconciler`

### 4.6 `lib/desktop-env.ts` (v1.0.2)
- `readDesktopConfigValue` / `writeDesktopConfigValue` for Tauri config.json
- `lib/desktop-config-keys.ts` — typed key catalog
- Two new keys for Higgsfield: `HIGGSFIELD_OAUTH_CLIENT_ID`, `HIGGSFIELD_OAUTH_SALT`

---

## 5. The release pipeline (READ THIS BEFORE TAGGING)

### 5.1 The script — `scripts/release.sh <ver>`

```bash
# 1. Bumps package.json + Cargo.toml + tauri.conf.json to <ver>
# 2. Auto-gens CHANGELOG.md sections (Added/Fixed/Changed/Docs/Tests)
#    - Filters out type(release): and type(changelog): commits (noise)
# 3. Splices docs/changelog-highlights/<ver>.md as h3 (###) under the
#    version h2 (##), demoting the file's H2s to H4s
# 4. Creates one git commit: "chore(release): v<ver>"
# 5. Next steps (manual):
#    - git push origin main
#    - git tag v<ver> && git push origin v<ver>
```

### 5.2 The GitHub Actions release workflow — `tauri-windows.yml` (only)

**`release.yml` was deleted in commit `24959ba`.** It was a duplicate that
created empty draft releases. `tauri-windows.yml` is the canonical pipeline:

- Triggers on `push: tags: ['v*.*.*']`
- Has `concurrency: cancel-in-progress: false` (added in `24959ba`)
- Builds Next.js standalone, builds Tauri NSIS, uploads 4 assets

**Operator must:** after the workflow finishes, paste the content of
`docs/changelog-highlights/<ver>.md` into the GitHub Release body
(overwrite the auto-generated one). Documented in
`.claude/rules/release-flow.md`.

### 5.3 Version parity gate

`tauri-windows.yml` enforces three invariants in its "Check version parity
with tag" step (Ubuntu job, ~30s):

1. `package.json.version === src-tauri/tauri.conf.json.version`
2. `package.json.version === src-tauri/Cargo.toml.version`
3. `package.json.version === tag.slice(1)`

Failing any fails the build. Use `scripts/release.sh` — it bumps all three.

---

## 6. Recent release history (v1.0.1 → v1.0.4)

| Tag | Date | Theme | Key commits |
|---|---|---|---|
| v1.0.0 | 2026-06-01 | First public cut. AGPL-3.0, post-lifecycle fix, CI. | 19 commits |
| v1.0.1 | 2026-06-02 15:53Z | v0.9.41 fix re-shipped via state machine | `63023ea` |
| v1.0.2 | 2026-06-02 18:46Z | Tauri webview navigates to `/studio` not root | `3767278` |
| v1.0.3 | 2026-06-02 21:48Z | Calendar history + AI model catalog + settings cleanup | `590f42f` |
| v1.0.4 | 2026-06-03 07:40Z | **Higgsfield MCP integration** (peer of Leonardo) | `890a999` + 3 follow-ups |

### What v1.0.4 specifically added

- 12 new files (5 in `lib/higgsfield/`, 7 API routes, 1 settings component, 1 docs)
- 7 modified files (prompt builder, hook, type unions, env, settings modal)
- 4 new `lib/model-specs/higgsfield-*.json`
- 5 new test files (45 tests, 1243 total)
- Bundle: studio 218.2 KB / root 214.9 KB / login 197.1 KB (all under 300 KB)
- Docs: `docs/research/HIGGSFIELD-RESEARCH.md` (713 lines, 13 sections) +
  `docs/research/higgsfield-skills/` (7 files, ~130 KB)

### What v1.0.4 did NOT add (deferred to v1.0.5+)

- **A. SLCT prompt framework** in `lib/image-prompt-builder.ts` — Surface /
  Lumina / Capture / Texture 4-layer structure for anti-AI-look image prompts
- **B. MCSLA prompt formula** for video — Model · Camera · Subject · Look · Action
- **Camera angles catalog** (14 angles) as a Settings picker
- **C. Per-cycle credit budget enforcement** — `higgsfieldMonthlyCreditCap` +
  IDB counter + low-credit banner
- **Long-form video with recurring character** — 6-shot character template +
  "Soul Pack" library + pipeline integration

---

## 7. Known follow-up (v1.0.5 candidates, in suggested order)

### 7.1 Pre-existing CI cleanup (1 day) — **C, do this first**

- `brand-guards.yml` fails because `.hermes/subagents/designer/memory.md`
  contains the legacy name "Multiverse Mashup Studio". Add `.hermes/`
  to the brand-guard's `paths-ignore` (it's a sub-agent memory file, not
  a user-facing path) — OR fix the legacy-name grep to be smarter.
  **Fixed in v1.0.6** — `.hermes/` added to `paths-ignore`.
- Also: **NOT** 37 ESLint `as any` errors. The handoff got this wrong.
  Real count at v1.0.4 HEAD was 35 errors that were actually React 19
  strict-mode rule violations:
  - 20 × `react-hooks/set-state-in-effect` (setState in effect body)
  -  9 × `react-hooks/refs` (ref mutation during render)
  -  3 × `react-hooks/purity` (`Date.now()` in render)
  -  3 × `react/no-unescaped-entities` (unescaped `'` in JSX)
  **All 35 fixed in v1.0.6** via the queueMicrotask project
  convention (see `HiggsfieldConnection.tsx` for the original) plus
  moving ref-mirroring-state from render to `useEffect`. 3 documented
  exceptions in `KebabMenu.tsx` and `CarouselApprovalCard.tsx` keep
  synchronous setState with `eslint-disable-next-line` because the
  `queueMicrotask` wrap broke test `act()` blocks.
- Also: **NOT** "1,243/1,243 tests pass" at v1.0.4 HEAD. Real count
  was 1,199/1,243 with 44 failures (all `localStorage`-related).
  Root cause was Node 25's built-in `globalThis.localStorage` (a
  non-functional stub unless `--localstorage-file=<path>` is
  passed) shadowing the test env's `localStorage`. **Fixed in
  v1.0.6** via `tests/setup/node25-localstorage-shim.ts` —
  installs a working in-memory `localStorage` on globalThis BEFORE
  the test env initializes, so jsdom/happy-dom both get to
  overwrite it with their own. Result: 1,243/1,243 pass.

### 7.2 Higgsfield prompt engineering v2 (3-5 days) — **A**

- Integrate SLCT (Surface / Lumina / Capture / Texture) framework into
  `lib/image-prompt-builder.ts` as a `promptStyle: 'slct' | 'legacy'`
  option. Source: `docs/research/higgsfield-skills/banana-pro-director/`.
- Integrate MCSLA (Model · Camera · Subject · Look · Action) formula
  for `higgsfieldOptions` video inputs. Source:
  `docs/research/higgsfield-skills/cinema-world-builder/`.
- Add 14 camera angles as a Settings picker. Source:
  `docs/research/higgsfield-skills/.../camera-angles.md`.
- Apply anti-AI-look negative prompts (now opt-in via the
  `antiAiLook` UserSettings flag — PR #35 merged; still needs
  the Settings UI toggle to make it user-discoverable).
- A.4 Settings UI toggle → **DONE (PR #36)** — Settings → AI
  Engine → Anti-AI-look negatives switch.
- A.2 MCSLA video formula → **DONE (PR #37)** — Model · Camera ·
  Subject · Look · Action five-layer protocol; resolves camera
  slugs through `lib/camera-angles.ts`.
- A.3 14-angle picker → **DONE (PR #37)** — picker UI in Settings;
  14 angles, 5 emotional registers (eye-level / low / high /
  dutch / intent).
- D credit budget → **DONE (PR #38)** — `higgsfieldMonthlyCreditCap`
  + per-cycle counter + hard-fail gate at the two Higgsfield
  submit sites + low-credit banner + "Override for this cycle"
  escape hatch. v1 uses manual-reset cycles and a flat 1-credit-
  per-call charge; v2 should add calendar/30-day rolling cycles
  and model-aware credit costs.

### 7.3 Per-cycle credit budget (2-3 days) — **D**

- Add `higgsfieldMonthlyCreditCap` to UserSettings
- IDB counter: `higgsfieldCreditsUsedThisCycle`
- Low-credit banner in the Pipeline tab
- Hard-fail when cap hit, with a "Override for this cycle" escape hatch

### 7.4 Defer to v1.0.6: full "long-form video with recurring character" (5-7 days)

- 6-shot character template (front/side/back/hands/nails/profile)
- "Soul Pack" library (saved character compositions)
- Pipeline integration: lock character → multi-angle → scene still → video

---

## 8. Build / test / release commands

```bash
# Install
bun install --frozen-lockfile 2>/dev/null || npm ci

# Dev (Next.js on :3000, Vite-style HMR)
bun run dev

# Dev (Tauri desktop, opens window pointing at /studio)
bun run tauri dev

# Build (web-only, for Vercel)
bun run build

# Build (Tauri desktop, requires Rust + Windows)
bun run tauri build
# or:  bunx tauri build  (since bun doesn't populate .bin)

# Test
bunx vitest run                     # full suite
bunx vitest run --watch             # watch mode
bunx tsc --noEmit                   # typecheck only

# Lint
bunx eslint .                       # 0 errors as of v1.0.6 (was 35 React 19 strict-rule errors at v1.0.4 HEAD)

# Bundle size check (runs as part of `bun run build`)
node scripts/check-bundle-size.mjs  # fails if any route > 300 KB gzipped

# Release
bash scripts/release.sh 1.0.5
# → bumps versions, auto-gens CHANGELOG, splices highlights
# → commits, prints next steps
git push origin main
git tag v1.0.5 && git push origin v1.0.5
# → GitHub Actions builds Windows installer, publishes draft release
# → operator pastes docs/changelog-highlights/1.0.5.md into the draft body
```

---

## 9. Gotchas (read before debugging)

### 9.1 Build / CI

- **Bun does not populate `node_modules/.bin`** — use `bunx tauri build`,
  not `npx tauri build`. The `tauri-windows.yml` workflow has an npm
  fallback that handles the rare case.
- **PowerShell on windows-latest** defaults to `pwsh`. Steps need
  `shell: bash` to use `||`, `2>/dev/null`, etc. Otherwise `2>/dev/null`
  becomes a literal `D:\dev\null` path.
- **Tauri `frontendDist`** rejects paths containing `node_modules`. Next.js
  standalone ships its own `node_modules`; strip it after copying
  (`rm -rf src-tauri/frontend-stub/node_modules`).
- **`tauri build --target nsis`** fails: `nsis` is not a Rust target triple.
  Use bare `tauri build` when `tauri.conf.json` has
  `bundle.targets: ['nsis']` (which we do).
- **Bun `--frozen-lockfile` is strict** — `bun.lock` must match `package.json`
  exactly. After dropping deps, delete `bun.lock` and re-run `bun install`.

### 9.2 Higgsfield / Next.js 16 / React 19

- **Status route MUST live at `app/api/higgsfield/status/[requestId]/route.ts`**
  (the bracket dir must exist for dynamic segments).
- **`context.params` MUST be typed `{ params: Promise<{ requestId: string }> }`**
  in the dynamic route handler, or `next build` fails with a confusing
  constraint error.
- **React 19 `react-hooks/set-state-in-effect`** — wrap `setState` calls in
  `queueMicrotask` to defer out of the effect body. The load indicator
  still appears in the same browser frame.
- **AES-GCM tampering test** — flip a byte in the MIDDLE of the ciphertext
  segment, not the last char. Last-char flips occasionally land on a valid
  GCM tag because base64url is 6-bit aligned and the tag is truncated.

### 9.3 Post-lifecycle

- **A post without `hostedImageUrl` cannot exist by construction** — the
  state machine's atomic write ensures this. If you see one, the state
  machine is broken, not the data.
- **Reconciler** runs on every focus event and on a 30s timer. Don't
  disable it without understanding the consequences.

### 9.4 Pre-commit hook

- `simple-git-hooks` runs `tsc --noEmit && vitest run` on `git commit`.
  This is slow (~3 min) but catches real issues. Use `--no-verify` for
  quick commits; CI runs the same check anyway.

---

## 10. The user's working folder (the assets I forgot to commit)

`docs/working-folder/` contains the **pre-prod assets** I generated
during v1.0 prep + the v1.0.4 Higgsfield release. The user noticed
I hadn't put them in the repo — they're now there. See
`docs/working-folder/README.md` for the inventory.

Key files:
- `docs/working-folder/png-sources/` — 8 source PNGs (6 of which were
  converted to WebP and shipped in `public/landing/` and `assets/`)
- `docs/working-folder/landing-screens/` — 12 Playwright captures
  (desktop/tablet/mobile, full-page + per-section slices)
- `docs/working-folder/scripts/` — 7 helper scripts (3 Playwright,
  4 GitHub Release body updaters — the 4 are superseded, kept for archeology)

The 4 superseded release scripts (`create-release.py`, `update-release.py`,
`update-v102.py`, `update-v103.py`) are **not** the current way to do
this. Use `scripts/release.sh <ver>` + the workflow in §5.

---

## 11. Who is the user

- **Name:** Maurice (4neverCompany)
- **Timezone:** Europe/Berlin
- **Stack preferences:** bun primary, npm fallback. Likes Tauri 2 for
  desktop. Prefers AGPL over MIT/Apache for "open core" projects. Likes
  hand-curated release notes (changelog highlights workflow exists
  because of this).
- **AI setup:** Has a Higgsfield Plus subscription. Wants to use
  MiniMax Code (this agent) for autonomous in-app work. Wants the
  full project context handed off in a single document so a new
  agent session can pick up where the last one left off.
- **Communication style:** Short, direct, casual. Not a fan of ceremony.
  Drops in the middle of tasks. Asks for handoffs proactively.

---

## 12. The 5 things to do FIRST when you start a new session

1. `cd /workspace/mashupforge && git log --oneline -10` — see the recent history
2. `cat CLAUDE.md` — read the project-specific agent rules
3. `cat .claude/rules/release-flow.md` — if you're shipping a release
4. `bunx vitest run` — confirm green baseline (1243/1243 expected)
5. `cat docs/research/HIGGSFIELD-RESEARCH.md` — if you're working on the
   AI provider path (the 713-line research doc is the source of truth for
   what Higgsfield supports and how we integrated it)

If you find yourself confused, ask: **"what would a thoughtful next release look
like?"** — and refer to §7 above. The user has already pre-ranked the
v1.0.5 candidates.

---

*— end of handoff. You have the full picture. Build something good. —*

