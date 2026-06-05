# SEC-AUDIT-001: Desktop Config Security Audit

**Date:** 2026-04-18  
**Reviewer:** Developer  
**Scope:** `app/api/desktop/config/route.ts`, `lib/pi-client.ts`, `lib/desktop-env.ts`, updater config  
**Fixes applied:** yes — see commit

---

## 1. config.json path traversal — `app/api/desktop/config/route.ts`

**Finding: CLEAR**

`configPath` is derived entirely from `getDesktopConfigPath()` in `lib/desktop-env.ts`, which uses only:
- `process.env.MASHUPFORGE_CONFIG_DIR` (set by the Tauri launcher at startup, not from user input)
- `process.env.APPDATA` / `homedir()` / `process.env.XDG_CONFIG_HOME` (OS-provided)

No user-supplied path flows into `configPath`. A request body cannot influence the file location. **No path traversal risk.**

---

## 2. Arbitrary env-var injection via PATCH — `app/api/desktop/config/route.ts`

**Finding: MEDIUM — FIXED**

### Before fix

The PATCH handler accepted any key names from `body.keys` and wrote them directly to both `config.json` and `process.env`:

```ts
for (const [k, v] of Object.entries(body.keys)) {
  if (typeof v === 'string' && v.trim().length > 0) {
    existing[k] = v.trim();
    process.env[k] = v.trim();   // ← any key accepted
  }
}
```

An attacker who could reach `127.0.0.1:PORT` (local attacker, or XSS in the webview) could set any env var on the Next.js process — including `NODE_OPTIONS`, `LD_PRELOAD`, `PATH`, or `DYLD_INSERT_LIBRARIES`. On the next child process spawn (e.g. pi sidecar), those vars would be inherited.

**Threat model note:** The server is bound to `127.0.0.1` only, so remote exploitation requires SSRF or local access. XSS in the webview is the realistic vector; Tauri's CSP mitigates but does not eliminate this.

### After fix

```ts
const allowedKeys = new Set(DESKTOP_CONFIG_KEYS.map(({ key }) => key));

for (const [k, v] of Object.entries(body.keys)) {
  if (!allowedKeys.has(k)) continue;   // ← silently skip unknown keys
  ...
}
```

Only the 16 keys declared in `DESKTOP_CONFIG_KEYS` can be written. Any other key is silently ignored. This matches what the UI actually sends.

---

## 3. config.json file permissions — `app/api/desktop/config/route.ts`

**Finding: LOW — FIXED**

### Before fix

```ts
writeFileSync(configPath, JSON.stringify(existing, null, 2) + '\n', 'utf8');
```

`writeFileSync` with a string encoding option uses `0o666` masked by the process umask. Default umask `0o022` yields `0o644` — **world-readable**. On Linux/macOS, any local user could read `config.json` and extract all API keys.

On Windows (primary target), `%APPDATA%` ACLs restrict access to the current user, so this was not exploitable there. But the app runs on macOS/Linux in dev and could ship there.

### After fix

```ts
writeFileSync(configPath, JSON.stringify(existing, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
```

`0o600` — owner read/write only. No other local users can read the file. Note: `mode` is only applied on file **creation**. An existing file written by a previous version retains its old permissions until overwritten. Users upgrading from an old install may need to `chmod 600 config.json` manually, or a one-time migration step could be added to `hydrateDesktopEnv()`.

---

## 4. Env var sanitization in pi-client.ts

**Finding: CLEAR**

```ts
const cleanEnv = { ...process.env };
const child = spawn(spawnCmd, spawnArgs, {
  env: cleanEnv,
  stdio: ['pipe', 'pipe', 'pipe'],
});
```

`spawn()` without `shell: true` passes arguments as separate argv elements — no shell interpolation occurs. A provider value of `; rm -rf /` is passed literally to `--provider` and pi rejects it as an unknown provider name. No injection risk.

`piProvider` and `piModel` are read from `process.env.PI_PROVIDER` / `process.env.PI_DEFAULT_MODEL` (via `.trim()`), not from the request body directly. The PATCH allowlist fix (§2) now ensures only legitimate values can reach these env vars.

---

## 5. Updater signature verification

**Finding: CLEAR — correctly implemented**

`src-tauri/tauri.conf.json`:
```json
"plugins": {
  "updater": {
    "endpoints": ["https://github.com/4neverCompany/MashupForge/releases/latest/download/latest.json"],
    "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6..."
  }
}
```

The pubkey decodes to a valid minisign public key (`E7822E2491229C6A`). `tauri-plugin-updater` (v2) enforces signature verification against this key before installing any update — the app cannot be updated with an unsigned or wrongly-signed bundle. The private key lives only in the `TAURI_SIGNING_PRIVATE_KEY` GitHub Actions secret.

The endpoint is HTTPS (GitHub CDN), preventing MITM substitution of the manifest. Even if the manifest were replaced, the attacker would need the private key to produce a valid `.sig`. **Updater is secure.**

---

## Summary

| Check | Finding | Action |
|---|---|---|
| Path traversal in config read/write | ✅ Clear | None |
| Arbitrary env-var injection via PATCH | ⚠️ Medium | **Fixed** — allowlist added |
| config.json world-readable (Linux/macOS) | ⚠️ Low | **Fixed** — `mode: 0o600` |
| pi sidecar env/arg injection | ✅ Clear | None |
| Updater signature verification | ✅ Clear | None |

### Follow-up (non-blocking)

The `mode: 0o600` only applies on file creation. Existing installs retain the old `0o644` permissions until the file is recreated. Consider adding a one-time `fs.chmodSync(configPath, 0o600)` call in `hydrateDesktopEnv()` to retroactively tighten permissions on first boot after upgrade.
