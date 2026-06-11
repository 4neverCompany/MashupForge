# State — MashupForge

**Last updated:** 2026-06-11 06:50 (Europe/Berlin, UTC+2)
**Active session:** Claude Code (Fable 5) — Lagebild nach v1.7.0 + Ops-Fixes + M3-Start
**Workspace:** I:\c4n-MashupForge (Handoff source of truth: I:\MashupForge-handoff\)
**Current version:** **1.7.0 SHIPPED** (published 2026-06-11 00:41 UTC, Build 21m23s grün, alle 4 Assets — von einer parallelen Session gebaut). Inhalt = M2 komplett + 3 Fixes: #69 kontextueller Per-Image-Camera-Angle (Settings-Picker = optionaler Lock), #70 automatische Skill-Selektion (Skill-Index + Routing-Anweisung statt Body-Dump, Studio-Route + Director), #71 Director übergibt den sauberen Prompt statt seines Terminal-Reports (+ Provider-Name im Pipeline-Log), #72 Pipeline kann Higgsfield wirklich nutzen (higgsfield:<slug>-Routing statt Leonardo-Fallback — ACHTUNG: verbraucht jetzt echte Higgsfield-Credits in Pipeline-Runs), #73 applyWatermark mit 15s-Load-Timeout (kein Infinite-Hang mehr). Davor: **1.6.0** (M1 + Director-Default, siehe unten). Inhalt: M1 komplett (PR #65: Director `.chat()`-Fix in den Tools + 502-Error-Surfacing, Higgsfield-CLI-counts-as-connected in Panel+Image+Video-Routes, `color-scheme: dark` Dropdown-Fix, Serper→Brave→DDG-Trending-Chain + SERPER_API_KEY-Config) **plus** Director als DEFAULT-Pipeline-Pfad (PR #66: Opt-out-Migration `applyV160DirectorDefaultMigration` + `directorPipelineUserSet`-Marker, gehärtet nach 17-Agent-Adversarial-Review — Per-Idea-Kosten-Memo gegen die Continuous-Mode-Geld-Schleife, 3-min-Client-/4-min-Server-Timeout + Skip-Abort durchgereicht bis in den Loop, DIRECTOR_FAILED-Sentinel + Client-Plausibilitäts-Gate gegen Apology-als-Prompt, Caption-Fallback = kurzes Verbatim-Konzept, Marker-Pair-Guard + hydratedOnceRef="Hydration erfolgreich" in useSettings). Serper-Key liegt auf Maurice' Maschine in config.json (live getestet, 2.499/2.500 Credits). Davor: 1.5.2 (CLI im Installer), 1.5.1 (Director-Toggle), 1.5.0 (5 Feature-Requests).

**▶ Nächster Einstieg: M3** (+ Ops: Actions-Node-20-Deadline 16.06., Dependabot-Backlog) — siehe ROADMAP.md "NÄCHSTER EINSTIEG" + ACTIVE-CONTEXT.md. camofox-integration.yml-YAML-Fix (roter Run pro Push seit 09.06.) ist auf main.

**RELEASE-KONVENTION (ab 2026-06-10, in .claude/rules/release-flow.md):** NICHT pro PR taggen. Merge-to-main triggert KEINEN Build; nur ein Tag-Push = ~20min-Tauri-Build + forced-update für alle User. Zusammenhängende Arbeit auf main sammeln → EIN gebündeltes Release VORSCHLAGEN → Maurice' explizites OK abwarten → erst dann release.sh + tag.

## ⚡ Update 08:30: v1.4.7 — Maurices Reload-Bug-Report

Maurice meldete 07:45: "Page reload → Verlust aller generierten Bilder +
Watermark in Optionen weg." Analyse:
- **Bilder-Hälfte** = der v1.4.6-Debounce-Fix (er war beim Reload noch auf
  v1.4.5). Auto-Update zieht v1.4.6+.
- **Watermark-Hälfte** = NEUER Fund: useSettings hatte denselben Wipe-Vektor
  (PR #59 fixte nur useImages). Drei Writer (Debounce-Save, Unmount-Cleanup,
  beforeunload-Flush) nur auf isSettingsLoaded gated → Defaults-Snapshot
  vergiftete localStorage → nächster Load merged ihn ÜBER den Store (patch
  wins) → Watermark-Reset bei jedem Reload.
- **Beifang:** useComparison schrieb bei JEDEM Mount sofort [] über die
  Comparison-Results (deterministischer Wipe); useIdeas hatte das
  Stale-Gate-Fenster während Hydration. Beide mitgefixt.
- Fix-Muster überall: dirtyRef + loadInFlightRef (+ hydratedOnceRef +
  pendingOpsRef-Replay in useSettings). 7-Test-Regression-Suite
  tests/integration/useSettings-wipe.test.tsx.
- **EMPFEHLUNG (3x bestätigt):** usePersistentStore<T>-Abstraktion
  extrahieren (4-8h) — useImages/useSettings/useIdeas/useComparison/
  useCollections teilen dasselbe fehleranfällige Muster.

---

## ⚡ Update 07:30: v1.4.5 LIVE · PR #59 MERGED · v1.4.6 building

- **v1.4.5 published**: <https://github.com/4neverCompany/MashupForge/releases/tag/v1.4.5>.
  Der Bun-Build-Step im CI scheiterte ERNEUT — der gefixte npm-Fallback hat
  den Build gerettet. Bun-Step-Root-Cause ist offenes Folgethema.
- **PR #59 MERGED** (squash `295b5b6`, 17/17 Checks grün, 07:09 Berlin):
  Data-Loss-Root-Cause-Fix (debounced store-write), cmd.exe-Injection-Fix,
  CLI-Auth-EINVAL-Fix, 8 ESLint-Errors, Hydration-Failure-Latch,
  win32-Escaping-Tests. Details: SESSION-LOG Session 6b.
- **v1.4.6 SHIPPED** (`30ffbb3`, published 2026-06-10 05:34 UTC):
  <https://github.com/4neverCompany/MashupForge/releases/tag/v1.4.6>.
  Shippt den PR-#59-Merge an Desktop-User. v1.4.5 enthält den
  Debounce-Wipe-Vektor noch — v1.4.6 schließt ihn; v1.4.5-Installs
  auto-updaten beim nächsten Start.

## ⚡ Update 2026-06-10 ~13:40: Higgsfield CLI Install-Script (PR #63, b19d09f)

Maurice: "Higgsfield MCP geht? CLI per Script in MashupForge-Dir installieren?"
- **MCP**: NICHT an die AI angebunden (nur OAuth-Connect + manuelle Routes).
  Bewusst NICHT verdrahtet — genau die WebView-OAuth-500er-Probleme; Research
  sagt CLI > MCP (~35×). Empfehlung: CLI-Pfad nutzen.
- **CLI-Script geliefert** `scripts/install-higgsfield-cli.ps1`: installiert
  @higgsfield/cli@0.1.40 → `%LOCALAPPDATA%\MashupForge\higgsfield-cli\`,
  smoke-test, setzt User-Env `HIGGSFIELD_BIN`. KEINE Adapter-Code-Änderung
  nötig (liest HIGGSFIELD_BIN schon, cli-adapter.ts:214). Auf Maurices
  Maschine bereits AUSGEFÜHRT — CLI installiert + HIGGSFIELD_BIN gesetzt.
  Maurice muss: App neustarten + Settings→Higgsfield CLI-Token einfügen
  (KEIN OAuth-Fenster) ODER `higgsfield auth login` (System-Browser).
- gitignore: src-tauri/resources/higgsfield-cli/ (für -Dest Bundling-Staging).
- **Installer-Bundling ERLEDIGT (PR #64, 0b92210 → v1.5.2):** Workflow-Step
  staged die CLI nach src-tauri/resources/higgsfield-cli (install-script mit
  -Dest -NoEnv); lib.rs setzt beim Sidecar-Spawn HIGGSFIELD_BIN auf den
  gebündelten Shim (User-Env hat VORRANG) + prependet bundled-Node-Dir in
  PATH (npm-.cmd-Shim resolved node via PATH). Resolution: User-BIN >
  bundled > PATH. v1.5.2 getaggt (95ff600) — der Tag-Build validiert den
  Staging-Step end-to-end. NEBENBEI: release.sh-Commit lief erstmals OHNE
  --no-verify-Fallback durch (SQLite-Skip-Fix wirkt).

## ⚡ Update 2026-06-10 ~13:05: Cleanup (PR #62, gemerged 0bc1c57)

Maurice: "die kleinen Dauerbrenner fixen". Erledigt (chore, kein Release nötig):
- **14 tauri-sqlite-Failures = KEIN Code-Bug.** Stray pnpm-Store
  (node_modules/.pnpm) installierte better-sqlite3 ohne native Binding zu
  bauen → `new Database()` wirft lokal "Could not locate bindings"; CI baut
  ihn und ist grün. Fix: Tests skippen sauber wenn Binding fehlt (dynamic
  import + describe.skip + console.warn). **Commits brauchen kein
  --no-verify mehr** (dieser Commit lief durch den echten Pre-Commit-Hook).
  Lokal aktivieren: `npm rebuild better-sqlite3` / clean `bun install`.
- **8 tote eslint-disable-Direktiven** via eslint --fix entfernt (15→7
  Warnings; Rest = absichtliche no-img-element auf Data/Asset-URLs).
- **.gitignore:** pnpm-lock.yaml + pnpm-workspace.yaml (bun-only Projekt) +
  .mavis/. **Dangling v1.4.4-Tag** gelöscht (local + origin).
- **Bun-CI-Build-Failure** war schon erledigt (v1.4.4-Lockfile-Cleanup) —
  v1.5.1-Build: Bun-Primary success, npm-Fallback skipped.

## ⚡ Update 2026-06-10 ~09:55: v1.5.0 SHIPPED

Maurice 5-Punkte-Request → Multi-Agent-Investigation (6 Agents + Web-Research)
→ 5 Commits, PR [#60](https://github.com/4neverCompany/MashupForge/pull/60)
gemerged (squash `93fe598`, 15/15 CI grün). **[v1.5.0 published](https://github.com/4neverCompany/MashupForge/releases/tag/v1.5.0)**
07:50 UTC — alle 4 Assets, Highlights im Body. Aktuelle Version: **1.5.0**.

**Folge-Schritt ERLEDIGT (v1.5.1 SHIPPED):** Opt-in Toggle "Agentic Director
pipeline" (Settings → AI Engine, default OFF). PR
[#61](https://github.com/4neverCompany/MashupForge/pull/61) gemerged
(`d7b4325`), **[v1.5.1 published](https://github.com/4neverCompany/MashupForge/releases/tag/v1.5.1)**
10:35 UTC, alle 4 Assets. Aktuelle Version: **1.5.1**. Wenn an:
useIdeaProcessor.expandIdeaToPrompt → requestDirectorPrompt (lib/director-
pipeline.ts) → /api/ai/prompt mode:director → Director-Loop produziert den
Prompt (NUR Prompt, keine Generation; $0.50/8-Step-Cap), Fallback auf
verbatim bei jedem Fehler. Fast-Path bleibt default. 7 neue Tests.

**Offene Folge-Ideen (nicht dringend):** (1) Higgsfield-MCP-Server als
flag-gated Secondary (interaktives OAuth, Runtime-Tool-Namen). (2) Optional
self-healing restore-on-empty in persistence.ts (high-blast-radius, separat).
(3) Director-Loop mit restricted tool-set (nur trending/generate_prompt/
critique) statt full AGENT_TOOLS — verhindert versehentliche generate_image-
Calls im Prompt-Planning (aktuell durch Plan-System-Prompt + Budget bound).

1. **Trending — 2 getrennte Root-Causes:** (A) `/api/trending` war camofox-only
   mit `()=>[]` Server-Fallback → webSearch-Backstop ergänzt. (B) Der Director-
   Agent-Loop baute MiniMax über den `@ai-sdk/openai` Default-Callable = Responses-
   API `/v1/responses` → **404 auf MiniMax → KEIN Tool lief je** (genau Maurices
   "AI kann nicht tool-callen"). Fix: `openai.chat(modelId)` (MiniMax-M3 kann
   tools/tool_choice auf chat/completions — verifiziert).
2. **Higgsfield CLI:** generate_image/generate_video waren `throw`-Stubs → an den
   CLI-Adapter verdrahtet (Image sync, Video bounded async-poll via getJobStatus).
   CLI ist der research-empfohlene Primary (35× weniger Tokens als MCP). MCP-Wiring
   (interaktives OAuth, Runtime-Tool-Namen) = dokumentierter Follow-up.
3. **Approved Images lokal:** persistImageToDisk lief nur bei Generation → jetzt
   auch bei Approval, in appdata-Canonical UND `Documents\MashupForge\Images`
   (discoverable). fs-Scope ergänzt.
4. **Re-apply Watermark** in Captioning/Post-Ready/Gallery: applyWatermark nach
   lib/watermark.ts extrahiert + reapplyWatermark; neuer `originalUrl` verhindert
   Double-Stacking; Videos geskippt.
5. **Update-Persistenz:** Investigation bestätigt — KEIN Wipe-Vektor existiert
   (Daten in %APPDATA%, NSIS-Updater ersetzt nur Programm-Files, kein version-gated
   clear; Reload-Wipe-Familie ist gefixt). Updaten verliert nichts. Optionales
   restore-on-empty+Tombstone = separater Follow-up (persistence.ts high-blast-radius).

Verifikation: tsc clean, eslint 0 errors, next build grün (studio 271 KB),
vitest grün außer den 14 bekannten tauri-sqlite-Failures.

## TL;DR

- **v1.4.4 wurde NIE published** — 6 Build-Versuche gescheitert. Zwei getrennte
  Root Causes: (1) Turbopack client-bundle break (node:fs via Skill-Loader in
  ManualGenerationPanel), (2) davor Lockfile-Drift (@tauri-apps/plugin-fs ohne
  bun install committet).
- **v1.4.5 = Recovery-Release** — getaggt 2026-06-10 ~01:50 Berlin, Build
  #27243145179 in flight. Enthält alle v1.4.4-Features PLUS die Fixes, die sie
  funktional machen (tauri-plugin-fs war auf der Rust-Seite nie registriert —
  alle Disk-Features waren silent no-ops).
- **CI auf main wieder grün** (war seit package-lock.json-Löschung tot —
  setup-node `cache: 'npm'` Abhängigkeit).
- 8 Commits auf main: `a84b76b`..`8511f03`. Details in SESSION-LOG.md
  (Session 6) und docs/changelog-highlights/1.4.5.md im Repo.

## What shipped in v1.4.5 (in flight)

- fix(build): Higgsfield-Skill-Content via Server Action (Turbopack-Fix)
- fix(desktop): tauri-plugin-fs registriert (Cargo + lib.rs + capabilities
  mit $APPDATA/$DOCUMENT/$CONFIG-Scopes) + asset:-CSP für lokale Bilder
- fix(backup): echte Dokumente-Ordner (documentDir), korrekter
  config.json-Pfad (configDir/MashupForge), Version aus package.json
- fix(ci): kein npm-cache/npm-ci mehr (package-lock.json existiert nicht mehr)
- fix(deps): jsdom/lru-cache-Resolution repariert (6 Test-Files liefen still
  nicht), jsdom in devDependencies
- test: useImages-flush auf v1.4.4-Contract umgeschrieben
- feat(release): release.sh empty-bump guard (--force Override)
- CHANGELOG: 3x 1.4.4-Duplikate dedupliziert

## What's broken / in flight

- **v1.4.5 Tauri build in flight** — #27243145179, ETA 17-35 min ab ~23:50 UTC.
- **14 pre-existing test failures** — better_sqlite3 native binding lokal
  (tauri-sqlite.test.ts). Auf CI-Ubuntu grün. Maurice-akzeptiert, --no-verify
  für Commits erlaubt.
- **8 pre-existing ESLint errors** — react-hooks/set-state-in-effect in 6
  Hooks + ManualGenerationPanel. Seit v1.0.6 wieder eingerutscht. CI-Lint
  blockt offenbar nicht (check job grün). Eigener Cleanup-Task.

## Open questions

- v1.4.4-Tag (dangling commit ece3a1b) löschen? Release existiert nicht.
- pnpm-lock.yaml + pnpm-workspace.yaml + .mavis/ untracked im Repo — Cruft?
  (better-sqlite3-Failure hängt evtl. mit .pnpm-Resten in node_modules zusammen)

## Memory anchors (cross-project)

- v1.2.7 data-loss root cause: hook firing with empty in-memory state.
- v1.2.8 OAuth-in-WebView root cause: cookie jars differ between WebView2
  and system browser.
- v1.2.10 OAuth invalid_grant root cause: redirect_uri mismatch between
  /authorize (mashupforge://) and /callback (tauri://localhost) flows.
- v1.4.4 build-break root cause: 'use client' Komponente importiert Modul
  mit top-level node:fs → Turbopack bricht. Cure: Server Action
  (lib/actions/-Pattern, siehe virality.ts + higgsfield-skills.ts).
- v1.4.4 runtime root cause: JS-Plugin-Calls ohne Rust-Plugin-Registrierung
  failen silent in try/catch. Bei neuen @tauri-apps/plugin-X-Deps IMMER:
  Cargo.toml + .plugin(init()) + capabilities/default.json prüfen.
- Tauri Windows build ETA: 17m (warm) → 35m (cold) → 60m+ is hung.
- Cron TTL is misleading: it only stops new prompts, the tick loop keeps
  firing. Delete explicitly when work is done.
- Tauri Windows Build workflow triggers: `push: tags: ['v*.*.*']` or
  `workflow_dispatch`. Push to main does NOT trigger — must tag.
- git push auf dieser Maschine: globale .gitconfig pinnt falschen
  GitHub-Username (4neverCompany), gh-Account ist Code4neverCompany.
  Repo-lokal gefixt via `git config --local
  credential.https://github.com.username Code4neverCompany`.
