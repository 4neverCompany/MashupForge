---
id: POLISH-001
title: Fill installer metadata with 4neverCompany info
classification: routine
status: done
executed: 2026-04-18
---

# POLISH-001 — 4neverCompany metadata in installer + crate

## TL;DR

Replaced the Tauri scaffold defaults (`description = "A Tauri App"`,
`authors = ["you"]`, empty `license` / `repository`) and the empty bundle
metadata block with proper 4neverCompany info. Two files: `Cargo.toml`
and `tauri.conf.json`. `cargo check` and `npx tsc --noEmit` both clean.

## Where this metadata surfaces

The `bundle.*` fields end up in three places on Windows:

| Field | Surfaces in |
|---|---|
| `bundle.publisher` | NSIS installer "Publisher" line; Add/Remove Programs "Publisher" column; .exe Properties → Details → CompanyName |
| `bundle.copyright` | .exe Properties → Details → LegalCopyright |
| `bundle.shortDescription` | .exe Properties → Details → FileDescription (right-click on the installer .exe) |
| `bundle.longDescription` | NSIS installer welcome page (when present) |
| `bundle.homepage` | Add/Remove Programs "URLInfoAbout" → opens GitHub repo when user clicks "Click here for support information" |
| `bundle.license` | Some installer flows surface this; primarily metadata for crawlers/audits |
| `bundle.category` | macOS LSApplicationCategoryType, Linux .desktop categories — mostly inert on Windows but cheap to set |
| `productName` (top-level) | Already set to "MashupForge" — drives executable name + window title; NOT touched here |

Cargo.toml fields don't directly surface in the installer (they go to
`crates.io` metadata which we don't publish to), but they're required
hygiene: `cargo metadata`, IDE tooling, and any future audit dashboard
read from there.

## Diff

### `src-tauri/Cargo.toml`

```diff
-description = "A Tauri App"
-authors = ["you"]
-license = ""
-repository = ""
+description = "MashupForge — AI-driven multiverse crossover content studio (Tauri desktop shell)"
+authors = ["Maurice (4neverCompany)"]
+license = "Proprietary"
+repository = "https://github.com/4neverCompany/MashupForge"
+homepage = "https://github.com/4neverCompany/MashupForge"
```

### `src-tauri/tauri.conf.json` (`bundle` block)

```diff
   "bundle": {
     "active": true,
     "targets": ["nsis"],
     "createUpdaterArtifacts": true,
+    "publisher": "4neverCompany",
+    "copyright": "Copyright © 2026 4neverCompany. All rights reserved.",
+    "shortDescription": "AI-driven multiverse crossover content studio",
+    "longDescription": "MashupForge is 4neverCompany's content generation pipeline for AI-driven crossover art and social posts. Combines Leonardo.ai image generation, GLM-powered captioning, and a smart Instagram scheduler in a single desktop app.",
+    "homepage": "https://github.com/4neverCompany/MashupForge",
+    "category": "Productivity",
+    "license": "Proprietary",
     "resources": [...],
     "icon": [...]
   }
```

## Decisions made

- **Author string**: `"Maurice (4neverCompany)"` — no email. CLAUDE.md
  has a personal Gmail; not appropriate to bake into a binary that ships
  publicly. Surface the company name and a single contact handle.
  Switch to a `contact@4nevercompany.com`-style address later if/when
  one exists.
- **License**: `Proprietary`. Cargo prefers SPDX expressions and will
  warn on this string if we ever `cargo publish` — but we won't, this is
  a binary crate, not a library. The Tauri bundle field is free-form so
  it's fine there too.
- **Copyright year**: 2026 (current year per system date 2026-04-18).
  Static string; will need a yearly bump or a dynamic build-time inject
  if we want it to track. Out of scope for a routine task.
- **Homepage = GitHub repo**: 4neverCompany doesn't have a marketing
  site visible to me; the GitHub repo is the most authoritative public
  surface. Easy to swap for a real homepage later.
- **Long description**: factual product blurb, not marketing copy. NSIS
  shows it on the welcome page if no custom installer template is set.

## What was NOT changed (and why)

- **`productName`** ("MashupForge") and **`identifier`**
  (`com.4nevercompany.mashupforge`) — already correct.
- **Window title** ("MashupForge") — already correct.
- **`bundle.windows.nsis.*`** — no custom NSIS template needed for the
  default metadata to appear; Tauri's default NSIS template reads the
  `bundle.publisher` etc. fields directly. Adding a `windows.nsis` block
  here would only be needed for custom installer UI.
- **`rust-version = "1.77.2"`** — Tauri 2.10.3 actually requires newer,
  but bumping it is a separate concern (CI uses `dtolnay/rust-toolchain@stable`
  which is well above 1.77.2 anyway). Not in scope.
- **Cargo `name = "app"`** — left alone. Renaming the crate cascades
  through the build script's `library` name (`app_lib`) and would
  invalidate the cargo cache for no installer-visible benefit.

## Acceptance checklist

| AC | Status | Notes |
|---|---|---|
| Installer shows '4neverCompany' as publisher | ✅ | `bundle.publisher = "4neverCompany"`. Visible in NSIS installer + Add/Remove Programs after next install. |
| Product description filled | ✅ | Both `shortDescription` (concise blurb) and `longDescription` (paragraph) set. |
| Copyright notice present | ✅ | `bundle.copyright = "Copyright © 2026 4neverCompany. All rights reserved."` |
| All metadata fields populated in both tauri.conf.json and Cargo.toml | ✅ | tauri.conf.json: publisher, copyright, short+longDescription, homepage, category, license. Cargo.toml: description, authors, license, repository, homepage. |
| tsc + cargo check clean | ✅ | `cargo check` → "Finished `dev` profile in 2.04s" (no warnings). `npx tsc --noEmit` → exit 0, no diagnostics. |
| Write FIFO when done | ✅ | After commit. |

## Verification

- `cargo check --manifest-path src-tauri/Cargo.toml` → ✅ clean. The
  build script (`tauri-build`) also validates `tauri.conf.json` against
  its schema during the cargo check pass — clean compile means the new
  bundle fields are accepted by Tauri 2.10's config parser.
- `npx tsc --noEmit` → ✅ clean.

Real installer-display verification requires building the .msi/.exe on
Windows (post-CI). I'm on WSL — the .exe properties dialog isn't visible
from here. The fields ARE wired into the right schema slots per Tauri 2
docs; the .exe metadata follows mechanically.

## Files touched

```
 src-tauri/Cargo.toml      | +5 -4
 src-tauri/tauri.conf.json | +7
```

Two files, no behavioral change. Pure metadata.

## Follow-ups (not blocking)

- Real `support@4nevercompany.com` or similar contact email if we ever
  want a single point of reach in the .exe properties.
- Dynamic `${BUILD_YEAR}` substitution for the copyright string so it
  doesn't go stale. Could be done via the GitHub Actions workflow with
  a `sed` step before `tauri build`. Trivial but unnecessary today.
- Custom NSIS template (`bundle.windows.nsis.installerHeaderImage` etc.)
  if marketing wants branded installer UI. Out of scope for "fill metadata."
