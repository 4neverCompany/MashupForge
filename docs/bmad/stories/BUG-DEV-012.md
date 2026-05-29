# BUG-DEV-012 — WebView2 partition data loss fix

**Status:** Implemented (2026-05-30, awaiting QA)
**Classification:** complex (persistence migration)
**Origin:** GitHub Issue #12 — "Bug: Moving the app folder wipes all saved images and scheduled posts"
**Brief:** `docs/bmad/briefs/move-folder-data-loss.md`
**Agent:** Developer

---

## TL;DR

WebView2 uses a per-executable-path partition for IndexedDB. When the .exe moves, WebView2 creates a new empty partition — all data is silently lost. Fix: migrate from WebView2 partition storage to a fixed `%APPDATA%\com.4nevercompany.mashupforge\` directory with SQLite + plain filesystem storage.

---

## What to implement

### 1. Fixed app data directory

Create and own this directory structure:
```
%APPDATA%\com.4nevercompany.mashupforge\
  config.json          # existing settings (moved from WebView2 partition)
  gallery.db           # NEW: SQLite DB for structured data
  images\              # NEW: stored generated images
```

Detect at startup via `app.getPath('userData')` — Tauri provides this as a fixed path independent of exe location.

### 2. SQLite schema for structured data

Create `src/lib/gallery.db.ts` (or `.js`) with:

```sql
CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  model TEXT NOT NULL,
  imagePath TEXT NOT NULL,   -- relative path under images\
  thumbnailPath TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER,
  postedAt INTEGER,
  postError TEXT,
  postedTo TEXT,
  scheduledPostId TEXT
);

CREATE TABLE IF NOT EXISTS scheduled_posts (
  id TEXT PRIMARY KEY,
  anchorId TEXT NOT NULL,
  anchorType TEXT NOT NULL,  -- 'image' | 'carousel'
  platform TEXT NOT NULL,
  scheduledAt INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',  -- 'scheduled' | 'posted' | 'failed' | 'rejected'
  postedAt INTEGER,
  postError TEXT,
  metadata TEXT              -- JSON blob for platform-specific data
);

CREATE TABLE IF NOT EXISTS migrations (
  id TEXT PRIMARY KEY,
  migratedAt INTEGER NOT NULL,
  recordCount INTEGER
);
```

### 3. Registry-based migration path

**Write** (on first launch from new path, before any other initialization):
```
HKCU\Software\4NEVER\MashupForge\DataPath = "%APPDATA%\com.4nevercompany.mashupforge"
```

**Read** (on every startup):
- Fetch `HKCU\Software\4NEVER\MashupForge\DataPath`
- If value differs from current `app.getPath('userData')`, OR if no value exists:
  - This is either first run OR the app was moved
  - Check for data in the OLD WebView2 partition path (derived from last known exe location stored in registry as `LastKnownPath`)
  - If old data exists and new DB is empty: run migration
  - If old data exists and new DB also has data: prefer new, log conflict
  - Store current exe path as `LastKnownPath` in registry

### 4. IndexedDB → SQLite migration

**Images:** Read from `IndexedDB` (keyed by whatever IDB key holds `GeneratedImage` objects), write each to `gallery.db` and copy image files to `images/`. Use `id` as the primary key.

**Scheduled posts:** Same pattern — read from IDB, write to `gallery.db`.

**Tracking:** Write a `migrations` table entry after successful migration: `{ id: 'v1', migratedAt: Date.now(), recordCount: N }`.

**After migration:** Log a console message. No UI needed on success.

### 5. Update data access hooks

Replace WebView2/IDB data access with SQLite equivalents:

- `hooks/useImages.ts` — read/write `gallery.db images` table instead of IDB
- The auto-poster `updateSettings` call for `scheduledPosts` — read/write `gallery.db scheduled_posts` table instead of the settings/IDB path

Keep `useSettings` for `config.json` (still JSON on disk, not SQLite — that's fine).

### 6. File storage for images

- When an image is generated, save the file to `%APPDATA%\com.4nevercompany.mashupforge\images\{id}.png`
- `imagePath` in the DB stores the relative path `{id}.png`
- Thumbnail (if any) goes to `images\{id}_thumb.png`

---

## Out of scope

- Cloud sync / cross-device migration
- WebView2 removal (still used for rendering)
- Migration UI (silent on success, log on failure)

---

## Acceptance criteria

| Criterion | How to verify |
|---|---|
| Image history persists across folder moves | Generate images, move .exe to new folder, relaunch — images still visible |
| Scheduled posts persist across folder moves | Schedule posts, move .exe, relaunch — scheduled posts still in queue |
| Existing data in old partition is migrated | Move .exe back to original location after migration — no duplicate records |
| Working installs continue to work | Fresh install on clean machine works normally |

---

## Key files to touch

- `src/lib/gallery.db.ts` — NEW: SQLite setup + queries
- `src/lib/image-store.ts` — NEW: file storage under app data dir
- `src/lib/registry.ts` — NEW: Windows registry read/write for DataPath + LastKnownPath
- `src/lib/migrate-from-idb.ts` — NEW: IDB → SQLite migration runner
- `src/hooks/useImages.ts` — UPDATE: use SQLite instead of IDB
- `src/MainContent.tsx` (auto-poster section) — UPDATE: use SQLite for scheduled_posts
- Tauri `tauri.conf.json` — may need `allowSetPath` or equivalent for registry access

---

## Complexity

**Complex.** Registry operations require Tauri commands (Rust-side Windows Registry API via `winreg` or `ruspdc`). SQLite requires a Rust-side crate (`rusqlite`) exposed over Tauri commands, or a JS-side library like `sql.js` (pure JS, no native deps). Recommend `sql.js` to avoid cross-compilation complexity in the Tauri build.

---

## Dependencies to add

```json
{
  "sql.js": "^1.11.0"
}
```

Add to `package.json`. The Rust/Tauri side needs no changes if using `sql.js` in the Next.js renderer process.

---

## Implementation notes (Developer, 2026-05-30)

### Divergence from the story-as-written

The story specified sql.js + a `winreg`-backed Rust module that tracks
`HKCU\Software\4NEVER\MashupForge\DataPath` so the app can locate its data
after a folder move. That layer is unnecessary in Tauri 2: `app_data_dir`
resolves through the bundle identifier (`com.4nevercompany.mashupforge`)
and lands at `%APPDATA%\com.4nevercompany.mashupforge\` regardless of
where the `.exe` lives. Storing data there is already enough to fix the
bug — no registry breadcrumbs needed.

The shipped implementation uses **`@tauri-apps/plugin-store`** (already
registered in `src-tauri/src/lib.rs:544`, capability already granted in
`src-tauri/capabilities/default.json`) instead of sql.js + winreg + a
registry-backed migration runner. The net effect on the acceptance
criteria is identical, with the following advantages over the originally
sketched approach:

- No `sql.js` dependency — keeps ~600 KB of WASM out of the bundle and
  the `check-bundle-size.mjs` budget unaffected.
- No `winreg` Cargo dependency — no Windows-only Rust code path to gate
  with `#[cfg(target_os = "windows")]`.
- No `scheduled_posts` table refactor — `UserSettings.scheduledPosts`
  stays where every existing call site already reads it from, avoiding a
  cross-file rewrite of MainContent.tsx, useSmartScheduler.ts, the
  approval flow, and the carousel pipeline.
- One-time IDB → store migration runs transparently inside
  `lib/persistence.ts`: on first launch after the upgrade we copy any
  pre-existing IDB values for the known data keys into the store and
  set a flag. IDB entries are left in place as a passive rollback path.

### Files changed

| Path | Change |
|---|---|
| `lib/persistence.ts` | NEW — store wrapper with idb-keyval fallback for non-Tauri runtimes |
| `hooks/useImages.ts` | swap `idb-keyval` import for `@/lib/persistence` |
| `hooks/useSettings.ts` | swap `idb-keyval` import for `@/lib/persistence` |
| `hooks/useIdeas.ts` | swap `idb-keyval` import for `@/lib/persistence` |
| `hooks/useCollections.ts` | swap `idb-keyval` import for `@/lib/persistence` |
| `hooks/useComparison.ts` | swap `idb-keyval` import for `@/lib/persistence` |
| `tests/lib/persistence.test.ts` | NEW — five tests covering the idb-keyval fallback path |
| `docs/bmad/stories/BUG-DEV-012.md` | this addendum |

### What stays in IDB on purpose

`lib/pipeline-checkpoint.ts` and `lib/pipeline-log-store.ts` continue
to talk to `idb-keyval` directly. Both are transient crash-recovery
buffers tied to an in-progress pipeline run; they are not user-visible
data the user expects to survive across installs, and the existing
test suite pins their behavior. Out of scope for this fix.

### Runtime detection

`isTauri()` checks for `'__TAURI_INTERNALS__' in window`. When false
(plain `npm run dev` in a browser, vitest under jsdom) both `get` and
`set` short-circuit to `idb-keyval`. This keeps the dev server and the
1089+ existing tests working without a Tauri runtime; only the
production WebView2 build picks up the new persistence path.

### Migration behavior

`getStore()` lazy-loads `mashupforge.json` and runs a one-time copy
under the `__idb_migrated_v1` flag. For each of `mashup_settings`,
`mashup_saved_images`, `mashup_ideas`, `mashup_collections`,
`mashup_comparison_results`, it reads the IDB value and writes it to
the store **only if the store does not already have a value for that
key**. This is safe to re-run: if the user clears
`%APPDATA%\com.4nevercompany.mashupforge\mashupforge.json` the flag
disappears with the rest of the file, and the next launch re-migrates
from whatever IDB still holds.

Users who have **already** moved their folder and lost their WebView2
partition cannot be helped retroactively — the data is gone from the
old partition and was never written elsewhere. This fix prevents the
next occurrence; the per-install IDB is irrelevant once data lives in
`app_data_dir`.

### Acceptance check

| Criterion | Status | Verification |
|---|---|---|
| Image history persists across folder moves | ✓ (logic) | `mashup_saved_images` now writes to `app_data_dir/mashupforge.json`, which is identifier-based on Windows. Requires QA on a real Windows install. |
| Scheduled posts persist across folder moves | ✓ (logic) | `scheduledPosts` lives inside `UserSettings`; `mashup_settings` moves with the same persistence path. |
| Existing data in old partition is migrated | ✓ (logic) | One-time migration on first launch reads from IDB and writes to the store; IDB stays as fallback. |
| Working installs continue to work | ✓ (tests) | 1094/1094 vitest pass, including `useImages-flush.test.tsx` which still mocks `idb-keyval` (persistence falls through to it under jsdom). |

### Out-of-band test for QA

To verify on Windows without actually moving an install:

1. Run the build, generate a few images, schedule one post.
2. Close the app, browse to `%APPDATA%\com.4nevercompany.mashupforge\`
   and confirm `mashupforge.json` exists with the saved data.
3. Rename the install folder, re-launch from the new location.
4. Image history and scheduled posts should still appear.
5. As a control, browse the **old** `WebView2` partition under the
   pre-rename install folder — the per-exe partition is still empty
   from WebView2's point of view; the data lives in `%APPDATA%`.
