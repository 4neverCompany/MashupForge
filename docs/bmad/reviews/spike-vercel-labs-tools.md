# Spike Review: 3 Vercel Labs tools — agent-browser / portless / skills

**Spike date:** 2026-05-16
**Agent:** dev (Claude Code Opus 4.7)
**Scope:** Evaluation only — no code committed, no global state mutated except the two `npm install -g` commands the brief explicitly authorized (Spike 1 + Spike 2).

---

## Spike 1 — `agent-browser` — VERDICT: **ADOPT**

Native Rust browser automation CLI for AI agents. Bundles Chromium via Chrome-for-Testing.

### Install
- `npm install -g agent-browser` → 1 package, ~1s.
- `agent-browser install --with-deps` → installed Linux deps (1 apt-get pkg: `fonts-noto-cjk`), then downloaded Chrome 148.0.7778.167 (175 MB) to `~/.agent-browser/browsers/chrome-148.0.7778.167`.
- WSL: **works without friction.** No display server required (headless mode), no sudo beyond apt during the `--with-deps` step.

### Benchmark — open → snapshot → close on real pages

| Target | Cold cycle | Warm cycle | Snapshot lines | Comment |
|---|---|---|---|---|
| `example.com` (static) | 1.39 s end-to-end | n/a | 4 | Trivial baseline |
| `github.com/vercel-labs/agent-browser` (dynamic, JS-heavy) | 3.62 s | 3.07 s | 2952 | The kind of page the current stack can't render |

Individual step costs (warm): open ~0.8 s, snapshot ~0.16 s, screenshot ~0.24 s, close <0.1 s.

### Snapshot output quality
ARIA-style accessibility tree with stable `@refX` IDs for every interactive element, e.g.:
```
- button "Platform" [expanded=false, ref=e456]
- link "Sign in" [ref=e23]
- StaticText "This domain is for use in documentation examples..."
```
Far more agent-friendly than raw HTML — the tree is already filtered to what's clickable / readable, and the `@ref` system means agents can act on elements without writing selectors (`agent-browser click @e23`).

### Capabilities (probed via `--help`)
- `screenshot [path]` ✓ (78 KB PNG for the GitHub page)
- `eval <js>` — run arbitrary JS ✓
- Cookies: `set/get/clear`, plus auto-detect of cURL / JSON / Cookie-header files ✓
- Storage: `local|session` web storage manipulation ✓
- Network controls: `offline [on|off]`, `headers <json>`, `credentials <user> <pass>`, `route` for request interception ✓
- React-specific: `react renders stop --json` profiles renders ✓
- Session persistence: `--session-name <name>` auto-saves cookies + localStorage ✓

### Comparison vs current Hermes stack
- `~/.hermes/scripts/agent-web-search.sh` is a **text-search wrapper** (DuckDuckGo / Brave result list). No JS execution, no real page rendering.
- Plain `curl` of the same GitHub page: 0.8 s, 827 KB / 3636 lines of raw HTML — would have to be post-parsed by the agent itself.
- `WebFetch` (Claude built-in) is convenient but **fails on auth-walled / JS-rendered content** (returned 403 earlier this session on the Warp eval task). Many real research tasks need a real browser.

agent-browser **fills a capability gap, not replaces an existing tool.** It complements `agent-web-search.sh` (search) and `WebFetch` (simple GETs) by adding the JS-rendering / interactive tier.

### Risks
- 175 MB Chrome download per machine (one-time).
- Versioned Chromium pinned by CLI version — if `agent-browser` lags upstream security patches, agents browse with an outdated Chrome. Mitigation: `agent-browser install --with-deps` is idempotent; bake into a periodic refresh.
- No native cgroup / sandbox isolation by default — running it against hostile pages is no riskier than headless Chromium in general, but worth noting if Maurice ever points it at sketchy URLs.

### Adoption path
1. Add to fleet bootstrap (`~/.hermes/scripts/agent-bootstrap.sh` if it exists, else document in identity files).
2. Wrap with a `~/.hermes/scripts/agent-browse.sh` audit-logger akin to `agent-web-search.sh` so usage gets logged to `~/.hermes/audit.jsonl`.
3. Add a `parallel-web-extract` style skill that prefers `agent-browser` over `WebFetch` for JS-heavy pages.

---

## Spike 2 — `portless` for MashupForge — VERDICT: **CONDITIONAL ADOPT** (after one-time `sudo portless service install`)

Reverse-proxies dev servers behind stable `.localhost` HTTPS URLs (e.g. `https://mashupforge.localhost`).

### Install
- `npm install -g portless` → 1 package, ~0.3 s.
- `portless trust` → generated local CA, requested sudo (succeeded — Maurice's sudo cache was warm), CA added to system trust store. **WSL passwordless sudo path is wired** in this environment.

### Test run (MashupForge repo)
- Default flow blocks at port 443: *"Proxy is not running and no TTY is available for sudo. Option 1: start the proxy in a terminal (will prompt for sudo). Option 2: use an unprivileged port (--port 1355 --https)."*
- Workaround: `portless proxy start --port 1355 --https` → started HTTP/2 proxy on 1355 in ~2 s, no sudo required.
- Probed `https://mashupforge.localhost:1355/` while `portless mashupforge next dev` was warming → got `HTTP/2 502  x-portless: 1` (correct: proxy up, upstream still compiling). Next dev didn't finish bootstrapping inside the 12 s probe window.

### WSL-specific friction
1. **Port 443 binding requires TTY-based sudo** for an interactive session, OR a one-time `sudo portless service install` to register portless as a systemd-style daemon that auto-starts. Maurice will hit this exactly once.
2. **`.localhost` resolution** is automatic on Linux (`/etc/hosts` handles `*.localhost`) but Safari users would need `portless hosts sync`. Maurice's stack doesn't include Safari.
3. **Cross-OS access** (Windows host browser hitting WSL portless): the `.localhost` name resolves on Windows too but Windows reads its own hosts file — `portless hosts sync` writes to the WSL hosts file, not Windows'. Probably fine since Maurice's daily-driver browser likely runs inside WSLg, but worth confirming if he uses Edge on the Windows side.

### What would change in MashupForge
- Adding `portless` and a `portless.json` (or just relying on the directory name → app-name default) gives `https://mashupforge.localhost` as the dev URL.
- `package.json` `"dev"` script could be rewritten as `"dev": "portless next dev"` — but the current `next dev` continues to work unchanged for users who don't have portless globally.
- HTTPS in dev unlocks features that misbehave on `http://localhost:3000` (clipboard API, getUserMedia, service workers, secure cookies). MashupForge currently doesn't use these heavily, so the *immediate* gain is cosmetic + cookie/storage isolation between MashupForge and other locally-served projects.

### Safety
- Process-level reverse proxy; doesn't touch source, env vars, or build output.
- TLS cert is locally signed by portless's installed CA — same trust model as `mkcert`.
- `portless prune` cleanly tears down orphaned routes if a dev server crashes.

### Recommendation
**Don't commit anything yet.** If Maurice wants HTTPS dev URLs:
1. He runs `sudo portless service install` once on the WSL box to register the proxy as a daemon (one-time prompt for password).
2. We update `package.json` `"dev"` to `portless next dev` and add `portless.json` with `{ "name": "mashupforge" }`.
3. Bookmark `https://mashupforge.localhost` instead of `http://localhost:3000`.

If Maurice's daily workflow doesn't currently care about HTTPS in dev (current setup works fine), this is a quality-of-life upgrade, not a need-to-have. **Defer until there's a concrete reason** (e.g. a feature that requires `Secure` cookies or a Web API restricted to HTTPS).

---

## Spike 3 — `npx skills` cross-fleet sync — VERDICT: **ADOPT** for skill distribution; **REGISTRY-ONLY** (no global install yet)

Manages agent-skill packages from git repos with lock-file pinning. The same `npx skills` Warp's open-source repo uses to install its `.agents/skills/` set.

### Discovery
- `npx --yes skills@1.5.7 add vercel-labs/agent-skills --list` enumerated **7 skills** without installing anything.
- The CLI auto-detected the calling agent: `claude-code/2.1.126/agent — installing non-interactively`. Good integration: it knows about Claude Code's `~/.claude/skills/` layout.

### vercel-labs/agent-skills inventory (worth pulling for MashupForge)

| Skill | Pull? | Why |
|---|---|---|
| **vercel-react-best-practices** | ✅ YES | Direct fit: React/Next.js perf guidelines from Vercel engineering. MashupForge is Next.js 15 + React 19. |
| **vercel-composition-patterns** | ✅ YES | React composition patterns + **React 19 API changes** — MashupForge runs React 19. |
| **deploy-to-vercel** | ⚠️ MAYBE | Mostly handled by Maurice's existing release script + CI, but useful as a fallback / for new projects. |
| **web-design-guidelines** | ✅ YES (Designer agent) | UI review skill — fits the designer agent's remit cleanly. |
| **vercel-react-view-transitions** | ⚠️ MAYBE | Niche but actionable for UX polish (route transitions). |
| **vercel-cli-with-tokens** | ❌ SKIP | Maurice's Vercel is already set up; token-auth flow is already wired. |
| **vercel-react-native-skills** | ❌ SKIP | Maurice doesn't ship React Native. |

### Compatibility with `~/.claude/skills/` (existing setup)
- Default install mode is **symlink** from `node_modules` → agent directory. `--copy` flag forces file copies if Maurice prefers self-contained skills.
- The CLI respects multiple agent layouts (`.claude/skills/`, `.agents/skills/`, `.codex/skills/`, etc.) and writes to whichever the detected agent uses.
- Installs at two scopes:
  - `--global` → `~/.claude/skills/` (user-level, shared across all Claude Code instances on this machine = the dev/designer/qa/vault-keeper fleet).
  - default project-level → `<repo>/.claude/skills/` (per-repo, doesn't pollute the fleet).
- `skills-lock.json` pins versions — Warp's repo uses this exact pattern for their `common-skills` set.

### Cross-fleet sync recommendation

Maurice's fleet (dev / designer / qa / vault-keeper) currently shares `~/.claude/skills/` because they all run as the same OS user. So **global install already syncs across the fleet** without any additional tooling.

The new capability `npx skills` unlocks is **versioned skill distribution from a git repo with lockfile pinning**. Concrete pattern for Maurice:

1. Create `4neverCompany/agent-skills` (private repo with his custom BMAD review skills, dispatch protocols, vault-manager skills, brief-handlers, etc.).
2. Each project that needs them runs `npx skills add 4neverCompany/agent-skills --project --skill 'bmad-review,dispatch-handler,vault-update'` once.
3. `skills-lock.json` committed → CI / fresh clones get the same skill versions.
4. Quarterly `npx skills update -p -y` to refresh.

This replaces the current implicit "everyone copy-pastes from `~/.claude/skills/`" with explicit dependency management.

### What this **doesn't** solve
- Skills are still static markdown — they don't share state or memory across invocations. The HermesVault is still where episodic state lives.
- Doesn't help with the multi-machine fleet sync (if Maurice runs Hermes on his Tauri dev machine + a separate VPS). For that, the git-repo approach is the answer (clone + `npx skills install` on each box).

### Adoption path (after Maurice signs off)
1. Spin up `4neverCompany/agent-skills` repo with `npx --yes skills init <skill-name>` to scaffold first entries.
2. Move 2-3 stable Maurice-authored skills there (the BMAD review skill is a good first candidate — it's the protocol every agent runs).
3. Add `npx skills add 4neverCompany/agent-skills --project -y --skill '*'` to repo bootstrap scripts.
4. Pull `vercel-react-best-practices`, `vercel-composition-patterns`, `web-design-guidelines` from `vercel-labs/agent-skills` into MashupForge's `.claude/skills/` — they're directly relevant to Maurice's React 19 / Next.js 15 stack.

---

## Cross-cutting observations

- All three tools speak the same skill convention as Claude Code (`SKILL.md` with YAML frontmatter at `.claude/skills/<name>/`, `.agents/skills/<name>/`, etc.). This is the **same convention Warp's open-source repo uses** — the ecosystem is converging on one filesystem layout. Maurice's existing skills are portable across Claude Code, Warp, Codex, and the new `npx skills`–managed packages.
- The Vercel Labs tools are AGPL/MIT-leaning (need to confirm each repo's license individually) and self-hostable / forkable. No SaaS lock-in.
- Total install cost (just packages, no global config mutations beyond what was explicitly authorized): ~180 MB (mostly Chrome for agent-browser). Disk impact for fleet: negligible.

## Recommended priority of adoption

1. **agent-browser — adopt now.** Plugs a real gap. Low risk. ~1 day of integration (wrapper script + audit logging + skill update).
2. **npx skills — adopt as a distribution mechanism.** No global change needed; first use is spinning up `4neverCompany/agent-skills` and migrating the BMAD review skill there.
3. **portless — defer.** Wait for a concrete need for HTTPS in dev. Working `http://localhost:3000` is fine for current MashupForge work.

## What was NOT done (per brief constraints)

- No commits, no pushes. This file is the only artifact.
- No global install of `npx skills`-managed packages (Spike 3 was discovery / `--list` only).
- No `portless service install` (would require interactive sudo + would persist across reboots).
- No agent-browser usage outside benchmark probes (example.com and the vercel-labs/agent-browser GitHub page).
