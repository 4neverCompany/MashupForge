# LATEST-REVIEW: 741efea + 20d23e9

**Date:** 2026-04-18  
**Reviewer:** Developer  
**Commits:**

| Hash | Description |
|---|---|
| 741efea | fix(ci): directory path for artifact upload + upload job guards |
| 20d23e9 | fix(updater): surface download failures with retry instead of silent dismiss |

---

## 741efea — CI artifact upload fix

**Verdict: PASS**

### Directory path change

```yaml
# Before (multi-glob):
path: |
  src-tauri/target/release/bundle/nsis/*.exe
  src-tauri/target/release/bundle/nsis/*.exe.sig
  src-tauri/target/release/bundle/nsis/latest.json

# After (directory):
path: src-tauri/target/release/bundle/nsis
```

`upload-artifact@v4` stores a **directory** path relative to that directory — filenames land flat in the artifact root. After `download-artifact@v4 path: bundle`, files are at `bundle/MashupForge_*.exe` etc., exactly where `ls bundle/*.exe` expects them. ✅

The fix is correct. The previous multi-glob form would have stored files relative to the workspace root, placing them at `bundle/src-tauri/target/release/bundle/nsis/*` and silently breaking the upload job on first run.

### Existence checks

```bash
if [ -z "$EXE" ] || [ ! -f "$EXE" ]; then
  echo "::error::NSIS .exe not found in downloaded artifact"
  echo "Artifact contents:"; ls -la bundle/ || true
  exit 1
fi
```

The `[ -z "$EXE" ] || [ ! -f "$EXE" ]` pattern correctly handles both the empty-glob case and the file-not-found case. `ls -la bundle/` on failure gives an immediate diagnostic. Same pattern for `SIG` and `LATEST`. ✅

### Minor notes (non-blocking)

- The directory upload includes all files in `nsis/` — Tauri may add temp files. In practice the NSIS output directory contains only `.exe`, `.exe.sig`, and `latest.json`, so this is fine. The `ls bundle/*.exe | head -n1` picks the right one regardless of extras.
- `if-no-files-found: error` would trigger if the directory is empty. But EXE and SIG were already verified before the artifact upload step, so the directory is guaranteed non-empty. ✅

---

## 20d23e9 — updater download error handling

**Verdict: PASS**

### Problem solved

`downloadAndInstall()` throwing previously transitioned to `{ kind: 'error' }`, which the render guard `if (state.kind === 'idle' || state.kind === 'error') return null` silently hid. Users clicking "Update Now" would see the spinner disappear with no explanation.

### New `download-error` state

```ts
| { kind: 'download-error'; update: UpdateLike; message: string }
```

The key design decision: carrying `update` in the error state so `handleRetry` can transition directly back to `available` without a fresh manifest fetch:

```ts
const handleRetry = useCallback(() => {
  if (state.kind !== 'download-error') return;
  setState({ kind: 'available', update: state.update });
}, [state]);
```

This is correct — the update object is still valid; only the download failed. ✅

### `update` scope in catch — verified

```ts
const handleUpdate = useCallback(async () => {
  if (state.kind !== 'available') return;
  const update = state.update;           // ← captured before try
  setState({ kind: 'downloading', ... });
  try {
    await update.downloadAndInstall(...);
  } catch (e: unknown) {
    setState({ kind: 'download-error', update, message: detail }); // ← in scope ✅
  }
}, [state]);
```

`update` is declared before the `try` block and is in scope in the `catch`. Even if the component re-renders during the download (state changes to `downloading`), the closure-captured `update` remains the correct value. ✅

### Render guard order — correct

```ts
if (state.kind === 'idle' || state.kind === 'error') return null;  // (1)

if (state.kind === 'download-error') { return <ErrorPanel />; }    // (2)
```

`download-error` is not caught by guard (1), so it reaches (2) correctly. The offline/check failures (`kind: 'error'`) continue to render null — this is intentional and documented in the commit message. ✅

### Dismiss semantics — correct

`handleDismissError` → `setState({ kind: 'idle' })` — no localStorage write. The update notification will reappear on next app start, which is the right behavior after a transient download failure.

If the user retries and lands back on `available`, clicking the existing Dismiss button there DOES write to localStorage, suppressing the version permanently. Correct escalation. ✅

### Error message rendering — safe

```tsx
<p className="text-[10px] text-zinc-400 mt-1 font-mono line-clamp-3 break-words">
  {state.message}
```

`line-clamp-3` caps overflow. `break-words` handles long URL-like error strings from the Tauri plugin. React renders `{state.message}` as text, not HTML — no XSS risk. ✅

### Known gap documented

The commit message correctly identifies and scopes the concurrent-install race: "two concurrent app instances will both call downloadAndInstall and race on Tauri's temp installer path. Belongs in tauri-plugin-single-instance, not the frontend." Out of scope here. ✅

### Minor note

`post-update` panel still uses `emerald-500/30` and `emerald-400` tokens (existing code, not introduced by this commit). These are semantic ("success/installed") and already in the AUTO-D004 backlog.

---

## Summary

| Commit | Verdict | Notes |
|---|---|---|
| 741efea | ✅ PASS | Directory path fix is correct; existence checks are well-formed |
| 20d23e9 | ✅ PASS | State machine correct; `update` in scope; dismiss semantics right |

No issues found. No follow-up commits needed.
