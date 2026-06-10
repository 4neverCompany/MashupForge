# Pitfalls

> Was ist schonmal schiefgelaufen? Welche Workarounds gibt es? Lese das hier BEVOR du an bekannten Risiko-Stellen arbeitest.

## P-001: Vercel Web-Build kann camofox-Sidecar nicht erreichen

- **Symptom:** `/api/trending` returnt leeres Array, "No trending data found — proceeding without" im UI
- **Root-Cause:** camofox läuft auf Maurice's Maschine (`127.0.0.1:9377`), Vercel-API läuft in der Cloud. Cloud kann Localhost nicht erreichen.
- **Workaround (heute):** In Tauri-Build testen, da läuft Next.js API lokal.
- **Fix (geplant):** D-Refactor — siehe ROADMAP.md und `docs/camofox-client-side.md` (wird erstellt). Camofox-Sidecar-CORS enablen + MashupForge-Web-CSP erweitern + Tauri-Command-Bridge.
- **Datum:** 2026-06-07 (Maurice-Report)

## P-002: Higgsfield OAuth öffnete neues Tauri-Fenster (vor v1.1.2)

- **Symptom:** Klick auf "Allow" im OAuth-Popup öffnete zweite Tauri-Instanz, "Welcome Back" leere Seite.
- **Root-Cause:** OS handhabt `mashupforge://` deep-link → startet frischen Tauri-Prozess ohne PKCE-Cookies/Token-Storage.
- **Workaround (heute):** v1.1.2 single-instance plugin. Nicht getestet von Maurice bis jetzt.
- **Datum:** 2026-06-07 (Maurice-Report), Fix 2026-06-07

## P-003: SearXNG/Reddit-JSON lieferten auf Maurice's Maschine nichts

- **Symptom:** `/api/trending` v1.1.1 3-way-fanout (SearXNG + Reddit + camofox) lieferte auf Maurice oft 0-1 Hits.
- **Root-Cause:** SearXNG muss selbst gehostet sein (`localhost:34567`), Reddit-JSON rate-limited.
- **Workaround (heute):** v1.1.2 camofox-only. Reddit-Äquivalent via camofox `@reddit_search` Macro.
- **Datum:** 2026-06-06 (v1.1.1 Problem), Fix 2026-06-07 (v1.1.2)

## P-004: Vercel-Build-Cache stale nach GitHub-Vercel Repo-Re-Attach

- **Symptom:** Nach Maurice's `Code4neverCompany` user → `4neverCompany` org transfer, Vercel auto-deploy hatte stale `.next/` cache, URLs zeigten noch alte `Code4neverCompany` Pfade.
- **Root-Cause:** Vercel-Build-Cache keyed by GitHub-App-Install, nicht by source-code-hash. Erster Auto-Deploy nach Re-Attach nutzt Cache von vorherigem User-Install.
- **Workaround:** `vercel deploy --prod --force --yes --non-interactive` — `--force` skippt Build-Cache.
- **Datum:** 2026-06-05

## P-005: Git LF/CRLF commit message quoting gotcha (Windows)

- **Symptom:** `git commit -m "fix: route /foo/bar"` failed mit `fatal: Invalid path '/foo': No such file or directory`.
- **Root-Cause:** Body enthält quoted Unix-style path wie `import("/vercel/path0/...")`. `core.autocrlf=true` interpretiert den Path als file-path.
- **Workaround:** Heredoc mit `--file` statt inline `-m`, oder Path nicht verbatim quoten.
- **Datum:** 2026-06-06

## P-006: Next.js 15 dynamic-route params sind Promise

- **Symptom:** Vercel-Build fails mit `RouteHandlerConfig` constraint violation.
- **Root-Cause:** Next.js 15 hat dynamic params auf `Promise<{...}>` umgestellt.
- **Workaround:**
  ```ts
  // Next.js 15
  export async function GET(req, { params }: { params: Promise<{ taskId: string }> }) {
    const { taskId } = await params;
    // ...
  }
  // Tests: params: Promise.resolve({ taskId: 'x' })
  ```
- **Datum:** 2026-06-06 (PR #57 fix in `app/api/minimax-video`)

## P-007: `vi.mock` reicht nicht für static-import modules

- **Symptom:** Per-test state changes am mock werden nicht gepickt, weil route's static-import-binding auf erstes module-resolution freezed.
- **Workaround:** `vi.resetModules()` + `vi.doMock()` (runtime) statt `vi.mock`+`vi.hoisted` (compile-time).
  ```ts
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/lib/camofox", () => ({ camofoxSearch: vi.fn().mockResolvedValue(mockCamofox) }));
  });
  it("...", async () => {
    const { GET } = await import("@/app/api/trending/route");
    // ...
  });
  ```
- **Datum:** 2026-06-07 (v1.1.2 test rewrite)

## P-008: camofox-Lifecycle Crash auf Windows Defender SmartScreen

- **Symptom:** Erstes Launch von `camofox-browser.cmd` triggert SmartScreen-Warning, User muss "More info" → "Run anyway" klicken.
- **Root-Cause:** camofox-browser Binary ist nicht code-signed.
- **Workaround:** Maurice's User-Acceptance, one-time per machine. Code-Signing-out-of-scope.
- **Datum:** 2026-06-06 (v1.1.0)

## P-009: Maurice's task-prompt misconceptions (3+ Fälle)

- **Symptom:** Maurice beschreibt Projekte manchmal mit falscher Stack-Annahme (z.B. camofox-browser als C++/Firefox-Tool statt JS-Wrapper um C++ Camoufox; CODEOWNERS als Team-Mapping-Tool; matrix MCP Konzept; clampTimeout).
- **Workaround:** Agent soll task-prompt als HYPOTHESE behandeln und mit grep/Read verifizieren BEVOR Deliverable gebaut wird. Bestätigt in mind. 4 Fällen (2026-06-04 bis 2026-06-07).
- **Datum:** 2026-06-06, 4th instance 2026-06-07

## P-010: `mergeSettings` strippt `undefined` patches — Clear-Button No-Op

- **Symptom:** "Clear"-Button in CameraAnglePicker hat nichts gecleart.
- **Root-Cause:** `mergeSettings` strippt `undefined`-Werte aus dem Patch. Wenn User Clear klickt, war `value: undefined`, wurde gestrippt, kein Clear.
- **Workaround:** `clearSettings(keys)` primitive auf `useSettings` — explizit "diese Keys rausnehmen" statt "auf undefined setzen".
- **Datum:** 2026-06-06 (v1.1.1 fix)

## P-011: v12-MinimaxVideoAdapter.pollTask ist ein Placeholder (offen)

- **Symptom:** qa-Verifier flaggte "unchanged pollJob bug" — `MinimaxVideoAdapter.pollTask` returnt `{kind: 'job', jobId: 't3'}` ohne den CLI zu callen, ist ein placeholder.
- **Root-Cause:** mmx-CLI hat aktuell keine status subcommand. pollTask wartet darauf.
- **Workaround (heute):** None — placeholder is documented. Verifier flaggte es als issue, aber arbitration war override_accept.
- **Fix:** Wire minimax-pollTask sobald mmx status subcommand verfügbar.
- **Datum:** 2026-06-07 (qa-verifier-flag, override-accepted)

## P-012: Mavis-Team-Plan 30-min hard cap killt big tasks

- **Symptom:** Producer tasks mit > 30 min real work werden vom engine gekillt, auch wenn `extend-timeout` mehr zeit gibt (extension gilt nur within session, nicht across retries).
- **Workaround:**
  - Producer tasks auf < 30 min real work schneiden (oft 4-6 files + tests reicht nicht)
  - Oder manuell im orchestrator-session machen
  - `timeout_ms` in plan YAML ist SOFT, 30 min ist HARD cap
  - Bei retry mit "do NOT re-implement" + "do NOT re-read repo" prompt zur session verkürzen
- **Datum:** 2026-06-07 (mehrfache kills)

## P-013: Git push over SSH port 22 timeout auf Maurice's Windows

- **Symptom:** `git push origin <branch>` failed mit "ssh: connect to host github.com port 22: Connection timed out"
- **Workaround:** Push via HTTPS statt SSH. Git for Windows hat beide URLs konfiguriert; wenn SSH timeout, fallback auf `https://github.com/...`.
- **Datum:** 2026-06-07 (v12-provider-wrappers-fix worker)
