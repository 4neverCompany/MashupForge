<div align="center">

# MashupForge

### AI-Powered Creative Crossover Studio

*Generate epic crossover artwork combining characters and universes from Star Wars, Marvel, DC, Warhammer 40k, and beyond.*

[![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4.1-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Leonardo.ai](https://img.shields.io/badge/Leonardo.ai-v2-C5A062?style=for-the-badge)](https://leonardo.ai)
[![pi.dev](https://img.shields.io/badge/pi.dev-RPC-00E6FF?style=for-the-badge)](https://pi.dev)

[![License](https://img.shields.io/badge/License-Proprietary-050505?style=flat-square)](#license)
[![Version](https://img.shields.io/badge/version-0.9.45-C5A062?style=flat-square)](package.json)

![MashupForge — AI-Powered Creative Crossover Studio](assets/hero.svg)

</div>

---

## Features

| | |
| :---: | :--- |
| **Idea Generator** | AI brainstorms "what if" crossover scenarios across franchises, now powered by **Content Pillars** and **Style Tags** for guided creativity. |
| **Image Generation** | Turn any idea into artwork across **MiniMax image-01**, **GPT Image 1.5 / 2**, and **Nano Banana / 2 / Pro**. |
| **Compare Mode** | Run the same prompt across multiple models side-by-side and pick the winner. |
| **Autonomous Pipeline** | Hands-free flow: Ideas → Approve → Caption → Post Ready → **Autopost**, with trend-driven generation and smart daily caps. |
| **Trademark Guard** | History-driven moderation filter learns from past blocks and surgically rewrites flagged names while preserving prompts. |
| **Desktop App** | Tauri 2 shell with **system tray**, hide-on-close, **autostart on login**, and silent **auto-update**. |
| **AI Co-Pilot** | Redesigned conversational agent — brainstorm, refine prompts, and explore crossover angles with a purpose-built MashupForge persona. |

![Feature showcase — Idea Generator, Image Generation, Compare Mode, Autonomous Pipeline](assets/features.svg)

## AI Engine

All text AI (ideas, prompts, captions, chat) runs through **[pi.dev](https://pi.dev)** — a local AI coding agent that connects to any LLM provider. You pick the provider, pi handles the rest.

Supported providers include Google Antigravity, Google AI Studio, Anthropic, OpenAI, ZAI, Groq, Cerebras, and 15+ more. Pi stores its own credentials in `~/.pi/agent/auth.json` — no API keys for text features in the app itself.

## Quick Start

**Prerequisites**
- Node.js 18+
- `tmux` (used by the pi.dev setup flow)

```bash
# 1. Clone
git clone https://github.com/Code4neverCompany/MashupForge.git
cd MashupForge

# 2. Install
npm install

# 3. Configure environment
cp .env.example .env.local
# then edit .env.local with your Leonardo.ai key (see below)

# 4. Run
npm run dev
# → http://localhost:3000
```

Then open **Settings → Setup Pi.dev** in the app to install pi, pick a provider, and authenticate.

## Environment Variables

Copy `.env.example` → `.env.local` and fill in:

| Variable | Required | Description |
| --- | :---: | --- |
| `LEONARDO_API_KEY` | ✓ | API key from [leonardo.ai](https://leonardo.ai) — used for image generation. |
| `GEMINI_API_KEY` | — | Optional Gemini API key. Text AI normally flows through pi.dev; this is a fallback. |
| `APP_URL` | — | Self-referential base URL. Auto-injected when deployed via AI Studio / Cloud Run. |

## Scripts

```bash
npm run dev          # Dev server (Next.js + Turbopack)
npm run build        # Production build + bundle-size check
npm run start        # Start production server
npm run lint         # ESLint
npm test             # Vitest (one-shot)
npm run test:watch   # Vitest (watch mode)
npm run tauri:dev    # Desktop app (Tauri) — dev
npm run tauri:build  # Desktop app (Tauri) — build
```

## Project Structure

```
MashupForge/
├── app/
│   ├── api/
│   │   ├── leonardo/        # Image generation + polling
│   │   ├── pi/              # pi.dev RPC proxy (start/stop/prompt/status)
│   │   ├── social/          # Social posting (Instagram, Twitter)
│   │   ├── trending/        # Trend discovery
│   │   └── web-search/      # Web search helper
│   ├── login/               # Auth entry
│   ├── layout.tsx           # Root layout
│   └── page.tsx             # Main app entry
├── components/
│   ├── MainContent.tsx      # Primary UI (tabs, gallery, settings)
│   ├── Sidebar.tsx          # Chat + content generator
│   ├── MashupStudio.tsx     # Root layout shell
│   ├── onboarding/          # First-run flow
│   ├── pipeline/            # Pipeline panels
│   ├── approval/            # Approval queue UI
│   └── platform/            # Per-platform helpers
├── hooks/                   # React hooks (image gen, pipeline, ideas, …)
├── lib/                     # Client/server utilities, pi.dev client
├── types/                   # Leonardo models, styles, dimensions
├── tests/                   # Vitest suites (api, components, hooks, integration, lib)
├── src-tauri/               # Tauri (desktop) shell
└── docs/                    # Release, runbooks, internal docs
```

## Tech Stack

- **Framework:** Next.js 16 (Turbopack) + React 19
- **Language:** TypeScript 6.0
- **Styling:** Tailwind CSS 4 + `@tailwindcss/typography`
- **Image AI:** Leonardo.ai v2 (Nano Banana family, GPT Image) + MiniMax `image-01`
- **Text AI:** pi.dev RPC subprocess (local, multi-provider)
- **Desktop:** Tauri 2 — system tray, autostart, auto-update, single-instance
- **Testing:** Vitest + Testing Library + jsdom
- **Storage:** `idb-keyval` (client-side persistence)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, code style, and PR guidelines.

Bug report? Feature idea? Open an issue — templates are under `.github/ISSUE_TEMPLATE/`.

## License

Proprietary — © 4neverCompany. All rights reserved.

---

<div align="center">

Built by **[4neverCompany](https://4never.company)** ·  Agency Black · Metallic Gold · Electric Blue

</div>
