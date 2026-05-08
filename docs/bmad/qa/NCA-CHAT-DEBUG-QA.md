# QA Review — NCA-CHAT-DEBUG-QA

**Status:** PASS
**Agent:** QA (Quinn)
**Date:** 2026-05-03
**Commit:** abe91e1 fix(nca): isAuthenticated() reads ~/.nca/config.toml, not just env

## Files Reviewed
- `lib/nca-client.ts` — `isAuthenticated()` + new `ncaConfigHasApiKey()` helper
- `app/api/nca/prompt/route.ts` — auth gate verification
- `app/api/nca/status/route.ts` — same helper consumption confirmed
- `components/SettingsModal.tsx` — `ncaSetupBlock` → `ncaInstallBlock`/`ncaApiKeyForm` split, dead button removed
- `tests/lib/nca-client-auth.test.ts` — new regression suite (7 tests)

## Checklist

| # | Check | Result |
|---|-------|--------|
| 1 | `isAuthenticated()` checks config.toml as fallback | ✅ Env fast-path first, then `ncaConfigHasApiKey()` scans `$NCA_CONFIG` → `./.nca/config.toml` → `~/.nca/config.toml` |
| 2 | SettingsModal — API key input field in card, dead button removed | ✅ `ncaApiKeyForm` moved inside card w/ `stopPropagation`; "Open nca CLI" button deleted |
| 3 | 994/994 tests pass | ✅ 89 files, 994 tests, 11.73s |
| 4 | Status route uses updated `isAuthenticated()` | ✅ `app/api/nca/status/route.ts` imports from `@/lib/nca-client`; update flows automatically |
| 5 | Prompt route gates on updated `isAuthenticated()` | ✅ `if (!isAuthenticated())` → 503, same import; 503 message now reflects config.toml path too |

## Findings

### Critical
_None._

### Warnings
_None._

### Info
- [INFO] **Regex + TOML inline comments:** `^\s*api_key(?!_)\s*=\s*"[^"]+"\s*$/m` will produce a false-negative if an api_key line has a trailing inline comment (e.g. `api_key = "sk-..." # my key`). nca's own config writer does not emit inline comments, so this is unlikely in practice. Conservative failure mode (denies auth instead of granting it).
- [INFO] **First-file-wins semantics:** if `$NCA_CONFIG` points to a partial/empty config and `~/.nca/config.toml` contains a valid key, `isAuthenticated()` returns false. Intentional; matches nca's own resolution order (documented in `ncaConfigHasApiKey()` JSDoc). Not a regression.
- [INFO] **Weak no-config test assertion:** the "neither env nor config" test uses `typeof isAuthenticated() === 'boolean'` rather than `toBe(false)`. Correctly acknowledged in the test — the host machine's `~/.nca/config.toml` may legitimately satisfy auth in CI/dev, making a `false` assertion environment-dependent.
- [INFO] **`<div role="button">` swap:** card changed from `<button>` to `<div role="button">` to allow nested interactive elements (HTML forbids `<input>` inside `<button>`). ARIA `aria-pressed`, `aria-disabled`, Enter/Space keyboard handlers, and `tabIndex` management are all correctly wired.

## Scope Check

- [IN-SCOPE] `isAuthenticated()` config.toml fallback (root cause fix)
- [IN-SCOPE] `ncaConfigHasApiKey()` private helper with correct resolution order
- [IN-SCOPE] Regression test suite covering env, NCA_CONFIG, workspace-local, and false-positive guard cases
- [IN-SCOPE] `ncaSetupBlock` → `ncaInstallBlock` + `ncaApiKeyForm` split; API-key form moved inside card
- [IN-SCOPE] Dead "Open nca CLI to change provider/model" button removed
- [IN-SCOPE] `stopPropagation` wiring on form elements to prevent card-click toggling on input interaction
- [OUT-OF-SCOPE] M2.7 model selector
- [OUT-OF-SCOPE] Multi-provider dropdown

## Gate Decision

**[PASS]** — Root-cause fix is correct and well-tested. All five checklist items clear. No critical or warning findings. Prompt route and status route both consume the updated helper. Ready to merge.

**Confidence:** 0.95
