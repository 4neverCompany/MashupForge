# Brief: Fix WebView2 Partition Data Loss on Folder Move

## Problem

Moving the MashupForge installation folder causes all saved images and scheduled posts to disappear. Root cause: WebView2 uses a per-executable-path partition for IndexedDB storage. When the exe moves, WebView2 creates a new empty partition.

## Acceptance Criteria

1. Image history persists across folder moves (data stored in fixed `%APPDATA%` location, not WebView2 partition)
2. Scheduled posts persist across folder moves
3. Clean migration path: existing data in old partition is read/migrated on first launch from new location
4. No regression: existing working installs continue to work

## Technical Direction

- Replace WebView2 partition-based IndexedDB with a fixed app data directory (`%APPDATA%\com.4nevercompany.mashupforge\`)
- Use SQLite (gallery.db) for structured data (scheduled posts, image metadata)
- Store generated images in a fixed `images/` subdirectory
- On startup, detect if running from a new path vs old known path; migrate data if needed
- Store the "known data path" in Windows Registry at a fixed key (`HKCU\Software\4NEVER\MashupForge\DataPath`)

## Out of Scope

- Cloud sync / cross-device migration
- WebView2 itself (still used for rendering)

## Priority

High — users who have already moved their folder have permanently lost data. Fix prevents future occurrences.
