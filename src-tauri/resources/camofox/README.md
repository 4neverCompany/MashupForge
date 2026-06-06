# camofox-browser sidecar

This directory is populated by `scripts/fetch-camofox-browser.ps1` at build time.
It is intentionally empty on commit — the camofox-browser binary ships in
the NSIS installer, not in the git repo.

Layout after `fetch-camofox-browser.ps1`:

```
camofox/
├── CAMOFOX_VERSION.txt   audit-trail: "@askjo/camofox-browser@<version>"
└── package/              extracted from `npm pack @askjo/camofox-browser@1.11.2`
    ├── package.json
    ├── bin/
    │   └── camofox-browser.js   the launcher script (node-runnable)
    └── ...                      runtime deps
```

The Tauri Rust launcher (`src/lib.rs`) spawns the launcher as a child
node.exe (the same one used for the Next.js sidecar) with these env vars:

- `CAMOFOX_PORT=9377` (or 9378/9379/9380 if 9377 is held)
- `CAMOFOX_BIND_ADDRESS=127.0.0.1`
- `CAMOFOX_CRASH_REPORT_ENABLED=false` (Maurice sign-off Q2)

See `docs/camofox-integration.md` (Day 4 deliverable) for the full
runtime flow, including the 3-stage port discovery and the
`WEB_SEARCH_FALLBACK` path.
