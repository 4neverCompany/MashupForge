# Architecture

> Wie passt MashupForge zusammen? High-level für neue Agents.

## Komponenten-Übersicht

```
┌──────────────────────────────────────────────────────────────┐
│                    MAURICE'S MASCHINE                          │
│  ┌──────────────────────┐    ┌────────────────────────┐      │
│  │   Tauri Desktop App   │    │  camofox-browser       │      │
│  │  (WebView + Rust +    │◄──►│  (Sidecar, 127.0.0.1:  │      │
│  │   gebundeltes Next.js)│    │   9377-9380)            │      │
│  └──────────┬────────────┘    └────────────────────────┘      │
│             │ HTTP                                              │
│  ┌──────────▼────────────┐                                      │
│  │  Next.js API Routes   │  ← in Tauri-Bundle lokal             │
│  │  (im Tauri-Prozess)   │                                      │
│  └──────────────────────┘                                      │
└──────────────────────────────────────────────────────────────┘

         ▲ Vercel-Web (alternativer Build-Pfad)
         │ User öffnet mashupforge.vercel.app
         │
┌────────┴──────────────────────────────────────────────────────┐
│                    VERCEL CLOUD                                  │
│  ┌──────────────────────┐                                       │
│  │  Next.js API Routes  │  ← kann Localhost nicht erreichen   │
│  │  (serverless)        │                                       │
│  └──────────────────────┘                                       │
└──────────────────────────────────────────────────────────────────┘
```

## Wichtige Architektur-Punkte

### 1. Tauri = Production, Vercel = Try-Before-Install
- Tauri-Build ist die Production-Target (Windows primary, Mac/Linux secondary)
- Vercel-Build ist für "App testen ohne Installation"
- API-Verhalten unterscheidet sich: Tauri kann camofox-Sidecar erreichen, Vercel nicht

### 2. camofox als Web-Search-Engine
- `camofox-browser` (Camoufox-Wrapper) ist der primäre Web-Search-Provider
- Tauri-Bundle: camofox wird mit-gepackt + 3-stage Port-Discovery (9377→9380)
- Vercel-Build: camofox ist NICHT verfügbar (Architektur-Limit)
- **Trade-off (offen für v1.2+):** User soll camofox auch standalone installieren können (`npm i -g @askjo/camofox-browser`) und so das Vercel-Web mit Trending versorgen

### 3. Provider-Stack
- **Higgsfield** (primary image/video gen, OAuth via deep-link)
- **Leonardo.ai** (fallback image gen, direct HTTP)
- **MiniMax** (text + vision, MiniMax M3 + Hailuo 2.3 für video)
- **mmx-CLI** (unified multi-modal wrapper, geplant für v1.2)

### 4. AI-Layer (v1.1.1 → v1.2)
- **v1.1.1 (heute):** AI generiert EINEN Prompt pro Request, ein-step
- **v1.2 (geplant):** AI macht Loop mit Tool-Use (trending search → prompt gen → eval → refine → finalize)
- **Skills** sind schon da (v1.1.1 auto-injection in system-prompt)
- **Tools** (lib/agent-tools/) sind noch nicht da

### 5. Auth-Modell
- **Pro-Project Tokens** in localStorage / idb-keyval (Higgsfield, Leonardo, etc.)
- **KEIN User-Account-System** (kein Google/GitHub Login auf MashupForge-Seite)
- **Higgsfield OAuth** läuft über `mashupforge://` deep-link, single-instance plugin verhindert neue Windows

### 6. Tauri ↔ Web CSP
- **Tauri-Build CSP:** erlaubt `connect-src http://127.0.0.1:9377-9380` (camofox-Sidecar)
- **Vercel-Web CSP:** Next.js default, KEIN Localhost — das ist der Grund warum camofox client-side im Web nicht trivial geht
- **D-Refactor:** Vercel-Web-CSP erweitern + Sidecar-CORS enablen

## Repository-Layout (high-level)

```
MashupForge/
├── app/                   ← Next.js App Router
│   ├── api/               ← API-Routes (trending, ai/prompt, video, etc.)
│   ├── studio/            ← Frontend (Mashup Studio UI)
│   └── ...
├── lib/                   ← TypeScript-Library
│   ├── camofox/           ← camofox-Client
│   ├── web-search.ts      ← DDG/Brave Fallback
│   ├── providers/         ← Higgsfield, Leonardo, MiniMax, mmx
│   └── ...
├── src-tauri/             ← Tauri Rust
│   ├── src/lib.rs         ← Sidecar-Lifecycle, deep-link, OAuth
│   └── tauri.conf.json    ← CSP, window-config
├── tests/                 ← vitest
├── docs/                  ← camofox-integration, runbooks, etc.
├── HANDOFF.md             ← langes Session-Log (wird gepflegt)
└── ...
```

## Build- und Release-Pipeline

- **PR-Checks:** `.github/workflows/pr-checks.yml` (brand guards, version sync, secret scan)
- **CI:** `.github/workflows/ci.yml` (vitest + tsc + bundle-size)
- **Tauri-Windows-Build:** `.github/workflows/tauri-windows.yml` (tag-only, cross-compile + release publish)
- **Smoke-Tests:** `.github/workflows/tauri-smoke-test*.yml` (manuell)

## Observability

- Tauri-Logs: `logs/camofox.log`, stderr vom Rust-Process
- Vercel-Logs: Standard Vercel-Function-Logs
- DB/State: keine zentrale DB, alles in localStorage (idb-keyval)
- Telemetrie: keine (kein PostHog, Sentry, etc.)
