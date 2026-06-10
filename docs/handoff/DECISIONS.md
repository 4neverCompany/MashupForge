# Decisions

> Architektur-Entscheidungen mit Begründung. Format: ADR-style (Context, Decision, Consequences, Status).

## ADR-001: Tauri als Production-Target, Vercel als Try-Before-Install

- **Context:** Maurice wollte eine Desktop-App mit AI-Bild-Generierung, aber auch eine Web-Demo für schnelles Testen ohne Installation.
- **Decision:** Tauri-Build = Production (gebundeltes Next.js, sidecars, native OAuth). Vercel-Build = Try-Before-Install.
- **Consequences:** Manche Features (camofox-sidecar) sind Tauri-only by design. Web-Build verhält sich reduziert. Maurice akzeptiert das.
- **Status:** ✅ Akzeptiert (seit v1.0.0)

## ADR-002: Pro-Project Tokens statt User-Account-System

- **Context:** Mehrere AI-Provider (Higgsfield, Leonardo, MiniMax) brauchen API-Tokens. Frage: speichern pro User-Account oder pro Project?
- **Decision:** Per-Project Tokens in localStorage / idb-keyval. Kein User-Account-System.
- **Consequences:** Kein Cross-Device-Sync, kein Sharing, kein Multi-User. Passt zu Maurice's Solo-Workflow.
- **Status:** ✅ Akzeptiert (seit v1.0.0)
- **Offen für v1.2+:** Wenn MashupForge Multi-User wird, brauchen wir Account-System. Nicht im aktuellen Scope.

## ADR-003: camofox als primärer Web-Search-Provider

- **Context:** AI braucht frische Web-Daten (trending topics, news) für Prompt-Context. SearXNG/Reddit-JSON lieferten auf Maurice's Maschine nichts. camofox (anti-bot-hardened) liefert reliable Results.
- **Decision:** camofox ist primary, web-search (DDG/Brave) ist fallback. In v1.1.2 ist camofox-only (DDG/Brave entfernt weil unzuverlässig).
- **Consequences:** Tauri-Bundle muss camofox mit-packen + 3-stage Port-Discovery. Vercel-Web kann camofox nicht nutzen (Architektur).
- **Status:** ✅ Akzeptiert (v1.1.2). Web-Limit ist akzeptiert, D-Refactor (siehe ROADMAP) soll das fixen.

## ADR-004: Single-Instance Plugin VOR Deep-Link (v1.1.2)

- **Context:** Higgsfield OAuth callback (`mashupforge://oauth/callback`) wurde vom OS in einer NEUEN Tauri-Instanz geöffnet. Die neue Instanz hatte keine PKCE-Cookies, kein Token-Storage → "Welcome Back" leere Seite.
- **Decision:** `tauri-plugin-single-instance` v2 mit `deep-link` Feature VOR `tauri-plugin-deep-link` registrieren. Das Plugin piped den 2nd-Launch-URL automatisch durch zur laufenden Instanz.
- **Consequences:** OAuth-Callback kommt im existierenden WebView-Listener an, PKCE-State bleibt erhalten. Plugin-Callback muss nur Main-Window fokussieren.
- **Status:** ✅ Implementiert (v1.1.2), wartet auf Maurice's Manual-Test

## ADR-005: MCP vs CLI für v1.2+ Agentic AI → CLI bevorzugt

- **Context:** Anstehende v1.2+ agentic AI braucht Tool-Use-Loop. Frage: MCP-Server pro Provider, oder CLI-Wrapper?
- **Decision:** CLI-Wrapper wo verfügbar (higgsfield CLI, mmx CLI), MCP nur wo OAuth-Flow zwingend nötig ist.
- **Begründung (Web-Recherche 2026):**
  - Anthropic's eigene Forschung (2026-04): 98.7% Token-Reduktion wenn Modelle Shell-Scripts schreiben statt MCP-Tools
  - Perplexity hat MCP aus ihrem Agent-Stack rausgeworfen (2026-03)
  - Microsoft empfiehlt Playwright-CLI statt Playwright-MCP (-76% Tokens)
  - Higgsfield selbst empfiehlt CLI für Agent-Use-Cases (higgsfield.ai/cli)
  - Scalekit-Benchmark: MCP 32x teurer + 28% Timeouts
- **Consequences:** v1.2+ implementiert `lib/providers/{higgsfield,mmx,leonardo}/cli.ts`. MCP bleibt für deterministische OAuth-Flows.
- **Status:** 🟡 Geplant für v1.2 Epic (5/5 Provider-Wrapper SHIPPED in v1.2.0)

## ADR-006: Handoff-Folder als Agent-Continuity-Mechanismus

- **Context:** Maurice will jederzeit den Agenten wechseln können (Mavis ↔ Claude Code ↔ Hermes ↔ was-auch-immer). Aktueller Context geht verloren.
- **Decision:** Handoff-Folder `I:\MashupForge-handoff\` ausserhalb des Repos, mit STATE/ACTIVE-CONTEXT/ARCHITECTURE/DECISIONS/PITFALLS/ROADMAP/SESSION-LOG/humans. Maintenance-Regel: Update bei jedem State-Change.
- **Consequences:** Jeder Agent kann einsteigen ohne langes Onboarding. Aber Discipline nötig — wenn Files veralten, ist das schlimmer als keine.
- **Status:** ✅ Initiiert 2026-06-07, aktiv maintained

## ADR-007: 3 Handoff-Folder-Optionen (Location, MCP, SESSION-LOG-Scope)

- **Context:** Maurice hat 3 offene Fragen zum Handoff-Folder-Setup nicht beantwortet.
- **Decision (default falls keine Antwort):**
  - Location: `I:\MashupForge-handoff\` (außerhalb Repo, saubere Trennung)
  - MCP-Target: später (Folder ist direkt lesbar, MCP-Routing nice-to-have)
  - SESSION-LOG-Scope: short (1 paragraph/session)
- **Consequences:** Maurice kann jederzeit Defaults überschreiben. Aktuell wird mit Defaults gebaut.
- **Status:** 🟡 Defaults aktiv, override möglich

## ADR-008: Mavis-Team-Plan gecancelt, manuell weiter (2026-06-07)

- **Context:** 4 cycles von `mavis team plan run` haben 5/8 Tasks fertig, 3 an 30-min hard cap gescheitert. Cycle 4: v12-director gekillt, 2 retries re-spawned (engine overhead), 2 alte "failed production"-Tasks noch offen.
- **Decision:** Plan offiziell cancelled. Übrige 3 Tasks (v12-eval-hil, d-integration E2E, v12-integration E2E) manuell erledigen oder Maurice's manual-test überlassen.
- **Begründung:**
  - 30-min hard cap ist ein hard limit auf `timeout_ms` (engine killt bei 30 min auch mit extension)
  - big tasks (v12-director, v12-eval-hil) brauchen >30 min real work
  - 2 E2E-Tests sind inherent manual (brauchen Tauri-Build + echte Services)
- **Consequences:**
  - v12-eval-hil manuell im orchestrator session (in Arbeit)
  - d-integration + v12-integration: Maurice's manual test beim ersten Tauri-Build nach merge
  - 5/8 tasks sind sauber per MR-mergeable branches auf origin
- **Status:** ✅ Cancelled + 5/8 manuell fertig

## ADR-009: Handoff-Folder ist source of truth, jeder agent updated bei state-change

- **Context:** Maurice will jederzeit den agenten wechseln können. Aktuell hatte ich 9 files manuell geschrieben + 2 memory-entries. Wer updated das in zukunft?
- **Decision:** Jeder agent der im plan arbeitet, updated bei state-change mindestens eine file: STATE.md bei releases, ACTIVE-CONTEXT.md bei in-flight, SESSION-LOG.md bei session-end. Kein "Final-Update-am-Ende" aller 8 files — inkrementell.
- **Consequences:** Handoff bleibt aktuell. Discipline erforderlich. Maurice kann ohne context-loss agenten wechseln.
- **Status:** ✅ Etabliert 2026-06-07
