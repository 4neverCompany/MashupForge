# Session Log

> Chronologische Übersicht. Format: 1 paragraph pro Session, neueste oben. Klicke durch zu detaillierten Notes in HANDOFF.md (im Repo) oder STATE.md / ACTIVE-CONTEXT.md.

---

## 2026-06-11 (Session 9 Forts. — Analytics + M3.1b gemerged, Maurice-Entscheidungen)

Maurice: bmad-Docs koennen weg (waren Produktions-Artefakte), Vercel Web Analytics JA, weiter nach Roadmap. Erledigt: **PR #75** Vercel Web Analytics mit Tauri-Desktop-Guard (components/WebAnalytics.tsx rendert nur im Web-Build; im Browser-Preview verifiziert: Komponente mountet, Script wird angefragt; queueMicrotask-Konvention fuer set-state-in-effect); Drafts #67/#11 superseded-closed. **PR #76** M3.1b PostReadyCard: Image-passing Handler-Vertrag (13 Inline-Lambdas -> EIN useStableCallbacks-Bag, Spread am Call-Site), memoized availablePlatformsList/allScheduledPosts (availablePlatforms() baute pro Aufruf neue Arrays — haette jedes Memo ausgehebelt), React.memo; Test-Assertion an (img, platforms, date, time)-Vertrag angepasst. PostReadyCarouselCard bleibt unmemoized (notiert). Beide PRs 15/15 Checks, gemerged (89d1e66, 911b2ee). Naechster Einstieg: M3.2 Comparison-to-Disk, dann M3.3 Cleanup (bmad-OK liegt vor).

## 2026-06-11 (Session 8 — parallele Claude-Code-Session: M2 → v1.7.0) [rekonstruiert]

Eine parallele Session (nicht diese) hat M2 komplett gebaut und als v1.7.0 released (00:41 UTC): **#69** kontextueller Camera-Angle pro Bild (Idea-Generator wählt aus dem 14-Angle-Katalog; Settings-Picker = optionaler Lock), **#70** automatische Skill-Selektion (Skill-Index + Routing-Anweisung statt Komplett-Dump; Studio-Route + Director), **#71** Director-Clean-Prompt-Fix (Image-Model bekam vorher den ganzen Terminal-Report inkl. `<think>` und Sign-off statt des kritisierten Drafts) + Provider-Name im Pipeline-Log, **#72** Pipeline routet `higgsfield:<slug>` jetzt wirklich zu Higgsfield (vorher silent Leonardo-Fallback; verbraucht jetzt echte Credits), **#73** applyWatermark 15s-Timeout (Infinite-Hang bei toten CDN-Quellen). Build 21m23s grün, alle 4 Assets. Handoff wurde NICHT nachgezogen (in Session 9 erledigt). Hinweis: Die Session squash-mergte wieder mit prosa-nahen Titeln, aber conventional-prefixed (feat:/fix:) — Guard hat das Release diesmal gesehen.

## 2026-06-11 (Session 9 — Claude Code: Lagebild + Ops-Sweep + M3.1 gemerged)

Einstieg per Maurice: "look at my Project repo … go on with the roadmap". Lagebild: v1.7.0 war über Nacht geshippt (Session 8), Handoff stale (sagte 1.6.0) → nachgezogen (beide Orte). **Ops-Sweep komplett:** (1) camofox-integration.yml-YAML-Fix — unquoted Doppelpunkte in drei Step-Namen → Parse-Error → roter 0s-Run auf JEDEM Push seit #56/09.06. (100/100 Failures, reine Noise). (2) Gitleaks-Fix — Dependabot-Runs bekommen keine Secrets → GITLEAKS_LICENSE leer → garantiert roter Check auf jedem Dependabot-PR; Job skippt Dependabot jetzt (7aaf8ac). (3) Node-20-Deadline 16.06.: alle 10 Dependabot-PRs gemerged (5 Actions-Majors + 5 Cargo-Patches), `cargo check` lokal grün (CI prüft Rust erst beim Tag-Build!). (4) PR #29 als superseded geschlossen (main hatte .hermes-Exclusion längst via #34/#59).

**M3.1 Re-Render-Storm gemerged** (PR #74, squash be47d88, 15/15 Checks): `useStableCallback`/`useStableCallbacks` (useEvent-Pattern; useState-Lazy-Init weil Repo-Lint Ref-im-Render verbietet und useMemo-Cache verwerfbar ist), alle ~55 Context-Funktions-Felder durch EINEN stabilen Bag + Value useMemo'd, GalleryCard in React.memo mit DEFAULT-Shallow-Compare (bewusst kein Feld-Whitelist-Comparator), onReapplyWatermark-Vertrag nimmt das Image (eliminiert Per-Card-Lambda), savedIdSet-Memo statt O(Cards×Saved). Adversarial-Review (12 Agents, 951k Tokens): **0 bestätigte Defekte**, Verifier bestätigten positiv Memo-Wirksamkeit/Deps-Vollständigkeit/keinen Effect-Verlust; 2 Hinweise übernommen (Docblock-Caveat für Layout-Effect-Caller; M3.1b-Follow-up: PostReadyCard hat dieselbe Krankheit, 12 Inline-Lambdas + kein memo). Kein Tag — M3 sammelt für EIN v1.8.0.

## 2026-06-10 (Session 7 — Claude Code: Roadmap → M1-Bundle → Director-Default → v1.6.0)

**Roadmap erstellt** aus Maurice' 10 Punkten (7-Agent-Investigation, jeder Punkt root-gecaused → 5 Milestones M1–M4 in ROADMAP.md). Maurice' Entscheidungen: M1 komplett zuerst, Serper als Trending-Default, Director wird Default-Pfad.

**M1 (PR #65, 4 Commits, squash `3acc830`):** (1) Director "empty prompt" — `openai(id)` → `openai.chat(id)` in generate-prompt.ts + critique-prompt.ts (MiniMax spricht nur chat-completions; der v1.5-Fix war nie in die Tools propagiert) + Route gibt jetzt 502 mit echtem Fehler statt silent `{prompt:''}`. (2) Higgsfield "connected" = CLI-Verfügbarkeit: Image- UND Video-Route nutzen die CLI, wenn Token gesetzt ODER OAuth fehlt aber CLI authentifiziert ist; Panel probt /api/higgsfield/cli-auth; Video bekommt CLI-Token-Parität. (3) `color-scheme: dark` — das offene Select-Popup wird vom OS gezeichnet und ignorierte Tailwind (White-on-White in WebView2). (4) Serper.dev: webSearchSerper + Serper→Brave→DDG-Chain in webSearch; /api/trending UND agent-tools/trending-search riefen webSearch vorher UNGEKEYT (nur bot-geblocktes DDG) — Root-Cause des ewigen "No trending data". SERPER_API_KEY-Config-Key; Maurice' Key in config.json, live getestet.

**Director-Default (PR #66, squash `e8ad7aa`):** Default-Flip + `applyV160DirectorDefaultMigration` (Store persistiert volle Settings — Flip allein erreicht Bestandsnutzer nie) + `directorPipelineUserSet`-Marker (Toggle stempelt explizite Wahl, Migration respektiert sie für immer). VOR dem Merge 17-Agent-Adversarial-Review (3 Lenses × Refutation): 14 Befunde, 9 bestätigt, 8 gefixt — BLOCKER: Continuous-Mode-Geld-Schleife (failed idea → 'idea' → re-cycle ohne Sleep = neuer bezahlter Director-Run pro Runde; Fix: Per-Idea-Memo + 2-Failure-Cap). Dazu: 3-min-Client-/4-min-Server-Timeout + skipSignal end-to-end (Skip bricht den bezahlten Run jetzt wirklich ab), DIRECTOR_FAILED-Sentinel + Plausibilitäts-Gate (Apology-Text ging vorher als Bildprompt durch → Bild-Credits für Fehlermeldungen), Caption-Fallback = kurzes Verbatim-Konzept statt Prompt-Jargon (6 Stellen), Marker-Pair-Guard im Recovery-Merge + localStorage-Invalidierung nach Store-Write + hydratedOnceRef heißt jetzt "Hydration ERFOLGREICH" (failed load kann den Store nicht mehr mit Defaults überschreiben). 1 Minor deferred → M3.

**Released:** [v1.6.0](https://github.com/4neverCompany/MashupForge/releases/tag/v1.6.0) — Empty-Bump-Guard misfired (Squash-Titel nicht conventional → via ALLOW_EMPTY_RELEASE=1, Regel ergänzt in release-flow.md), Build 16m09s, alle 4 Assets, Highlights im Body, published. 2037 Tests grün. **Nächster Einstieg: M2** (ROADMAP.md "NÄCHSTER EINSTIEG").

## 2026-06-10 (Session 6c — Claude Code: Maurices Reload-Bug → v1.4.7)

**Maurice-Report 07:45:** "Page reload → Verlust aller generierten Bilder + Watermark in Optionen weg." Analyse + Fix + Release in ~45 min.

**Diagnose:** Bilder-Hälfte = der v1.4.6-Debounce-Fix (Maurice war beim Reload noch auf v1.4.5). Watermark-Hälfte = NEUER Wipe-Vektor: useSettings hatte denselben Bug, den PR #59 nur in useImages gefixt hatte — DREI Writer (300ms-Debounce-IDB-Write, Unmount-Cleanup, beforeunload-Flush) nur auf isSettingsLoaded gated. Killer: Cleanup/Flush schrieben Defaults-Snapshots nach localStorage, die der nächste Load als "in-flight Patch" ÜBER den Store merged (patch wins) → Watermark-Reset bei jedem Reload. Familien-Audit fand zwei weitere: useComparison schrieb bei JEDEM Studio-Mount sofort `[]` über die Comparison-Results (deterministischer Wipe); useIdeas hatte das Stale-Gate-Fenster während Hydration.

**Fix (Commit `ae04b25`):** dirtyRef + loadInFlightRef in allen drei Hooks; useSettings zusätzlich hydratedOnceRef (localStorage-Writer verweigern bis hydrated) + pendingOpsRef (Prä-Hydration-Edits replayed auf Hydration-Ergebnis). Neue 7-Test-Suite `tests/integration/useSettings-wipe.test.tsx` pinnt alle Poison-Pfade. 1999/2013 Tests grün, tsc clean, eslint 0 errors.

**Released:** [v1.4.7](https://github.com/4neverCompany/MashupForge/releases/tag/v1.4.7) published 08:22 Berlin, alle 4 Assets, Highlights im Body.

**Bonus:** claude-mem-Plugin repariert — Plugin-Cache 13.5.2 hatte NULL node_modules (Worker starb an `Cannot find module 'zod/v3'`); `bun install` im Plugin-Root + Worker-Start (PID 77412, Port 37777).

**Empfehlung (3x bestätigt):** `usePersistentStore<T>`-Abstraktion extrahieren (4–8h) — 5 Hooks teilen das handgeschriebene Persistenz-Muster, 4 hatten Varianten desselben Wipe-Bugs.

## 2026-06-10 (Session 6b — Claude Code: v1.4.5 SHIPPED + PR #59 reconciliation)

**v1.4.5 PUBLISHED** — Build #27243145179 success, alle 4 Assets live (Setup 62 MB, Portable 95 MB, sig, latest.json), Highlights in den Release-Body übernommen. Wichtig: Der Bun-Build-Step scheiterte erneut im CI; der in Session 6 gefixte npm-Fallback (`npm install` statt `npm ci`) hat den Build gerettet. Bun-Step-Failure ist ein offenes Folgethema.

**PR #59 gefunden & reconciled** (Maurice' Hinweis "schau auf GitHub"): PR von 2026-06-09 22:57 mit externem Code-Review-Output. Unique Fixes: (1) Data-Loss-ROOT-CAUSE — der 200ms-debounced IDB-Write in useImages war der eigentliche Wipe-Vektor seit v1.2.5, jetzt gated auf loadTriggered+isImagesLoaded+dirty-Flag mit mergeById-Semantik; (2) cmd.exe-Command-Injection-Fix in cli-utils (shell:true → explizites cmd.exe-Spawn mit cross-spawn-Escaping); (3) CLI-Auth EINVAL-Fix (Node 22 .cmd-Spawn). Dupliziert mit main: Flush-Test, release.sh-Guard, CHANGELOG-Dedupe → aufgelöst (deren Guard-Variante mit ALLOW_EMPTY_RELEASE + Idempotenz-Dedupe behalten, VOR den Versions-Bump gezogen; mein 5-Test-Flush-File behalten).

**Adversarial-Review-Workflow über den reconcilten Diff** (13 Agents, Session-Limit killte die Verify-Phase — Findings manuell triagiert). 4 verified Findings gefixt (Commit cbbbfe2): (1) `as any` in backup/images.ts — der CI-Blocker im no-any-Gate; (2) Guard-Allowlist nahm feat!:/revert: nicht an + Regex-Dots ungeescaped → fixed-string awk; (3) win32-Escaping-Branch hatte NULL CI-Coverage (platform-gated) → needsShell injectable + 5 Injection-Tests; (4) Hydration-FAILURE war von leerer Library ununterscheidbar → hydrationFailedRef-Latch + loadInFlightRef, neue Regression-Tests. Dazu: alle 8 pre-existing react-hooks/set-state-in-effect ESLint-Errors gefixt (queueMicrotask-Konvention, eine dokumentierte Sync-Ausnahme im Data-Loss-Gate) — die hätten sonst das PR-Lint-Gate geblockt. pr-checks.yml npm-ci-Fallbacks gefixt.

**Stand:** PR-#59-Branch gepusht (cbbbfe2), CI läuft, Merge pending. vitest 1985/1999 (14 bekannte tauri-sqlite), eslint 0 errors, tsc clean.

## 2026-06-10 (Session 6 — Claude Code: v1.4.4 recovery → v1.4.5)

**Was:** Repo-Analyse nach 6x fehlgeschlagenem v1.4.4 Tauri-Build. Root causes gefunden + gefixt + v1.4.5 released.

**Bugs gefunden & gefixt (8 Commits auf main, `a84b76b`..`8511f03`):**
- **Turbopack build break (der 6x-Build-Killer):** ManualGenerationPanel ('use client') importierte lib/higgsfield/skills.ts mit top-level node:fs → Server Action `lib/actions/higgsfield-skills.ts` (Pattern von v1.3.1 virality fix).
- **tauri-plugin-fs fehlte komplett auf der Rust-Seite:** v1.4.4 shippte 11 JS-Callsites (@tauri-apps/plugin-fs in lib/images/storage.ts + lib/backup/images.ts) ohne Cargo-Dep, ohne .plugin()-Registrierung, ohne Capabilities → persist/backup/export/import/restore waren alles silent no-ops. Registriert + fs-Scopes in capabilities/default.json + asset:-CSP für lokale Bilder.
- **Backup-Pfade falsch:** getBackupDir landete in `Roaming\Documents` (Phantom-Ordner) statt User-Dokumente → documentDir(). backupHiggsfieldSalt las `Roaming\config.json`, desktop-env schreibt aber `Roaming\MashupForge\config.json` → configDir()/MashupForge.
- **CI tot auf main:** setup-node `cache: 'npm'` + npm-Fallback `npm ci` brauchen package-lock.json, das 9c17cfc gelöscht hat → cache-Option raus, Fallback auf `npm install`.
- **jsdom-Testumgebung kaputt:** "clean bun.lock" resolvte lru-cache auf 7.18.3, jsdom 29 braucht ^11 → 6 Test-Files liefen still gar nicht. Re-resolved (11.5.1), jsdom explizit in devDependencies.
- **Veralteter Test:** useImages-flush.test.tsx pinnte den v1.2.7-Contract; auf v1.4.4-Contract (Listener unconditional + Flush verweigert leeres Array) umgeschrieben, 5 Tests.
- **release.sh empty-bump guard:** bricht ab wenn keine echten Commits seit letztem Tag (8 von 10 letzten Releases waren leer, ~3h CI verschwendet). --force Override.
- Cleanups: hardcoded version '1.3.1' in Backup-Metadata → package.json-derived; v1.2.6→v1.2.7 Doc-Referenz; CHANGELOG 3x-dupliziertes 1.4.4-Entry dedupliziert.

**Verifikation:** vitest 1968/1982 (nur die 14 bekannten tauri-sqlite-Failures, Maurice-akzeptiert), tsc clean, next build grün (Studio 270 KB < 300-KB-Budget), cargo check grün. CI auf main wieder success (run 27243135203).

**Released:** v1.4.5 getaggt (Highlights in docs/changelog-highlights/1.4.5.md), Tauri Windows Build #27243145179 in flight.

**Operational:** git push brauchte repo-lokalen Fix: globale .gitconfig pinnt `credential.https://github.com.username=4neverCompany`, gh-Account heißt aber `Code4neverCompany` → Mismatch, gh-Helper liefert kein Token, git prompted ins Leere. Fix: `git config --local credential.https://github.com.username Code4neverCompany`.

**Offen / für Maurice:** (1) v1.4.4-Tag zeigt auf dangling Commit ece3a1b — kann gelöscht werden, Release war nie published. (2) 8 pre-existing ESLint-Errors (react-hooks/set-state-in-effect) in useCollections/useComparison/useIdeas/useImageSrc/useImages/useSettings + ManualGenerationPanel — seit v1.0.6 wieder reingerutscht, eigener Cleanup. (3) pnpm-lock.yaml/pnpm-workspace.yaml/.mavis/ untracked im Repo-Root — Cruft, klären ob löschen. (4) Manuelle QA nach Update: Bild generieren → "saved locally" Badge, Export/Import/Restore in Settings, Backup-Ordner in Dokumenten.

## 2026-06-08 (Session 5 — v1.2.5 hotfix ship)

**Was:** 4 follow-up bugs Maurice während v1.2.4-testing gefunden → v1.2.5 hotfix: Higgsfield OAuth hang (CLI token entry), Settings reset on Back/Reload (unmount flush), "No trending data" (hybrid trending), AI nutzt keine skills (activeSkills threading).

**Shipped:**
- Commit d178785, 14 files, +282/-17, tag v1.2.5, Tauri Windows Build #27152860393 in progress
- CLI token plumbing: UserSettings.higgsfieldCliToken → SettingsModal → aiClient.StreamAIOptions → /api/ai/prompt body → setProviderRuntimeConfig({higgsfieldCliToken}) → registry invalidates higgsfield singleton → fresh adapter with cliToken → CLI adapter forwards HIGGSFIELD_API_KEY env to @higgsfield/cli binary
- 2 new V1.2.5 tests in tests/lib/providers/registry.test.ts (1830 pass total)

**Decisions:**
- CLI token > OAuth for poweruser (Maurice hat @higgsfield/cli lokal). OAuth bleibt default für new users.
- Synchronous localStorage.setItem in useSettings unmount (Back/Reload ohne beforeunload)
- fetchTrendingHybrid statt direkter /api/trending call (camofox-sidecar-UNHEALTHY-fallback)
- Skill-UI "manuell adden" → deferred to v1.2.6 (real feature, nicht hotfix)
- Vercel-AI tool-call verification → deferred to v1.2.6 (Maurice ist der einzige path)

**Next:** Auf v1.2.5 build warten (cron self-reminder alle 5min), dann GitHub release mit NSIS+sig+latest.json hochladen. Maurice installiert + retestet alle 4 fixes.

## 2026-06-08 (Session 4 — manual takeover + handoff-folder update)

**Was:** 5/8 v1.1.3 + v1.2 Tasks per Team-Plan gecancelt (30-min hard cap hat big tasks gekillt), übrige manuell abgeschlossen. Handoff-Folder mit aktuellem shipped-state geupdated.

**Highlights:**
- 5 feature branches auf origin pushed: v113-camofox-cors, orch-trending-hybrid, v12-tool-registry, v12-provider-wrappers, v12-director
- v12-director code (vom recovered-but-killed worker) recovered + tsc clean + vitest 8/8 grün + pushed
- Mavis-Team-Plan (plan_d08790e2) offiziell cancelled nach 4 cycles
- Handoff-Folder STATE.md + ACTIVE-CONTEXT.md mit shipped-state geupdated
- Memory: 2 neue agent-memory-entries (board status staleness, 30-min hard cap), 1 user-memory-entry (4th instance task-prompt misconception)

**Decisions:**
- ADR-008: Mavis-Team-Plan gecancelt, 30-min hard cap zu klein für big tasks → manuelle Übernahme für übrige v1.2 pieces
- ADR-009: Handoff-Folder ist die source of truth für agent-continuity, jeder agent updated bei state-change

**Wartet auf Maurice:**
- 5 branches mergen in main, release taggen (v1.1.3 + v1.2 separat oder als v1.2.0 mega)
- v12-eval-hil grünes Licht (oder als follow-up später)
- E2E tests (d-integration, v12-integration) manuell durchführen wenn build läuft

---

## 2026-06-07 (Session 3 — v1.1.2 release + Mavis-Team-Plan + cancelled)

**Was:** v1.1.2 shippen, Mavis-Team-Plan für D + v1.2 Epic starten, 4 cycles durchkämpfen bis cancellation.

**Highlights:**
- v1.1.2 ship + release (Tauri-Build 17m22s, NSIS + portable)
- 5/8 Tasks der D + v1.2 Epic in 4 cycles fertig (alle Tests grün, alle branches auf origin)
- 3 Tasks per 30-min hard cap gekillt (v12-director, d-orchestration original, v12-provider-wrappers original) — retry mit override_accept gelöst
- 2 E2E-Tests (d-integration, v12-integration) sind von anfang an manuelle tests
- v12-eval-hil (4 heuristics + HIL checkpoint) als großer task noch offen

**Decisions:**
- ADR-004: single-instance plugin VOR deep-link (v1.1.2)
- ADR-005: CLI > MCP für v1.2+ agentic AI
- ADR-006: Handoff-Folder als Agent-Continuity-Mechanismus
- ADR-007: 3 Handoff-Defaults (Location, MCP-target, SESSION-LOG-scope)
- ADR-008: Mavis-Team-Plan cancelled, manuell weiter

---

## 2026-06-07 (Session 2 — v1.1.2 hotfix release)

**Was:** 2 Bugs aus Maurice's v1.1.1-Test fixen: Higgsfield OAuth öffnete neues Fenster, camofox-only trending statt 3-way-fanout.

**Commits (3):**
- `cf3cb8e` fix(api/trending): camofox-only fan-out (drop SearXNG + Reddit-JSON)
- `9427348` fix(tauri+api/trending): single-instance plugin + camofox-only rewrite
- `b1a6984` chore(release): v1.1.2 — version bump + CHANGELOG + HANDOFF §20
- `febb394` v1.1.2 — single-instance OAuth + camofox-only trending (#58) — merge commit

**Tests:** 1366/1366 vitest passing, neue `trending-camofox-only.test.ts` mit 6 tests (vi.doMock+vi.resetModules pattern).

**Build:** Tauri-Windows 17m22s, NSIS + portable + sig + latest.json.

---

## 2026-06-07 (Session 1 — v1.1.1 release + agentic-research)

**Was:** v1.1.1 shippen (multi-provider video, skills auto-use, 4 hotfixes). Research zu MCP vs CLI für agentic AI.

**Highlights:**
- 5+ Commits in PR #57
- Vercel AI SDK 6.0.191 + Zod 4.4.3 confirmed in repo
- Memory lessons: vi.doMock+resetModules, MCP→CLI shift (10-32x evidence), M3≠video generator, Next.js 15 dynamic params, Git LF/CRLF gotcha
- v1.1.1 release tagged, Tauri build successful

---

## 2026-06-06 (Session 1 — v1.1.0 + camofox integration)

**Was:** v1.1.0 mit camofox-browser sidecar integration, Higgsfield OAuth deep-link, MCSLA director protocol, 5-bug hotfix batch.

**Highlights:**
- camofox-browser sidecar v1.11.2 als optionaler 2nd sidecar (Tauri-only)
- Higgsfield OAuth via `mashupforge://` deep-link + on_open_url handler
- Vercel-Build-Cache stale nach GitHub org-transfer (Code4neverCompany → 4neverCompany), workaround: `vercel deploy --prod --force`
- Leonardo AI integration, prompt_enhance model-spec honoring

**Vollständige Details:** siehe HANDOFF.md im Repo (sections 1-19)
