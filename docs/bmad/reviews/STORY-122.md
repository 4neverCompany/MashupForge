# STORY-122 Review — Auto-update detection (version check + banner)

**Status:** SHIPPED — awaiting CI build + Maurice retest
**Agent:** Developer
**Date:** 2026-04-15
**Classification:** routine (human-directed from Maurice)

## Scope

Maurice's brief: *"Auto-update — need update button or detection.
Check Tauri updater plugin or simple version check via API."*

I took the "simple version check via API" path. Shipping detection
only — a release URL surfaced in Settings, copyable to the clipboard.
The actual binary-downloading/relaunch path is deliberately deferred
(see *Why not the Tauri updater plugin* below).

## What ships

### 1. `app/api/app/version-check/route.ts` — new GET route

Fetches `https://api.github.com/repos/4neverCompany/MashupForge/releases/latest`,
parses the `tag_name`, walks `assets[]` for the first `.msi`, and
returns:

```json
{
  "current": "0.1.0",
  "latest": "0.2.0",
  "updateAvailable": true,
  "releaseUrl": "https://github.com/.../releases/tag/v0.2.0",
  "downloadUrl": "https://github.com/.../MashupForge_0.2.0_x64_en-US.msi",
  "publishedAt": "2026-04-20T10:00:00Z",
  "notes": "- fix: ..."
}
```

Behavior:
- **No releases yet (404):** returns `updateAvailable: false`,
  `latest: null` at status 200. The repo currently has zero
  releases, so this is the state today — the banner will show
  "up to date" until Maurice cuts the first tag.
- **Non-404 GitHub error:** returns status 200 with `error` field
  set and `updateAvailable: false` — the Settings UI degrades to
  an amber "update check failed" line instead of taking down the
  settings panel.
- **Caching:** 10-minute in-process TTL so mounting Settings
  repeatedly doesn't eat into the anonymous GitHub rate limit
  (60 req/hour/IP).
- **Version comparison:** zero-dep `compareVersions` that parses
  `a.b.c[-pre]` and handles pre-release suffixes as lower than
  their release counterpart. Sufficient for our `0.x` versioning;
  if we hit a non-trivial case we can reach for the `semver` pkg.

Current version comes from `package.json` via a typed import, which
means the version embedded in the shipped MSI matches the value in
the repo at build time. Both `package.json` and
`src-tauri/tauri.conf.json` currently agree on `0.1.0`.

### 2. `components/UpdateBanner.tsx` — new client component

Four-state renderer: `checking` / `up-to-date` / `available` /
`error`. Mounted inside `DesktopSettingsPanel.tsx`, so it only
runs in the Tauri build (the panel's `isDesktop` guard renders
null on web/Vercel).

The `available` state shows:
- Version delta (`v0.1.0 → v0.2.0`)
- A read-only text input with the download URL (MSI asset)
  pre-selected on focus
- A "Copy" button using `navigator.clipboard.writeText`
- A collapsible `<details>` block for release notes

No `window.open`, no external link navigation. The user copies the
URL and pastes in their default browser. Not slick, but works 100%
without adding any Tauri plugins or touching capabilities.

### 3. `components/DesktopSettingsPanel.tsx` — one-line embed

`<UpdateBanner />` inserted between the "API keys stored in…"
helper text and the key fields. Zero other changes.

## Why not the Tauri updater plugin

I considered `tauri-plugin-updater` + signing. Rejected for this
story because:

1. **Requires signing infrastructure.** The updater needs a Tauri
   private key + public key baked into the binary. We'd need to
   generate the keypair, store the private key in CI as a secret,
   sign every release in `build-windows.ps1`, and ship a
   `latest.json` manifest alongside the MSI. That's a separate
   half-day of work and touches CI, secrets, and release flow.
2. **Requires releases to exist first.** Updater needs a signed
   `latest.json` hosted somewhere (GitHub release assets work).
   Zero releases today → zero to check against either way.
3. **Not strictly asked for.** Maurice's brief said "update button
   or detection". Detection is what's blocking users from even
   knowing an update exists. The auto-apply path is the second
   half and can land later once Maurice has cut a few releases.

## Why not the opener plugin (to open the URL in the system browser)

Considered `tauri-plugin-opener`. Rejected for this story because:

1. Adds a Rust dep + JS dep + capability entry + `lib.rs` plugin
   registration. Four-file blast radius for a cosmetic nicety.
2. Clipboard copy works today and is obviously correct behavior.
3. Deferring leaves the follow-up as a clean single-concern story
   (STORY-123): wire the plugin, replace the copy button with
   `openUrl()`, delete the text-input fallback. Small, focused,
   easy to review.

Noted inline in the UpdateBanner comment so the next developer
doesn't wonder why the URL is in a text input instead of an
anchor.

## Files touched

- `app/api/app/version-check/route.ts` — new (~140 LOC)
- `components/UpdateBanner.tsx` — new (~160 LOC)
- `components/DesktopSettingsPanel.tsx` — +2 LOC (import + mount)
- `docs/bmad/reviews/STORY-122.md` — this artifact

## Typecheck

`npx tsc --noEmit` — clean. `@/package.json` import types through
Next.js resolveJsonModule without additional typing.

## Exit criteria

1. CI builds a new `.msi` from this commit (batched with STORY-120
   and STORY-121).
2. Maurice installs, opens Settings → sees "MashupForge v0.1.0 —
   up to date" (because no releases exist yet).
3. Maurice cuts a GitHub release tagged `v0.1.1` or `v0.2.0`,
   reopens Settings → banner flips to "Update available — v0.x.y"
   with a copyable URL.
4. Maurice clicks Copy → clipboard contains the URL → paste in
   browser → download works.

If step 3 doesn't fire within 10 minutes of cutting a release, the
in-process cache is the suspect — restart the app (or wait for
the 10-minute TTL to expire) and recheck.

## Followups

- **STORY-123:** wire `tauri-plugin-opener`, replace the copy-URL
  UI with a single "Open in browser" button.
- **STORY-124:** wire `tauri-plugin-updater` with signing,
  promote detection → auto-apply. Needs signing key generation +
  CI secret + `build-windows.ps1` sign step + release manifest.
- **STORY-125** (nice to have): also embed the build-time commit
  SHA so Maurice can tell two builds of the same version apart
  (e.g. two different CI runs of `0.1.0` — there will be several
  before `0.2.0` is cut).

## State

Previously shipped this period:
- STORY-120 (chat spawn EINVAL) — `ff7560e`
- STORY-121 (settings persistence) — `3234b0c`
- STORY-122 (update detection) — this commit

All three batched into the same upcoming CI build. Maurice's
retest will exercise:
- Chat works (STORY-120)
- Settings persist across relaunch (STORY-121)
- Settings panel shows an update-check line (STORY-122)
