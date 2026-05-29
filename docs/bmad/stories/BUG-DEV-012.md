# BUG-DEV-012 — WebView2 partition data loss fix

**Status:** Open
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
