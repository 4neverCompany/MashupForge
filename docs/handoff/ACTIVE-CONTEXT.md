# Active Context

> **Was ist grad in flight?** Lese das hier, um zu wissen welche Threads offen sind, ohne SESSION-LOG durchsuchen zu müssen.

## ⚡ AKTUELL (2026-06-11): v1.7.0 SHIPPED (M2 ✅) — Einstieg = M3 + Ops-Pflichten

**v1.7.0 published** (00:41 UTC, von einer parallelen Session): M2 komplett
(#69 Camera-Angle per Image, #70 Skill-Routing) + #71 Director-Clean-Prompt,
#72 Pipeline-Higgsfield (verbraucht jetzt echte Credits!), #73
Watermark-Timeout. Handoff wurde von dieser Session NICHT nachgezogen —
jetzt erledigt.

**Ops-Pflichten: ✅ ALLE ERLEDIGT (11.06. vormittags):**
1. ✅ camofox-integration.yml-YAML-Fix (649b4ac).
2. ✅ Node-20-Deadline: alle 10 Dependabot-PRs gemerged (checkout@6,
   setup-node@6, upload-artifact@7, download-artifact@8, cache@5 + 5
   Cargo-Patches inkl. tauri 2.11.2); `cargo check` lokal verifiziert
   (reguläre CI prüft Rust nicht!). Gitleaks skippt jetzt Dependabot
   (7aaf8ac — Dependabot-Runs haben keine Secrets → war garantiert rot).
   PR #29 als superseded geschlossen. Offen: Vercel-Drafts #67/#11
   (= Maurice' Call). gitleaks-action@v2 selbst ist Node 20 (upstream).

**M3-Fortschritt:**
- ✅ **M3.1 Re-Render-Storm** gemerged (PR #74, be47d88): neuer
  `hooks/useStableCallback.ts` (useEvent-Pattern, useState-Lazy-Init),
  alle ~55 MashupContext-Funktions-Felder identitätsstabil + Value
  memoized, GalleryCard in React.memo. Review (12 Agents): 0 Defekte.
- ✅ **M3.1b PostReadyCard** gemerged (PR #76, 911b2ee): Image-passing
  Handler-Vertrag + EIN useStableCallbacks-Bag statt 13 Inline-Lambdas,
  memoized availablePlatformsList/allScheduledPosts, React.memo.
  REST: PostReadyCarouselCard (Carousel-Variante) ist weiterhin
  unmemoized — bei Bedarf gleiche Behandlung.
- ✅ **Vercel Web Analytics** gemerged (PR #75, 89d1e66; Maurice' JA
  11.06.): `components/WebAnalytics.tsx` rendert NUR im Web-Build
  (Tauri-Marker-Guard — sonst 404-Beacons bei jedem Desktop-Start);
  Drafts #67/#11 als superseded geschlossen. Daten fließen, sobald
  Analytics im Vercel-Dashboard fürs Projekt aktiv ist.
- ✅ **M3.2 Store-Slimming** gemerged (PR #77, 11187fc). WICHTIG —
  Roadmap-Annahme war FALSCH: comparison_results war LEER; die echten
  217,7 MB = 103 MB saved_images (236/259 Einträge mit data:-URLs,
  NULL localPath — v1.4.4-File-per-Image hing am toten generateImages-
  Pfad) + 103 MB Backup-Duplikat + 11 MB Settings. Fix: lib/images/
  slim.ts, saveImage slimmt async, Once-per-Session-Backlog-Migration
  (Store-Writes währenddessen unterdrückt), Backup geslimmt
  (localPath-Guard), ensureHostedUrl mit asset-Branch VOR dem
  http-Passthrough (Windows-Form http://asset.localhost!). Geslimmte
  Records tragen die asset-URL im url-Feld → null Render-/Posting-
  Stellen geändert. **Maurice sollte nach dem nächsten Release einen
  Desktop-Smoke machen**: Migration läuft beim ersten Launch (~236
  Disk-Writes), danach Bilder sichtbar + Post Now testen.
- ▶ **M3.2b = NÄCHSTER EINSTIEG: settings.watermark = 10,7 MB** —
  das Wasserzeichen-BILD liegt als data-URL in den Settings; JEDER
  Settings-Save (300ms-Debounce) serialisiert 11 MB, der beforeunload-
  localStorage-Flush kämpft mit der Quota. Fix-Richtung: Bild als
  Datei (images-Dir oder config-Dir), Pfad/Referenz in den Settings;
  Konsumenten: applyWatermark, lib/pipeline-finalize, SettingsModal-
  Upload-UI, lib/caption-edit?-nein. Danach ist der Store KB-groß.
- ▶ **M3.3 Cleanup — Maurice' OK liegt vor (11.06.)**: docs/bmad (+
  docs/working-folder, 27MB Landing-PNGs) waren Produktions-Artefakte,
  werden nicht mehr genutzt → aus dem Repo entfernen (vorher lokales
  Backup außerhalb git ziehen!). Dazu pi/nca/mmx-Dead-Code (~2300 LOC)
  und der deferred Pre-Hydration-Befund. KEIN Tag bis das M3-Bundle
  steht → EIN v1.8.0-Vorschlag, Maurice' OK abwarten.
- Rest-Notiz: PostReadyCarouselCard weiterhin unmemoized; Export-
  Funktion (exportImagesToFile) exportiert weiterhin fette Records.

**Operating Rules (unverändert gültig):** Batch-Releases (nicht pro PR
taggen, Maurice' OK abwarten — .claude/rules/release-flow.md im App-Repo);
Squash-Merge-Titel MÜSSEN conventional-commit sein (sonst übersieht der
Empty-Bump-Guard das Release); Bash-cwd driftet → `git -C` + absolute Pfade.

**Bekannte Schulden** (Abschnitt "Bekannte Schulden aus v1.6.0" in
ROADMAP.md): CHANGELOG ohne Versions-Header (kosmetisch), deferred
Review-Befund Pre-Hydration-Opt-out (M3), usePersistentStore-Extraktion
(Empfehlung aus v1.4.7, weiter offen).

---

## ARCHIV (überholt): v1.4.5 BUILDING (Tauri Windows Build #27243145179)

v1.4.4-Recovery-Release. 8 Commits (`a84b76b`..`8511f03`): Turbopack-Fix
(node:fs im Client-Bundle), tauri-plugin-fs Rust-Registrierung (alle
Disk-Features waren silent no-ops), Backup-Pfad-Fixes, CI-Fix
(package-lock.json-Abhängigkeit), jsdom-Test-Env-Recovery, release.sh
empty-bump guard. Details: STATE.md + SESSION-LOG.md Session 6.

---

## ARCHIV (überholt): v1.2.5 BUILDING (Tauri Windows Build #27152860393)

Commit d178785, 14 files, +282/-17. Four follow-up bugs from Maurice's v1.2.4 testing:

1. **Higgsfield OAuth hang** → CLI token entry (Settings → HiggsfieldConnection). Stored in `localStorage.mashup_settings.higgsfieldCliToken`, forwarded to `@higgsfield/cli` binary as `HIGGSFIELD_API_KEY` env. OAuth flow stays as default for new users.
2. **Settings reset on Back/Reload** → synchronous `localStorage.setItem` flush in `useSettings` unmount cleanup.
3. **"No trending data found"** → useIdeaProcessor now routes through `fetchTrendingHybrid` (existing v1.2.0 orchestrator) instead of calling `/api/trending` directly.
4. **AI did not use enabled skills** → `streamAIToString` call now passes `activeSkills: s.activeSkills ?? []` so `buildSkillSystemBlock` actually injects the skill bodies.

CLI token plumbing: UserSettings.higgsfieldCliToken → SettingsModal → aiClient.StreamAIOptions → /api/ai/prompt body → setProviderRuntimeConfig({higgsfieldCliToken}) → registry invalidates higgsfield singleton → fresh adapter with cliToken → CLI adapter forwards HIGGSFIELD_API_KEY env to @higgsfield/cli binary.

Tests: 1830 pass, 2 new V1.2.5 (registry.setProviderRuntimeConfig). Typecheck clean.

## Shipped (wartet auf Maurice's greenlight zum MR-Mergen)

5 feature branches ready to merge into main:

| Branch | Commit | Inhalt | MR? |
|---|---|---|---|
| `feature/v113-camofox-cors` | 2be4f76 | d-networking: camofox CORS-Web-Build, standalone-install-Doc, CORS-Proxy-Workaround | NEIN — Maurice muss MR öffnen (oder ich in nächstem cycle) |
| `feature/orch-trending-hybrid` | db851aa | d-orchestration: Tauri-Command camofox_search + Hybrid Trending Route | NEIN |
| `feature/v12-tool-registry` | aed1a54 | v1.2 Tool Registry (6 tools) | NEIN |
| `feature/v12-provider-wrappers` | e186c9b | v1.2 Provider Wrappers (4 adapters + 60s timeout) | NEIN |
| `feature/v12-director` | ca88bcd | v1.2 Director Route 2.0 (stopWhen loop + budget) | NEIN |

**Maurice' decision pending:**
- v1.1.3 release taggen aus d-networking + d-orchestration (camofox-client-side) → main → tauri-windows.yml tag build → NSIS + portable
- v1.2 release taggen aus v12-* branches (5 commits) → main → tauri-windows.yml tag build → NSIS + portable
- Order: v1.1.3 zuerst, dann v1.2 (oder beides in einem release?)
- Alternativ: alle in einer v1.2.0 mega-release

## Offene Threads (3 von 8 Tasks)

- **v12-eval-hil** — Eval Heuristics (4 checks: niche-coverage, camera-angle, anti-ai-look, length-budget) + HIL Checkpoint + `/api/ai/confirm` endpoint + UI Modal in MashupForge Studio Style. War im plan, ist aber zu groß für 30-min cap → manuell als nächstes
- **d-integration E2E** — Test dass camofox client-side auf Tauri + Vercel-Web funktioniert. Braucht Tauri-Build + manuellen Test (Sidecar starten, curl, etc.). Maurice's manual test
- **v12-integration E2E** — Test dass agentic loop + tools + HIL + cost tracking funktioniert. Braucht echte AI-Provider-Keys. Maurice's manual test

## Decisions-pending (brauchen Maurice's Sign-off)

| Decision | Vorschlag | Wartet seit |
|---|---|---|
| v1.1.3 + v1.2 als 2 separate Releases oder 1 v1.2.0? | 2 separate (cleaner changelog, less risk) | 2026-06-07 |
| HIL Threshold default? | $0.50/request hard-stop, override per UI | offen |
| MinimaxVideoAdapter.pollTask placeholder? | Echte Implementierung via mmx status subcommand (wartet auf mmx) | offen |
| Handoff-Folder MCP-Server? | LATER (file-system reicht, MCP-Routing nice-to-have) | 2026-06-07 |

## Recently Resolved (last 24h)

- 2026-06-08 01:30: 5/8 v1.1.3 + v1.2 Tasks SHIPPED auf origin
- 2026-06-07 22:13: Mavis-Team-Plan gecancelt (4 cycles, 30-min cap zu klein für big tasks)
- 2026-06-07 17:09: v1.1.2 SHIPPED + released
- 2026-06-07 19:24: Mavis-Team-Plan gestartet (8 tasks, 4 cycles, endete in cancellation)
- 2026-06-07 19:13: v1.1.2 Handoff-Folder angelegt mit 9 files
- 2026-06-07 19:13: Maurice approved D + v1.2 Epic als Mavis-Team-Plan

## In-Flight-Items

- **Handoff-Folder (dieser Ordner) wird grad aufgebaut** — Stand 2026-06-08 01:30, STATE.md + SESSION-LOG.md + DECISIONS.md + PITFALLS.md + ROADMAP.md + humans/MAURICE.md + ARCHITECTURE.md + ACTIVE-CONTEXT.md + README.md sind alle aktuell
- **5 Worktrees existieren noch in I:\c4n-MashupForge\.worktrees\** — können für MR-Erstellung oder Maurice's Review genutzt werden, cleanup nach merge
