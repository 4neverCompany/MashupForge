# Camofox standalone install (Vercel-Web path)

> V1.1.3-CORS (2026-06-07): the camofox sidecar is bundled with
> the Tauri desktop app and "just works" — Rust launches it
> before the WebView starts, kills it on shutdown, and attaches
> the child to a KILL_ON_JOB_CLOSE Job Object so abnormal exits
> don't leak the process. The Vercel-Web build
> (https://mashupforge.vercel.app) does NOT bundle a sidecar
> because Vercel Functions can't spawn long-lived child
> processes. Vercel-Web users who want the same `camofox`-driven
> trending search as the desktop build need to install camofox
> themselves. This document is the install guide.

## TL;DR

```powershell
# 1. Install (one-time, requires Node.js 20+)
npm install -g @askjo/camofox-browser@1.11.2

# 2. Start (as a daemon — pick your OS's mechanism)
#    Windows: use `nssm`, `pm2`, or a scheduled task.
#    macOS:   `brew services start camofox-browser` (after a `brew services` link)
#    Linux:   `systemd --user` unit (template below)
npx @askjo/camofox-browser   # foreground — for quick testing only
```

The sidecar listens on `127.0.0.1:9377` by default. The MashupForge
Vercel-Web build will auto-discover it via the 4-port probe
(`lib/camofox/standalone-discovery.ts`) when you click
"Refresh trends" in the Studio.

## Why the standalone path is needed

The Tauri desktop bundle ships a self-contained camofox runtime
(`src-tauri/resources/camofox/`) and the Rust launcher script
(`bin/camofox-browser.js`). The Vercel-Web build is serverless
and can't bundle a long-lived child. The user's options were, in
order of effort:

| Path | Pros | Cons |
|------|------|------|
| **Tauri desktop app** (existing) | Zero setup, sidecar bundled, lifecycle managed | User has to download + install the .msi |
| **Standalone npm install** (this doc) | No app install — just a Node daemon | User runs a background process; version skew is possible |
| **CORS-proxy-only** | Even lighter — runs alongside the Tauri app | Still needs Tauri or a separate sidecar to actually do the work |

This guide covers the second path. The CORS-proxy is a workaround
documented in [§ Workaround: CORS-proxy](#workaround-cors-proxy-for-when-upstream-adds-cors).

## Install

### Prerequisites

- **Node.js 20.12+** (the same version that builds MashupForge).
  Verify with `node --version`.
- **~300 MB free disk space** for the bundled Camoufox browser
  (downloaded on first launch by the `postinstall` step; takes
  30-60 s on a fresh install).
- **Outbound HTTPS to npmjs.com and the Camoufox CDN** at first
  launch (no air-gap support without `CAMOUFOX_EXECUTABLE`
  pointing at a pre-staged bundle — see the upstream README).

### Install command

```bash
npm install -g @askjo/camofox-browser@1.11.2
```

Pin the version explicitly so a future npm-publish-side mistake
can't silently upgrade you to an incompatible major.

### Verify the install

```bash
npx camofox-browser --version
# or, if globally installed:
camofox-browser --version
```

A clean install prints the version string and exits. The first
real `camofox-browser` launch will:

1. Spawn a Camoufox child process to download the patched
   Firefox binary (~300 MB, integrity-checked).
2. Bind to `127.0.0.1:9377`.
3. Log a single line per request to stdout (JSON-lines).

Verify the daemon is up:

```bash
curl -s http://127.0.0.1:9377/health
# Expected: {"ok":true,"engine":"camoufox",...}
```

## Health-check snippet (4-port probe)

The standalone-install path is a 4-port discovery loop because
Hermes agent (per Maurice's setup) often holds `9377`, and we
don't want to spawn a second instance. The MashupForge Web build
runs this same probe via `lib/camofox/standalone-discovery.ts`;
for ad-hoc checks from your own scripts, this is the canonical
snippet:

```javascript
// scripts/probe-camofox-ports.mjs
const PORTS = [9377, 9378, 9379, 9380];
const TIMEOUT_MS = 1500;

async function probe() {
  for (const port of PORTS) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        mode: 'no-cors',           // doesn't trip on missing CORS
        signal: ac.signal,
        cache: 'no-store',
      });
      if (res.type === 'opaque') {
        console.log(`port ${port}: occupied (opaque response)`);
        // Now do a CORS-mode /health to confirm it's camofox:
        const conf = await fetch(`http://127.0.0.1:${port}/health`, { cache: 'no-store' });
        const body = await conf.text();
        if (/camoufox/i.test(body)) {
          console.log(`port ${port}: CAMOFOX ✓`);
          return port;
        } else {
          console.log(`port ${port}: occupied but NOT camofox (${body.slice(0, 60)}…)`);
        }
      }
    } catch (err) {
      console.log(`port ${port}: free or unreachable (${err.message})`);
    } finally {
      clearTimeout(t);
    }
  }
  return null;
}

const found = await probe();
console.log(found ? `camofox on port ${found}` : 'no camofox instance found');
```

The same algorithm is implemented in TypeScript in
`lib/camofox/standalone-discovery.ts` and re-tested by
`tests/lib/camofox/standalone-discovery.test.ts`. The
TypeScript version is the one the Vercel-Web build actually
uses.

## Run as a daemon (so it survives logout)

A foreground `camofox-browser` is fine for testing but you'll
want a real daemon for daily use. Pick the option that matches
your OS.

### Windows: `nssm` (simplest)

```powershell
# Install the Windows Service Wrapper
choco install nssm
# or scoop: scoop install nssm

# Register the sidecar as a service
nssm install camofox-browser "C:\Program Files\nodejs\node.exe" "C:\Users\<you>\AppData\Roaming\npm\node_modules\@askjo\camofox-browser\bin\camofox-browser.js"
nssm set camofox-browser AppDirectory "C:\Users\<you>\AppData\Roaming\npm\node_modules\@askjo\camofox-browser"
nssm set camofox-browser AppStdout "C:\ProgramData\camofox-browser\out.log"
nssm set camofox-browser AppStderr "C:\ProgramData\camofox-browser\err.log"
nssm set camofox-browser Start SERVICE_AUTO_START

# Start it
nssm start camofox-browser
```

To uninstall: `nssm stop camofox-browser && nssm remove camofox-browser confirm`.

### macOS: `launchd` plist

```bash
# ~/Library/LaunchAgents/com.4nevercompany.camofox.plist
cat > ~/Library/LaunchAgents/com.4nevercompany.camofox.plist <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.4nevercompany.camofox</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/usr/local/lib/node_modules/@askjo/camofox-browser/bin/camofox-browser.js</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/usr/local/var/log/camofox.log</string>
  <key>StandardErrorPath</key><string>/usr/local/var/log/camofox.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CAMOFOX_PORT</key><string>9377</string>
    <key>CAMOFOX_CRASH_REPORT_ENABLED</key><string>false</string>
  </dict>
</dict>
</plist>
EOF

launchctl load -w ~/Library/LaunchAgents/com.4nevercompany.camofox.plist
```

### Linux: `systemd --user`

```ini
# ~/.config/systemd/user/camofox-browser.service
[Unit]
Description=Camofox Browser (MashupForge sidecar)
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/node /usr/lib/node_modules/@askjo/camofox-browser/bin/camofox-browser.js
Restart=on-failure
RestartSec=5
Environment=CAMOFOX_PORT=9377
Environment=CAMOFOX_CRASH_REPORT_ENABLED=false

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now camofox-browser
# Linger so the service survives logout
sudo loginctl enable-linger $USER
```

## Version pinning

The MashupForge Web build's `lib/camofox/client.ts` was written
against `@askjo/camofox-browser@1.11.2`. Newer minors can add
new search macros and tweak the JSON shape, but the REST surface
(`/tabs`, `/navigate`, `/links`, `/health`, `/snapshot`) is
stable. **Patch upgrades are safe; minor upgrades may need a
client bump.** The v1.1.3 release pins 1.11.2 in
`package.json` and `next.config.ts` references the same version
in the `CAMOFOX_STANDALONE_PORTS` test union.

## Workaround: CORS-proxy for when upstream adds CORS

As of v1.11.2 the upstream server.js does not emit
`Access-Control-Allow-Origin` headers (verified 2026-06-07 by
reading the source and the README's env-vars table — neither
mentions CORS). The MashupForge Web build can't `fetch` the
sidecar from a browser tab without CORS headers, even though
the CSP now permits `connect-src 127.0.0.1:9377-9380`.

When upstream adds CORS support (track at
https://github.com/jo-inc/camofox-browser/issues), the
workaround below becomes unnecessary. Until then, run the
CORS-proxy from this repo:

```bash
# Terminal 1: start the sidecar (any of the install paths above)
npx @askjo/camofox-browser

# Terminal 2: start the CORS proxy on 9889
node scripts/camofox-cors-proxy.mjs
```

Point the MashupForge Web build at the proxy by setting
`CAMOFOX_PORT=9889` in the Web build's localStorage
("Sidecar → Override port" in Studio settings; the v1.1.3 UI
adds a status indicator for this case).

The proxy:

- Listens on `127.0.0.1:9889` by default (override with
  `CAMOFOX_CORS_PROXY_PORT`).
- Forwards to the real sidecar on `127.0.0.1:9377` by default
  (override with `CAMOFOX_SIDECAR_PORT`).
- Adds `Access-Control-Allow-Origin` for the same
  comma-separated origin list in `CAMOFOX_CORS_ORIGINS` that
  the Rust side forwards. The default is
  `http://localhost:3000,https://mashupforge.vercel.app` —
  never `*` (would let any browser tab drive the user's local
  sidecar).
- Uses **no third-party deps** (stdlib only), so adding the
  workaround doesn't drag a 50 MB dependency tree onto the
  user's machine. The full source is 200 lines and readable
  in one sitting.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `port 9377: free or unreachable (fetch failed)` | sidecar not running | `npx @askjo/camofox-browser` in a terminal, or check the daemon status (`nssm status`, `launchctl list`, `systemctl --user status camofox-browser`) |
| `port 9377: occupied but NOT camofox` | Hermes agent (or another process) holds 9377 | Move the sidecar to 9378+ via `CAMOFOX_PORT=9378` env-var, and update the MashupForge Web build's 4-port probe to match (auto-detected) |
| Browser shows `CORS error` despite the proxy running | Proxy not on the whitelist | `CAMOFOX_CORS_ORIGINS` is unset → default whitelist is used. If your dev URL is on a different port, set the env-var on the proxy to include it: `CAMOFOX_CORS_ORIGINS="http://localhost:3000,http://localhost:5173,https://mashupforge.vercel.app" node scripts/camofox-cors-proxy.mjs` |
| Browser shows `Mixed Content` error | Vercel-Web is HTTPS, sidecar is HTTP | The CORS-proxy is the workaround — `https://mashupforge.vercel.app` calls `http://127.0.0.1:9889/...` (also HTTP), which is same-protocol from the proxy's perspective. If you're loading the build from a non-localhost HTTPS dev URL, set `CAMOFOX_CORS_PROXY_HOST=0.0.0.0` and use an HTTPS tunnel (e.g. ngrok) — but the cleanest fix is to test on `http://localhost:3000` where mixed-content doesn't apply |
| `Camoufox binary download failed` on first launch | Network blocked the CDN or disk full | Check `~/.camofox/launcher.log` (or `%APPDATA%\.camofox\launcher.log` on Windows) for the actual error. The `postinstall` step is the only network-dependent part; once the binary is cached locally, offline use works. |
| `EADDRINUSE` on every port 9377-9380 | All 4 ports taken by non-camofox services | Stop the conflicting process, OR set `CAMOFOX_PORT=9889` (any free port) and accept that the MashupForge 4-port probe won't find it (you'll need to type the URL into the "Sidecar override" field in Studio) |

## Why no automated install in MashupForge?

We considered shipping a one-click "Install Camofox" button in
the Studio sidebar that would `npm i -g` the package and start
the daemon via Node's child_process. The blocker is that the
Web build runs in a browser sandbox and has no permission to
spawn child processes on the host — `npm install` requires
write access to `node_modules` and the global prefix, and
browsers can't grant that. The Electron/Tauri build can do
this (and the Tauri build doesn't need to — it bundles
camofox already), so the only realistic install surface is the
manual one in this document.

## References

- [docs/camofox-integration.md](./camofox-integration.md) —
  Tauri-bundled sidecar lifecycle.
- [`@askjo/camofox-browser` README](https://github.com/jo-inc/camofox-browser) —
  upstream docs, env-vars, and security model.
- [`lib/camofox/standalone-discovery.ts`](../lib/camofox/standalone-discovery.ts) —
  the 4-port discovery implementation.
- [`scripts/camofox-cors-proxy.mjs`](../scripts/camofox-cors-proxy.mjs) —
  the CORS-proxy workaround.
- [ROADMAP.md](../ROADMAP.md) §v1.1.3 — D-Refactor entry that
  motivated this document.
