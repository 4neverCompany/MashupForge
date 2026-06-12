# Tauri Desktop Resources

This directory is populated by the Windows build scripts at build time.
It is intentionally empty on commit — only this README is tracked.

Layout after `build-windows.ps1`:

```
resources/
├── README.md               (this file)
├── node/                   Node.js 22 LTS Windows binary
│   ├── node.exe
│   ├── npm.cmd
│   └── node_modules/npm/
└── app/                    Next.js standalone server
    ├── start.js            Tauri server wrapper (env hydration + require(./server.js))
    ├── server.js           Next.js standalone entrypoint
    ├── .next/              compiled Next output
    ├── public/             static assets
    └── node_modules/       trace-minimized runtime deps
```

Note: pi.dev is no longer supported (M3.3-P3 commit c). The previous
`PI_BIN` / `MASHUPFORGE_PI_DIR` env-var surface is gone with the
deletion. The Tauri Rust launcher (`src/lib.rs`) resolves `resource_dir` at runtime
and spawns `node/node.exe` with `app/start.js`, passing a random ephemeral
`PORT`.

See `docs/WINDOWS-BUILD.md` for the full build flow.
