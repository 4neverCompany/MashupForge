# MashupForge Handoff

> **Project:** [4neverCompany/MashupForge](https://github.com/4neverCompany/MashupForge)
> **Live app:** https://mashupforge.vercel.app
> **Latest release:** [v1.6.0](https://github.com/4neverCompany/MashupForge/releases/tag/v1.6.0) (2026-06-10)
> **Last updated:** 2026-06-10 23:45 UTC+2
>
> **Sync-Hinweis (GitHub-Spiegel):** Source of truth ist
> `I:\MashupForge-handoff\` auf Maurice' Maschine; `docs/handoff/` im Repo
> ist der Spiegel, damit jeder Agent (auch remote/cloud) den Stand sieht.
> Wer lokal arbeitet: beide Orte updaten (Ordner editieren → nach
> `docs/handoff/` kopieren → committen). `humans/` wird NICHT gespiegelt
> (Repo ist public). Einstieg für den nächsten Run:
> **[ROADMAP.md](./ROADMAP.md) → "▶ NÄCHSTER EINSTIEG"**.

## Zweck

Dieser Ordner ist **kein** typisches Docs- oder Wiki-Verzeichnis. Er ist ein **Agent-Continuity-Handoff**: jede Datei hier ist so geschrieben, dass ein neuer Agent (Mavis, Claude Code, Hermes, ein zukünftiger Mavis, was auch immer) sie lesen kann und sofort weiß, wo das Projekt steht, warum Entscheidungen so getroffen wurden, und was als nächstes zu tun ist.

**Regel:** Bei jedem State-Change (Commit, Release, Architektur-Entscheidung, neuer Bug, neuer Epic) wird mindestens eine Datei hier geupdated. Nie das gesamte Repo durchsuchen müssen, um Kontext zu laden.

## Wer liest was

| Neuer Agent will wissen... | Lese zuerst |
|---|---|
| "Was läuft grad?" | [`STATE.md`](./STATE.md) |
| "Was ist gerade in flight?" | [`ACTIVE-CONTEXT.md`](./ACTIVE-CONTEXT.md) |
| "Was ist die Architektur?" | [`ARCHITECTURE.md`](./ARCHITECTURE.md) |
| "Warum habt ihr X entschieden und nicht Y?" | [`DECISIONS.md`](./DECISIONS.md) |
| "Was ist schonmal schiefgelaufen?" | [`PITFALLS.md`](./PITFALLS.md) |
| "Was kommt als nächstes?" | [`ROADMAP.md`](./ROADMAP.md) |
| "Was ist in welcher Session passiert?" | [`SESSION-LOG.md`](./SESSION-LOG.md) |
| "Wer ist der User, was mag er, was nervt ihn?" | `humans/MAURICE.md` (nur lokal in `I:\MashupForge-handoff\` — wird nicht in das public Repo gespiegelt) |

## Datei-Layout

```
MashupForge-handoff/
├── README.md             ← diese Datei (Navigation)
├── STATE.md              ← current snapshot (was läuft, was ist live)
├── ARCHITECTURE.md       ← wie MashupForge zusammenpasst
├── DECISIONS.md          ← Architektur-Entscheidungen mit Begründung
├── PITFALLS.md           ← was nicht funktioniert hat + Workarounds
├── ROADMAP.md            ← v1.2+ Plan, priorisiert
├── ACTIVE-CONTEXT.md     ← was ist in flight (commits in progress, offene Fragen, blocked items)
├── SESSION-LOG.md        ← kurze Chronologie (1 paragraph/session, neueste oben)
└── humans/
    └── MAURICE.md        ← Maurice's Präferenzen, Stack, Quirks, Communication Style
```

## Maintenance-Regel (verbindlich)

**Trigger** (jede dieser Aktionen löst ein Handoff-Update aus):
- Jeder Commit auf main / einer Release-Branch
- Jeder Release-Tag
- Jede Architektur-Entscheidung (ADR-style, in DECISIONS.md)
- Jeder neue Bug-Report oder Workaround (in PITFALLS.md)
- Jeder Epic-Start oder -Abschluss (in ROADMAP.md)
- Jeder Session-Start oder -Ende (in SESSION-LOG.md + ACTIVE-CONTEXT.md)
- Jeder Agent-Wechsel (Maurice switcht von Mavis zu Claude Code etc.)

**Was geupdated wird:**
- `STATE.md` — bei jedem Release, Epic-Status-Change
- `ACTIVE-CONTEXT.md` — bei jedem In-Flight-Item-Change
- `SESSION-LOG.md` — am Ende jeder Session
- Andere Files — nur bei relevantem Change

**Kein "Final-Update-am-Ende" aller 8 Files.** Inkrementell, was sich geändert hat.

## Konventionen

- **Markdown only.** Kein PDF, kein DOCX, kein Binary.
- **Englisch für technische Inhalte**, Deutsch für Maurice-Direkt-Zitate in SESSION-LOG (er schreibt bilingual casual).
- **Datum im ISO-Format** (`2026-06-07`) plus UTC+2 (Maurice's Zeitzone).
- **Relative Links** zwischen Handoff-Files (`./STATE.md`), absolute Links für Repo/Externe.
- **Keine Code-Snippets** die länger als 20 Zeilen sind — verlinke ins Repo stattdessen.
