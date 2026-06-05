# RECENT-REVIEW-006: 7-commit batch

**Date:** 2026-04-18  
**Reviewer:** Developer  
**Commits (oldest → newest):**

| Hash | Description |
|---|---|
| e369f2a | feat(pi): wire PI_PROVIDER + PI_DEFAULT_MODEL to pi sidecar |
| 89065a6 | feat(settings): replace Switch Provider terminal with dropdown |
| e8fc6b3 | ci(tauri): synthesize latest.json when Tauri doesn't emit it |
| 65fdb5a | chore: bump version to 0.1.8 |
| 68c78ed | docs(qa): refresh QA-RELEASE DESKTOP_CONFIG_KEYS count |
| 379d5ef | chore(cleanup): remove orphan /api/app/version-check route |
| 7161122 | docs(qa): commit pending QA reviews (BATCH-005 + RECENT-004) |

> e369f2a–68c78ed were reviewed in depth in UPDATER-REVIEW.md. Findings
> are summarised here; see that file for the full analysis.

---

## Updater signing correctness

**PASS.** `tauri-windows.yml` passes `TAURI_SIGNING_PRIVATE_KEY` + password to `npx tauri build`. Both `.exe` and `.exe.sig` are checked for existence before upload; missing `.exe.sig` exits with an actionable error message. Signing chain is complete.

---

## PI provider dropdown UX

**PASS** (one minor type regression, non-blocking).

- `PI_PROVIDER` renders as a `role="radiogroup"` with 4 buttons (`zai` / `anthropic` / `openai` / `google`), gold accent on selected. `aria-checked` is set correctly. ✅
- `PI_DEFAULT_MODEL` renders as a plain text input. ✅
- Both fields sit at the top of the panel above API key fields — correct information hierarchy. ✅
- Changing either field triggers `/api/pi/stop` after autosave so the next prompt respawns pi with the new env. ✅
- Old "Switch Provider" button and `handleProviderConfig` wiring fully removed from `MainContent.tsx` and `SettingsModal.tsx`. `PiBusy` union has no dead `'config'` state. ✅

**Type regression (low priority):** `DesktopConfigKey` is now inferred as `string` instead of a literal union because `as const` was removed to support the discriminated union `kind` field. Not a runtime bug; see UPDATER-REVIEW §2 for the recommended fix.

---

## latest.json schema validity

**PASS.** Tauri updater manifest schema:

```json
{
  "version": "0.1.7",
  "notes": "",
  "pub_date": "2026-04-18T01:03:22Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<minisign sig>",
      "url": "https://github.com/4neverCompany/MashupForge/releases/download/v0.1.7/MashupForge_0.1.7_x64-setup.exe"
    }
  }
}
```

The `jq` synthesis produces exactly this shape:
- `version`: `${TAG#v}` strips leading `v` → bare semver ✅
- `pub_date`: UTC ISO-8601 from `date -u` ✅
- `signature`: `$(cat "$SIG")` — `jq --arg` JSON-escapes the multi-line minisign content; a heredoc would embed literal newlines ✅
- `url`: GitHub release download URL constructed from tag + EXE basename ✅
- `platforms."windows-x86_64"`: correct key for `x86_64-pc-windows-msvc` target ✅
- `jq` and `date -u` both available in Git Bash on `windows-latest` runners (`shell: bash` is set on the upload step) ✅

Synthesis only triggers when Tauri fails to emit `latest.json` — it does not overwrite a Tauri-produced manifest. ✅

---

## 379d5ef — remove orphan /api/app/version-check route

**Verdict: PASS**

154-line route deleted cleanly. Verified:
- **Only caller (`UpdateBanner`)** was removed in `e1b1fe7` before this commit. No remaining references to `/api/app/version-check` in the codebase.
- **Replacement path:** `tauri-plugin-updater` polls the signed `latest.json` manifest directly. No intermediate Next.js proxy needed.
- **`NEXT_PUBLIC_BUILD_SHA`**: commit message notes zero remaining code references. The env var was implicit-only (consumed by the old `UpdateBanner`). No CI workflow sets it. Leaving it undeclared is correct — nothing to clean up.
- The deleted route had a module-level `cached` variable (in-process cache). Removing it eliminates a stale-state risk if the route were ever accidentally re-introduced.

No loose ends.

---

## 65fdb5a — version bump 0.1.8

**PASS.** All three files in sync (`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`). ✅

---

## 68c78ed — QA-RELEASE doc refresh

**PASS.** Count corrected from "4 entries" to "16 entries"; original IG-focused finding preserved. ✅

---

## 7161122 — commit pending QA reviews

**PASS.** Adds `BATCH-REVIEW-005.md` and `RECENT-REVIEW-004.md`. Content matches the reviews written for those commit sets. Docs-only, no code change.

---

## Summary

| Commit | Verdict | Notes |
|---|---|---|
| e369f2a | ✅ PASS | Provider resolution order correct; 410 stub for stale clients |
| 89065a6 | ✅ PASS | Dropdown UX correct; `DesktopConfigKey = string` type regression (low priority) |
| e8fc6b3 | ✅ PASS | `latest.json` schema valid; `jq` escaping correct |
| 65fdb5a | ✅ PASS | All 3 version files in sync |
| 68c78ed | ✅ PASS | Count and enumeration accurate |
| 379d5ef | ✅ PASS | Clean deletion; no remaining callers |
| 7161122 | ✅ PASS | Docs only |

All 7 commits pass. One low-priority follow-up: restore `DesktopConfigKey` as an explicit literal union in `desktop-config-keys.ts`.
