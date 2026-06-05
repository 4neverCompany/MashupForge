# UPDATER-REVIEW: e369f2a – 68c78ed

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

---

## 1. Updater signing — does it work?

**Verdict: PASS**

`tauri-windows.yml` passes `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` as env to `npx tauri build`. Tauri emits `.exe` + `.exe.sig` in `bundle/nsis/`. The workflow:

1. Checks `.exe` exists — errors if missing ✅
2. Checks `.exe.sig` exists — errors with "signing env vars missing?" if absent ✅
3. Synthesizes `latest.json` only if Tauri didn't emit it (see §4)
4. Uploads all three artifacts to the GitHub release ✅

Signing is end-to-end: private key → Tauri signs during Rust build → `.exe.sig` lands in bundle dir → uploaded to release → `latest.json` references the signature. The chain is complete.

---

## 2. PI provider dropdown — functional?

**Verdict: PASS WITH MINOR TYPE REGRESSION**

### Dropdown implementation

`DESKTOP_CONFIG_KEYS` now uses a discriminated union (`SecretFieldMeta | SelectFieldMeta | TextFieldMeta`) with a `kind` discriminator. `FieldRouter` dispatches correctly:

```tsx
if (meta.kind === 'select') return <SelectField ... />;
if (meta.kind === 'text')   return <TextField ... />;
return <SecretField ... />;
```

- `PI_PROVIDER` renders as `role="radiogroup"` with 4 buttons (`zai` / `anthropic` / `openai` / `google`). `aria-checked` on each button. ✅
- `PI_DEFAULT_MODEL` renders as a plain text input. ✅
- Both sit at the top of the panel above the API key fields. ✅

### Pi respawn on provider/model change

```ts
const PI_RESTART_KEYS = new Set(['PI_PROVIDER', 'PI_DEFAULT_MODEL']);
const restartPi = changedKeys.some(({ key }) => PI_RESTART_KEYS.has(key));
// ...
if (restartPi) void fetch('/api/pi/stop', { method: 'POST' }).catch(() => {});
```

Fires `/api/pi/stop` after save when provider or model changes. Next prompt auto-restarts pi with the new env hydrated from `config.json`. Correct. ✅

### `PiBusy` type cleaned up

`'config'` removed from the union — the old state that tracked the `pi config` terminal spawn. No dead states remain. ✅

### Issue: `DesktopConfigKey` type regression (minor, non-blocking)

```ts
// Old (as const → literal union):
export const DESKTOP_CONFIG_KEYS = [...] as const;
export type DesktopConfigKey = typeof DESKTOP_CONFIG_KEYS[number]['key'];
// = 'LEONARDO_API_KEY' | 'ZAI_API_KEY' | ...

// New (explicitly typed → string):
export const DESKTOP_CONFIG_KEYS: readonly DesktopConfigFieldMeta[] = [...];
export type DesktopConfigKey = typeof DESKTOP_CONFIG_KEYS[number]['key'];
// = string  (BaseFieldMeta.key is typed as string, not literal)
```

The `as const` was removed to allow the discriminated union `kind` field — a reasonable trade-off, but `DesktopConfigKey` loses its literal union type and becomes `string`. This is not a runtime bug, but any code relying on `DesktopConfigKey` as an exhaustive set of literals loses that guarantee silently.

**Fix if needed:** Declare `key` as a template literal or manually export the union, e.g.:
```ts
export type DesktopConfigKey =
  | 'PI_PROVIDER' | 'PI_DEFAULT_MODEL' | 'LEONARDO_API_KEY' | 'ZAI_API_KEY'
  | 'ANTHROPIC_API_KEY' | 'OPENAI_API_KEY' | 'GOOGLE_API_KEY'
  | 'INSTAGRAM_ACCOUNT_ID' | 'INSTAGRAM_ACCESS_TOKEN'
  | 'TWITTER_APP_KEY' | 'TWITTER_APP_SECRET' | 'TWITTER_ACCESS_TOKEN' | 'TWITTER_ACCESS_SECRET'
  | 'PINTEREST_ACCESS_TOKEN' | 'PINTEREST_BOARD_ID' | 'DISCORD_WEBHOOK_URL';
```

Not urgent unless downstream code depends on exhaustiveness checking.

---

## 3. ZAI key forwarding — correct?

**Verdict: PASS**

```ts
// lib/pi-client.ts
const cleanEnv = { ...process.env };
const child = spawn(spawnCmd, spawnArgs, {
  env: cleanEnv,
  stdio: ['pipe', 'pipe', 'pipe'],
});
```

`process.env` is hydrated from `config.json` by the Tauri wrapper before the Next.js server starts. So `ZAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `GOOGLE_API_KEY` are all present in `process.env` if the user configured them. All are forwarded to the pi child process via `cleanEnv`.

The comment explains the previous breakage: env vars were stripped to force pi to use `~/.pi/agent/auth.json`, but pi needs `ZAI_API_KEY` in env for ZAI routing — it doesn't consult `auth.json` for API-key-based providers. Now the full env is passed. ✅

Resolution order in `lib/pi-client.ts`:
1. `PI_PROVIDER` env (set via dropdown → config.json → Tauri hydration) — takes precedence
2. First key in `~/.pi/agent/auth.json` (OAuth providers who ran `pi /login`)
3. Pi's own default (no `--provider` flag passed)

This is correctly ordered: explicit user choice overrides auto-detection. ✅

---

## 4. latest.json synthesized properly?

**Verdict: PASS**

The synthesis triggers only when Tauri v2 fails to emit `latest.json` (a known v2 NSIS quirk when `createUpdaterArtifacts: true` is set but the manifest is still not produced):

```bash
jq -n \
  --arg version "${TAG#v}" \
  --arg pub_date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg signature "$(cat "$SIG")" \
  --arg url "https://github.com/4neverCompany/MashupForge/releases/download/$TAG/$(basename "$EXE")" \
  '{
    version: $version,
    notes: "",
    pub_date: $pub_date,
    platforms: {
      "windows-x86_64": { signature: $signature, url: $url }
    }
  }' > "$LATEST"
```

- **`${TAG#v}`** strips the leading `v` → `0.1.7`. Tauri updater expects bare semver, not `v0.1.7`. ✅
- **`$(cat "$SIG")`** reads the minisign `.exe.sig` file. `jq --arg` JSON-escapes the multi-line content (newlines become `\n`). A heredoc would embed literal newlines producing invalid JSON. ✅
- **`platforms."windows-x86_64"`** is the correct platform key for `x86_64-pc-windows-msvc` targets. ✅
- **URL** references the `.exe` on the same release by filename — matches the uploaded asset. ✅
- **`jq` availability**: the upload step uses `shell: bash` on a `windows-latest` runner; Git for Windows includes `jq` at `C:\Program Files\Git\usr\bin\jq.exe`. ✅
- **`date -u`**: available in Git Bash on Windows runners. ✅

The synthesized manifest is structurally identical to what Tauri would emit for a single-platform NSIS build.

---

## 5. Version bump (65fdb5a)

**Verdict: PASS**

All three files bumped to `0.1.8`:
- `package.json` ✅
- `src-tauri/tauri.conf.json` ✅
- `src-tauri/Cargo.toml` ✅

Consistent with the CI version parity check in `tauri-windows.yml`.

---

## 6. QA-RELEASE doc refresh (68c78ed)

**Verdict: PASS**

Count updated from "4 entries" to "16 entries" with accurate enumeration. Points readers to `lib/desktop-config-keys.ts` as the source of truth. Original IG-focused finding preserved intact. ✅

---

## Summary

| Commit | Area | Verdict | Notes |
|---|---|---|---|
| e369f2a | PI provider/model env wiring | ✅ PASS | Resolution order correct; 410 stub correct |
| 89065a6 | Settings dropdown | ✅ PASS | `DesktopConfigKey` is now `string` — type regression, not runtime bug |
| e8fc6b3 | latest.json synthesis | ✅ PASS | jq escaping correct; URL and platform key correct |
| 65fdb5a | Version bump 0.1.8 | ✅ PASS | All 3 files in sync |
| 68c78ed | QA doc refresh | ✅ PASS | Count and enumeration accurate |

**One action item:** Fix `DesktopConfigKey = string` regression by exporting an explicit key union from `desktop-config-keys.ts`. Low priority unless exhaustiveness checking is needed downstream.
