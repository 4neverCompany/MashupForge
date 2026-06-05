# MashupForge — Project Overview

> Slim pointer. The full handoff lives at `/HANDOFF.md` — read that
> first. This file is the quick-reference card for the team.

## What it is

Desktop-first AI content studio (Tauri 2 + Next.js 16) that takes a
single creative idea and ships it as a captioned, scheduled
Instagram post.

```
idea → image → caption → approve → scheduled → posted
```

## Stack

- **Desktop shell:** Tauri 2 (Rust) — system tray, autostart,
  signed auto-update
- **Studio UI:** Next.js 16 (App Router) + React 19 + TypeScript 6
- **Styling:** Tailwind 4.3 + custom `@theme` palette
- **Animations:** Motion 12 (formerly Framer Motion)
- **Package manager:** bun primary, npm fallback
- **Test framework:** Vitest 4 + happy-dom + Testing Library

## AI providers (3 peer layers)

| Layer | Providers | Default |
|---|---|---|
| Text | MiniMax + OpenAI | MiniMax (M3 model) |
| Image | Leonardo + Higgsfield (MCP) | Leonardo |
| Video | Higgsfield (MCP) | Higgsfield (Seedance 2.0) |

User picks per-idea. Decision persists per-post. OAuth is
per-user, no shared API key.

## Storage

- **Web:** IndexedDB (browser-local, AES-GCM for sensitive fields)
- **Desktop:** SQLite via `tauri-plugin-sql` (browser-local too)
- **Migration:** parallel-coexistence from legacy IDB shape (in
  `lib/post-lifecycle/migration.ts`)

## 6-state pipeline (the v0.9.41 fix)

```
idle → image_ready → pending_caption → pending_approval
                                            │
                                    ┌───────┴───────┐
                                    ▼               ▼
                                approved        rejected
                                    │               │
                                    ▼               ▼
                               scheduled       failed (atomic)
                                    │
                                    ▼
                                 posted
```

| State | Guard |
|---|---|
| `image_ready` → `pending_caption` | `savePostWithBlob()` — atomic write of `(state, hostedImageUrl, blobHash)` |
| `pending_caption` → `pending_approval` | `applyTransition()` — typed, no `any`, pure |
| `pending_approval` → `scheduled` | `Reconciler` — read-time fix at startup, surfaces drift |
| `scheduled` → `posted` | `SmartScheduler` — peak-window timing, IG Graph API call |

**Invariant:** a post without `hostedImageUrl` cannot exist. By
construction. (v0.9.41 was a bug that broke this — the state
machine fixes it.)

## Directory map

```
app/                  ← Next.js App Router
  api/                  14 routes
  studio/               /studio (the workbench)
  login/                Tauri-only desktop login
components/           ← React components
  Studio/               workbench
  Settings/             SettingsModal + pickers
  post-lifecycle/       state machine UI
  pipeline/             approval queue, status strip
hooks/                ← React hooks
  useImageGeneration    the big one (Leonardo + Higgsfield + MiniMax)
  usePipeline*          pipeline state machine + daemon
  useReconciler         post-lifecycle reconciler
  useSettings           IDB-backed settings
lib/                  ← 6 sub-systems
  higgsfield/            MCP+OAuth+token-store+models+tools (v1.0.4)
  post-lifecycle/        state machine + storage + reconciler
  text-model-catalog.ts  6 text models, M3 default
  image-prompt-builder   per-provider prompt builders
  persistence/           IDB + SQLite layer
  desktop-env.ts         Tauri-only env reads
src-tauri/            ← Tauri 2 desktop shell (Rust)
  src/lib.rs             webview boot path: /studio
  tauri.conf.json        frontendDist: ../src-tauri/frontend-stub
  Cargo.toml
tests/                ← Vitest, happy-dom (NOT jsdom)
  lib/                   the bulk (~1,200 tests)
  components/            a few React component tests
  api/                   route tests
scripts/              ← release.sh, bundle-size check, event hooks
docs/                 ← research, runbooks, changelog highlights
.github/workflows/    ← ci, pr-checks, brand-guards, tauri-windows
```

## License

AGPL-3.0-or-later. **Why:** "open core" model. The desktop app
stays open source, and the AGPL clause makes a hosted SaaS fork
a contractual obligation to open-source. Protects the future-SaaS
path without a custom license.

## Release pipeline (TL;DR)

```bash
bash scripts/release.sh 1.0.5
git push origin main
git tag v1.0.5 && git push origin v1.0.5
# → GitHub Actions builds Windows installer, publishes draft release
# → operator pastes docs/changelog-highlights/1.0.5.md into the
#   GitHub Release body
```

Full release process: `.harness/docs/release-process.md`.

## Links

- **Landing:** https://mashupforge.vercel.app
- **Studio (web):** https://mashupforge.vercel.app/studio
- **Releases:** https://github.com/4neverCompany/MashupForge/releases
- **Source:** https://github.com/4neverCompany/MashupForge
