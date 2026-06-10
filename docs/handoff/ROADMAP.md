# MashupForge Roadmap

> Erstellt 2026-06-10 aus Maurice' 10 Punkten, fundiert durch eine 7-Agent
> Code-Investigation (jeder Punkt root-gecaused + Aufwand + Abhängigkeiten).
> Status: 🟡 geplant · 🔵 in Arbeit · ✅ done. Aktuelle App-Version: **1.6.0**.
> Release-Konvention: NICHT pro Fix taggen — pro Milestone EIN gebündeltes
> Release vorschlagen + Maurice' OK abwarten (siehe .claude/rules/release-flow.md).

> **✅ M1 KOMPLETT + Fast-Follow — released als v1.6.0 (2026-06-10).**
> PR #65 (M1.1–M1.4) + PR #66 (Director als Default-Pipeline-Pfad inkl.
> 17-Agent-Review-Härtung: Per-Idea-Kosten-Memo, 3/4-min-Timeouts +
> Skip-Abort, DIRECTOR_FAILED-Sentinel + Plausibilitäts-Gate,
> Caption-Fallback = Verbatim-Konzept, Marker-Pair-Guard in der
> Settings-Persistenz). Serper-Key ist auf Maurice' Maschine in
> config.json hinterlegt. Nächster Milestone: **M2** (→ v1.7.0).

## ▶ NÄCHSTER EINSTIEG (für den nächsten Agent-Run)

**Start bei M2 — "Smartere AI" (→ v1.7.0).** Kein offener Rest aus M1/v1.6.0;
das Release ist published, Highlights im Body, Handoff aktuell. Konkret:

1. **M2.1 Kontextueller Camera-Angle** (Quick-Win, Option 1A — kein
   Agent-Loop nötig): Im Ideen-Generierungs-Prompt `cameraAngle` pro Item
   anfordern (14-Angle-Katalog aus `lib/camera-angles.ts` als Menü mitgeben),
   dann `item.cameraAngle` statt `settings.cameraAngle` lesen
   (`hooks/useImageGeneration.ts:1011`). `buildMcslaFragment` resolved Slugs
   bereits — Builder-Seite null Änderung. Settings-Picker wird zum
   "Default/Lock" umdeklariert.
2. **M2.2 Automatische Skill-Selektion**: Skill-INDEX (name+description aus
   `SkillMeta`) statt aller Bodies injizieren (`lib/skill-loader.ts`,
   `buildSkillSystemBlock` dumpt aktuell ALLE aktiven Skills) + Anweisung
   "wende nur passende an". Agentic-Variante (select_skill-Tool) ist jetzt
   möglich, da der Director seit v1.6.0 der Default-Pfad ist.
3. **Arbeitsweise**: Feature-Branch → PR → CI grün → Merge (Squash-Titel
   conventional!). NICHT taggen — M2 sammeln und EIN v1.7.0-Release
   vorschlagen, Maurice' OK abwarten (release-flow.md).

**Vorher kurz prüfen:** `gh release view v1.6.0` (User-Feedback/Issues nach
dem Auto-Update?) und ob Maurice den Director im Alltag stabil erlebt —
falls nein, hat Stabilisierung Vorrang vor M2.

## Maurice' 10 Punkte → 5 Milestones

| # | Maurices Punkt | Milestone |
|---|---|---|
| 1 | Director "empty prompt" | M1 |
| 2 | "Connect Higgsfield before generating"-Error | M1 |
| 3 | Pipeline Generate-UI buggy + hardcoded "not connected" | M1 |
| 4 | camofox/"No trending data" — bessere Such-Defaults | M1 |
| 5 | Camera-Angle als Skill statt fixes Setting | M2 |
| 6 | AI automatic skill usage | M2 |
| 7 | AI improvement | M2 |
| 8 | Speed/Effizienz-Check | M3 |
| 9 | Code-/Repo-Cleanup (pi.dev-Reste etc.) | M3 |
| 10 | Settings-Tabs aufgeräumter/intuitiver | M4 |

Sequenz-Prinzip: **Bugs zuerst** (du kannst aktuell nicht generieren), dann
AI-Features, dann Perf+Cleanup (parallel), zuletzt die großen Refactors.

---

## ✅ M1 — "Pipeline & Higgsfield funktionieren" (Bug-Bundle) → v1.6.0 (RELEASED 2026-06-10)

**Warum zuerst:** Punkte 1–4 blockieren die Kernfunktion — Generieren wirft
Fehler, der agentic Pipeline liefert leere Prompts, Trending bleibt leer.
**Aufwand gesamt: ~3–4 Tage. EIN Release.**

### M1.1 — Director "empty prompt" fixen ⚡ (Aufwand S, höchste Priorität)
**Root-Cause gefunden:** Mein v1.5 `.chat()`-Fix (MiniMax spricht nur
`/v1/chat/completions`, nicht die Responses-API) wurde in den Loop-Model-
Resolver gesetzt, aber **nie in die Tools propagiert**. `lib/agent-tools/
generate-prompt.ts:67` und `critique-prompt.ts:283` nutzen noch `openai(modelId)`
(Responses-API → 404 auf MiniMax) → das `generate_prompt`-Tool wirft, der Loop
extrahiert keinen Prompt → leer.
- Fix: `openai(modelId)` → `openai.chat(modelId)` in beiden Tools (je MiniMax-
  UND OpenAI-Branch). Alle `openai(` unter `lib/agent-tools/` auditieren.
- Plus: bei leerem `finalPrompt` + `truncatedBy:'error'` echten Fehler
  (letzter Step `reasoning`) zurückgeben statt still `{prompt:''}` →
  diagnostizierbar im Pipeline-Log.
- Test ergänzen, der `.chat()`-Resolution in den Tools asserted (der bestehende
  Test mockt ToolLoopAgent und hat genau diese Lücke durchgelassen).

### M1.2 — Higgsfield "connected" = CLI-Verfügbarkeit (Aufwand M)
**Root-Cause:** `settings.higgsfieldConnected` ist OAuth-only; die in v1.5.2
gebündelte CLI (`HIGGSFIELD_BIN`) setzt das Flag nie → der Guard
`if (provider==='higgsfield' && !settings.higgsfieldConnected)` (ManualGenerationPanel)
blockt, obwohl die CLI da ist.
- "ready" = OAuth-connected **ODER** cliToken gesetzt **ODER** CLI verfügbar
  (probe `/api/higgsfield/cli-auth`). Guard + Label entsprechend lockern.
- In `/api/higgsfield/image` + `/video` einen CLI-Pfad VOR dem OAuth-Block
  ergänzen (sonst 401 trotz gelockertem Guard).
- Web-Build hat kein `HIGGSFIELD_BIN` → fällt sauber auf OAuth-Flag zurück.

### M1.3 — Pipeline Generate-UI Visual-Glitch ⚡ (Aufwand S, 5-Min Quick-Win)
**Root-Cause:** Das weiße Overlay über dem Model-Picker (dein Screenshot) =
native `<select>` ohne `color-scheme: dark`. Browser rendert die Dropdown-
Liste hell.
- `select { color-scheme: dark; }` global in globals.css → fixt ALLE Dropdowns
  app-weit. Das hardcoded "(not connected)" verschwindet automatisch mit M1.2.

### M1.4 — Trending: zuverlässigeres Such-Backend (Aufwand M)
**Root-Cause (dreifach):** (a) DDG blockt server-seitige Scrapes jetzt (202 +
Anomaly-Page, live bestätigt) → der v1.5-Fallback ist faktisch tot. (b) Der
Brave-Pfad ist in `/api/trending` **nie verdrahtet** (route.ts:193 ruft
`webSearch` ohne Brave-Key, anders als die anderen 4 Call-Sites). (c) Braves
Free-Tier wurde **Feb 2026 abgeschafft** (jetzt ~$5/1k).
- Quick-Win ⚡: Brave-Key in `/api/trending` durchreichen (~3 Zeilen) → hilft
  sofort jedem mit Brave-Key.
- **Empfehlung (neuer Default): Serper.dev** — echtes 2.500-Queries/Monat
  Free-Tier, keine Kreditkarte, zuverlässige Google-Results + Snippets.
  `webSearchSerper()` in lib/web-search.ts, `SERPER_API_KEY` als Desktop-
  Config-Key, Chain: Serper → Brave → DDG (last-resort). camofox bleibt
  optionaler Primary für Self-Hoster.
- Veralteten "Free tier 2000/mo"-Hinweis bei Brave korrigieren.

---

## 🔵 M2 — "Smartere AI" (Skills + Camera-Angle kontextuell) → v1.7.0

**Warum danach:** Baut auf M1 (funktionierender Director). **Aufwand ~2–3 Tage.**
**Kernproblem:** Skills sind statischer System-Prompt-Kontext (ALLE aktiven
Skills werden immer injiziert), die AI **wählt nie** — ein Noir-Portrait und
eine bunte Schlachtszene bekommen identischen Skill-Kontext + identischen
Camera-Angle.

### M2.1 — Kontextueller Camera-Angle ⚡ (Aufwand M, Quick-Win)
**Punkt 5.** Statt fixes `settings.cameraAngle`: die AI wählt pro Prompt den
passenden Winkel aus dem 14-Angle-Katalog (`lib/camera-angles.ts`, mit
emotionalem `intent`).
- Option 1A (kein Agent-Loop nötig): Im Ideen-Prompt `cameraAngle` pro Item
  anfordern + den 14-Angle-Katalog als Menü mitgeben; `item.cameraAngle` statt
  `settings.cameraAngle` lesen (useImageGeneration.ts:1011). `buildMcslaFragment`
  resolved jeden Slug schon → Builder-Seite null Änderung.
- Settings-Picker wird vom "globalen Wert" zum "Default/Lock" (User kann pinnen).

### M2.2 — Automatische Skill-Selektion (Aufwand M)
**Punkte 6+7.** Statt alle Skill-Bodies immer zu dumpen: einen Skill-INDEX
(name + description, schon geparsed als `SkillMeta`) injizieren + "wende nur
den/die zum Prompt/Thema passenden Skill(s) an". Skaliert + gibt der AI
echtes per-Prompt-Routing.
- Tiefere Variante (agentic): `select_skill` / `cameraAngle`-Enum als Tool in
  agent-tools/schemas.ts → der Director-Model wählt. Voraussetzung erfüllt:
  der Director IST seit v1.6.0 der Default-Pfad (Opt-out in Settings).

---

## 🟢 M3 — "Schneller & sauberer" (Perf + Cleanup, paralleler Track) → v1.8.0

**Wichtige Ehrlichkeit:** Das Entfernen von pi/nca/mmx macht die App **NICHT**
schneller (server-only, nicht im Client-Bundle/Startup). Cleanup ist für
Wartbarkeit; Speed kommt aus den Render-/Persistenz-Levers.

### M3.1 — Re-Render-Storm killen ⚡ (Aufwand S, größter gefühlter Speed-Win)
**Punkt 8.** Das `MashupContext`-Value-Objekt wird bei jedem Render neu erzeugt
(MashupContext.tsx:577) → JEDER Consumer re-rendert bei jeder State-Änderung
irgendwo (ein saveImage, ein Pipeline-Tick, ein Settings-Tastendruck). Gallery
mappt un-memoized `GalleryCard`s, jede re-runnt useImageSrc's async asset://-
Resolution → O(N) IPC-Calls beim Scrollen während die Pipeline tickt.
- `useMemo` aufs Context-Value (oder in 2–3 Contexts splitten: data/pipeline/ui).
- `React.memo` auf GalleryCard mit Comparator auf id/localPath/url/status.
- gefilterte/sortierte Image-Listen in MainContent memoizen.

### M3.2 — Comparison-Results auf Disk (Aufwand M)
**Das 100MB-JSON-Problem ist nur halb gelöst:** v1.4.4 lagerte Gallery-Pixel
aus, aber `mashup_comparison_results` (useComparison.ts) speichert noch
GeneratedImage[] **mit eingebettetem base64**. Ein Heavy-Compare-User hat
weiter ein Multi-MB-bis-100MB-JSON, das der plugin-store eager parsed.
- Comparison-Candidates wie Gallery-Bilder auf Disk (reuse persistApprovedImageToDisk),
  nur Thin-Metadata im JSON. Einmalige Migration die base64 strippt.
- Optional: mashup_saved_images in eigene Store-Datei (damit ein Settings-Read
  nicht das Image-Metadata-Array mitzieht).

### M3.3 — Code-/Repo-Cleanup (Aufwand L, phasenweise)
**Punkt 9.** Definition "aufgeräumt" hier: kein toter Provider-Code, keine
projektfremden Assets im Repo, keine Duplikate, eine PM-Lockfile-Wahrheit.
- **P1 Zero-Risk Declutter ⚡ (S):** `pnpm-lock.yaml`/`pnpm-workspace.yaml` löschen
  (bun ist kanonisch); `docs/working-folder/{landing-screens,png-sources}`
  git-rm (~27MB Marketing-PNGs in der git-Historie einer Desktop-App) +
  gitignoren. ⚠ Erst mit dir klären ob die Landing-Repo das braucht.
- **P2 Confirmed-Dead (S):** `lib/providers/mmx/cli-adapter.ts` + Registry-
  Wiring löschen (0 Caller); `text-model-specs.ts`-Shim auf -catalog migrieren
  + löschen.
- **P3 Tote Subprocess-Agents retiren (M, vorsichtig):** pi (app/api/pi ~708 LOC,
  pi-client/pi-setup, Pi.dev-Card), nca (~639 LOC), mmx-TEXT-Pfad. **KRITISCH:**
  erst aiClient-Default von pi→vercel-ai flippen, DANN löschen. `lib/mmx-client.ts`
  + multimodale mmx-Routes NICHT anfassen (lebendig).
- **P4 God-File-Splits (L, eigener Track, NICHT mit P3 bündeln):** MainContent
  (5163 LOC), SettingsModal (2649), useImageGeneration (1672) — eine Datei pro PR.
- **Dead Dep ⚡:** `@mariozechner/pi-ai` (0 Imports) aus package.json.

### M3.4 — Bundle-Code-Splitting (Aufwand M)
Settings-Panel + react-markdown aus dem /studio-First-Load via `dynamic(ssr:false)`
(beide sind hinter User-Interaktion). Mit check-bundle-size.mjs verifizieren.

---

## 🎨 M4 — Settings-Redesign (großer UI-Refactor) → v1.9.0

**Punkt 10.** SettingsModal ist 2649 Zeilen, 5 Tabs mit **inkohärenten Grenzen**:
Image-Settings über 3 Tabs verstreut, Video-Model-Select an 2 Stellen die um
denselben Key kämpfen, 2 Tabs physisch in interleaved JSX-Blöcke gesplittet.
**Aufwand ~3 Tage. Am besten NACH M3.3-Cleanup (beide fassen SettingsModal an).**

- **Quick-Wins ⚡ (S, sofort möglich, kein IA-Change):** `Switch`-Komponente aus
  ToggleRow extrahieren + die 4+ handgerollten Toggles ersetzen; Video-Model-
  Select-Duplikat auflösen; die 2 gesplitteten Tab-Blöcke zu je einem
  zusammenführen (reiner Code-Move, macht die Datei lesbar).
- **Neue IA (L):** 6 intent-basierte Tabs — General · AI Engine (AI-Agent +
  AI-Engine mergen) · Image & Video · Providers & Keys · Credits ·
  Desktop/Advanced. Unified Control-Kit, ein Accent-Color.
- Kein Backend-/Settings-Shape-Change — reiner UI-Reshuffle.

---

## Abhängigkeiten (kompakt)
- M1.1 (Director-Fix) standalone — der 2-Zeilen-Win, sofort.
- M1.3 (CSS) standalone, 5 Min.
- M2 baut auf M1 (funktionierender Director).
- M2.2-agentic + M2.1-Option-B brauchen den Director als Default-Pfad.
- M3.3-P3 braucht erst aiClient-Default-Flip.
- M4 und M3.3-P4 fassen beide SettingsModal/MainContent an → sequenzieren.
- M3.1 (Memoization) standalone — sollte zuerst (größter Speed-Win).

## Empfohlene Reihenfolge (Quick-Wins-first)
1. **Sofort-Bundle (halber Tag):** M1.1 (Director .chat()) + M1.3 (CSS) +
   M3.1 (Memoization) + Dead-Dep-Entfernung. Riesiger Impact, minimaler Aufwand.
2. **M1 fertigstellen** (M1.2 Higgsfield-connect + M1.4 Serper-Trending) → v1.6.0.
3. **M2** (Camera-Angle + Skill-Selektion) → v1.7.0.
4. **M3** (Comparison-to-Disk + Cleanup-Phasen) → v1.8.0.
5. **M4** (Settings-Redesign) → v1.9.0.

## Entscheidungen (Maurice, 2026-06-10)
- ✅ **Start: M1 komplett** (alle Pipeline/Higgsfield-Bugs) → v1.6.0. **UMGESETZT** (PR #65).
- ✅ **Serper.dev = neuer Trending-Default** (Serper→Brave→DDG-Chain). **UMGESETZT**
  (PR #65; Key auf Maurice' Maschine in config.json, live getestet).
- ✅ **Director wird DEFAULT-Pipeline-Pfad**. **UMGESETZT** (PR #66, gleich mit in
  v1.6.0 gebündelt statt nach Verifikation — Maurice: "erst fast follow dann release").
  Opt-out-Migration mit `directorPipelineUserSet`-Marker; 8 Review-Befunde
  vorab gefixt (1 deferred → M3: Pre-Hydration-Opt-out-Fenster, Sekunden-Trigger).
- ⏳ Offen: Brauchen `docs/working-folder` / `docs/bmad` einen Downstream-Consumer
  (Landing-Repo)? Vor git-rm in M3.3-P1 klären.

## Bekannte Schulden aus v1.6.0 (für M3)
- CHANGELOG-Generator erzeugt Einträge ohne `## [x.y.z]`-Versions-Header
  (prä-existierend, kosmetisch — GitHub-Release-Body ist die kanonische Story).
- Squash-Merge-Titel müssen conventional sein, sonst übersieht der
  Empty-Bump-Guard echte Releases (v1.6.0 via ALLOW_EMPTY_RELEASE=1
  geshippt; Regel in .claude/rules/release-flow.md dokumentiert).
- Review-Befund deferred: explizites Director-Opt-out im Pre-Hydration-Fenster
  (30s-Stall-Fall) geht verloren, wenn die App vor Hydration-Ende schließt.
