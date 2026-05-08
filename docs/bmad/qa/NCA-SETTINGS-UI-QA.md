# QA Review — NCA-SETTINGS-UI-QA

**Status:** PASS
**Agent:** QA (Quinn)
**Date:** 2026-05-03
**Commit:** e0c594a feat(ui): add nca provider to Settings AI agent selector

## Files Reviewed
- `components/SettingsModal.tsx` — NCA card, status fetch, grid change
- `app/api/nca/status/route.ts` — status endpoint shape
- `lib/nca-client.ts` — isAuthenticated(), getDoctor()
- `types/mashup.ts` — aiAgentProvider union (prior commit 597e932)

## Checklist

| # | Check | Result |
|---|-------|--------|
| 1 | NCA card renders alongside pi/mmx | ✅ Grid promoted to `md:grid-cols-3` |
| 2 | Status indicator calls `/api/nca/status` | ✅ fetch in shared useEffect, `cancelled` guard covers both fetches |
| 3 | Selecting nca writes `provider = 'nca'` | ✅ `updateSettings({ activeAiAgent: 'nca', aiAgentProvider: 'nca' })` |
| 4 | `tsc --noEmit` clean | ✅ No output |
| 5 | 987/987 tests pass | ✅ 88 files, 987 tests, 11.19s |

## Findings

### Critical
_None._

### Warnings
_None._

### Info
- [INFO] `isAuthenticated()` is a synchronous env-var check (MINIMAX/OPENAI/ANTHROPIC/OPENROUTER keys), while `doctor.providers[].api_key_present` comes from the nca binary itself. Slight drift possible if nca adds a provider not yet in the env list. Pre-existing design choice; not a regression for this commit.
- [INFO] Provider description text ("MiniMax M2.5/M2.7, OpenAI, Anthropic, OpenRouter") is hardcoded in the card body — will need manual bump if nca's provider set changes.
- [INFO] `Terminal` icon reused from MMX card — intentional, both are CLI tools.

## Scope Check

- [IN-SCOPE] New NCA card in AI Agent tab (AC4)
- [IN-SCOPE] `/api/nca/status` fetch wired to `ncaStatus` state
- [IN-SCOPE] `updateSettings` call writes both legacy `activeAiAgent` and canonical `aiAgentProvider` to `'nca'`
- [IN-SCOPE] `NcaStatus` interface added at module scope
- [IN-SCOPE] Grid layout change `md:grid-cols-2` → `md:grid-cols-3`
- [OUT-OF-SCOPE] Stream-AI router changes (separate story)
- [OUT-OF-SCOPE] M2.7 model selector (AC6, separate story)

## Gate Decision

**[PASS]** — All five QA checklist items clear. No critical or warning findings. AC4 fully satisfied. Ready to merge.

**Confidence:** 0.95
