# camofox-browser integration

> CAMOFOX-CAMOUFOX-1.1.0 (2026-06-06): bundled with MashupForge v1.1.0.
> Optional second sidecar that hardens the web-search enrichment path
> against CAPTCHA waves and rate limits. Falls back to the existing
> DDG/Brave path transparently when camofox is unavailable.

## What is it?

`camofox-browser` is a Node.js-REST server that wraps
[Camoufox](https://github.com/daijro/camoufox) — a C++-patched
Firefox build with anti-bot fingerprint spoofing. MashupForge
launches it as a sidecar (analogous to the existing Node-Next
sidecar) on `127.0.0.1:9377` and uses it for AI enrichment searches
in the `pi`, `mmx`, `nca`, `ai`, and `web-search` API routes.

## What's in this release

| Item | Where | Notes |
|---|---|---|
| Tauri 2.x sidecar lifecycle | `src-tauri/src/lib.rs` | `CamofoxState`, 3-stage port discovery, boot probe, KILL_ON_JOB_CLOSE |
| Fetch script | `scripts/fetch-camofox-browser.ps1` | `npm pack @askjo/camofox-browser@1.11.2` → `src-tauri/resources/camofox/` |
| CSP diff | `src-tauri/tauri.conf.json` | `connect-src` extended with `http://127.0.0.1:9377` through `:9380` |
| TypeScript client | `lib/camofox/` | typed API, Zod-validated responses, retry/backoff, PII scrubber |
| Route integrations | `app/api/{pi,mmx,nca,ai,web-search}/prompt/` + `app/api/web-search/route.ts` | wrapped in `withCamofoxHealth(camofoxSearch, webSearch)` |
| Tests | `tests/lib/camofox/`, `src-tauri/tests/camofox_lifecycle.rs` | 25 vitest + 5 Rust tests |

## How it works at runtime

1. The Tauri launcher spawns `camofox-browser.cmd` (Windows) or
   `camofox-browser` (Unix) as a child of `node.exe` (the existing
   Next.js sidecar's runtime). It listens on `127.0.0.1:9377` by
   default; if that port is held, the 3-stage discovery tries
   9378-9380. If all 4 are taken by non-camofox services, the
   `WEB_SEARCH_FALLBACK` flag is set and the DDG/Brave path takes
   over.
2. Each call-site goes through `withCamofoxHealth(camofoxSearch,
   webSearch)`. The wrapper pre-checks `camofoxStatus()` and
   short-circuits to `webSearch` if camofox is unreachable. On a
   mid-call `CamofoxUnavailableError` or `CamofoxParseError`, the
   wrapper flips the Rust-side `WEB_SEARCH_FALLBACK` flag and
   transparently falls back for the rest of the session.
3. Each call creates a fresh camofox tab with a unique
   `sessionKey` so concurrent in-flight calls don't share tabs.
   The tab is DELETEd in the `finally` block.

## First-run

The fetch script (`scripts/fetch-camofox-browser.ps1`) downloads
`@askjo/camofox-browser@1.11.2` from npm at build time. The
`actions/cache@v4` step in `.github/workflows/tauri-windows.yml`
caches the tarball, so repeat builds skip the download.

On the **first launch** of the sidecar, camofox-browser downloads
the ~300 MB Camoufox binary via its own `postinstall` step. This
takes 30-60 seconds on a cold install; the boot probe polls `/health`
for up to 60 seconds before declaring failure.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `camofox: no available port in CAMOFOX_PORTS — fallback to websearch` in `logs/camofox.log` | All 4 ports 9377-9380 held by non-camofox services | Stop the conflicting process, or set `CAMOFOX_PORT` (out of scope in v1.1.0) |
| `camofox UNHEALTHY after 60s on port 9377` | Camoufox binary failed to download on first run | Check `camofox.log` for download errors; rerun the app to retry |
| `camofox crash limit reached — WEB_SEARCH_FALLBACK=true` | 3 crashes in 5 minutes (Camoufox renderer bug on a specific site) | Restart the app; the flag resets on launch |
| Windows Defender SmartScreen warning on first run | `camofox-browser.cmd` is not code-signed | Click "More info" → "Run anyway" (one-time per machine) |
| Web build returns search-empty in the studio | camofox is bundled only with the Tauri desktop build, not the Vercel web build | Expected — the web build always uses the DDG/Brave path |

## What's intentionally NOT in v1.1.0

- **Snippet extraction** via `/extract` + JSON schema. The
  `ai/prompt` route currently gets titles + URLs from camofox
  but no snippets. The empty-snippet line in the enrichment
  block is acceptable for the trend-context use case; a future
  release can wire the `/extract` path for full snippets.
- **`@pinterest_search` macro** — upstream gap (camofox v1.11.2
  doesn't ship this macro). The `buildManualSearchUrl('pinterest',
  ...)` helper in `lib/camofox/macros.ts` is the workaround entry
  point; the call-site that uses it is a follow-up.
- **Tauri commands `camofox_status` + `set_camofox_fallback`** —
  the Rust side flips `WEB_SEARCH_FALLBACK` internally on crash
  detection, and the JS wrapper no-ops on the flag-set call when
  no Tauri command is registered. Wiring the commands is a
  small follow-up.
- **macOS / Linux Tauri builds** — camofox is bundled only in the
  Windows Tauri build (the primary target per `docs/runbook/nsis-release.md`).
  Mac and Linux validation builds use the existing DDG/Brave path.

## References

- Master integration plan: `I:\tmp\camofox-integration-plan.md` (v1.1)
- API research: `I:\tmp\camofox-api-research.md`
- Call-site mapping: `I:\tmp\mashupforge-call-sites.md`
- Sidecar design: `I:\tmp\camofox-sidecar-design.md`
- Upstream camofox-browser docs: <https://github.com/jo-inc/camofox-browser>
- Camoufox (the engine underneath): <https://github.com/daijro/camoufox>
