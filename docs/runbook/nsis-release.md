# NSIS Release Runbook (WSL)

Step-by-step playbook for cutting a MashupForge Windows release from WSL.
The installer bundle is built by GitHub Actions on `windows-latest`
(see `.github/workflows/tauri-windows.yml`); you drive the release
from WSL via `gh`.

See [`docs/RELEASE.md`](../RELEASE.md) for the high-level overview and
[`docs/WINDOWS-BUILD.md`](../WINDOWS-BUILD.md) for the local Windows
build (for dev builds, not releases).

---

## TL;DR checklist

Happy path — copy/paste from `main`, clean tree:

```bash
# 1. Bump
bash scripts/increment-version.sh

# 2. Tag + push
TAG=v$(grep '"version"' package.json | sed 's/.*"version": "\(.*\)".*/\1/')
git tag "$TAG" && git push origin main "$TAG"

# 3. Watch
RUN_ID=$(gh run list --workflow=tauri-windows.yml --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN_ID"

# 4. Verify
gh release view "$TAG" --json assets --jq '.assets[] | {name, size}'

# 5. Smoke-test on a Windows machine — §6
# 6. Edit release notes — §5 "Edit release notes"
```

Elapsed: ~20 min of CI wait, <5 min of keyboard time.

---

## 0. Prerequisites (one-time)

### On WSL

```bash
sudo apt update
sudo apt install -y gh jq nsis          # nsis optional — see §6
gh auth login                           # GitHub CLI auth
gh auth status                          # confirm you have write scope
```

### Signing secrets (already configured in the repo)

These must exist as repository secrets on GitHub — you do **not** set
them locally:

| Secret | Purpose |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Minisign private key for updater signing |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the above |

Verify:

```bash
gh secret list | grep TAURI_SIGNING
```

Both must be present. If missing, the CI build will succeed but the
`.exe.sig` won't be emitted and the `upload` job will fail.

### Repo state

```bash
git status                              # clean tree
git checkout main && git pull
```

Releases cut from `main` only.

---

## 1. Bump version

Three files must agree (CI enforces this):

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`

Use the script — do not hand-edit:

```bash
bash scripts/increment-version.sh
```

It patches all three files, then commits with `chore: bump version to X.Y.Z`.

---

## 2. Tag and push

```bash
TAG=v$(grep '"version"' package.json | sed 's/.*"version": "\(.*\)".*/\1/')
echo "$TAG"
git tag "$TAG"
git push origin main "$TAG"
```

The tag push triggers `tauri-windows.yml`.

---

## 3. Trigger / watch CI

Tag push auto-triggers. To re-run against an existing tag without
re-tagging:

```bash
gh workflow run tauri-windows.yml -f release_tag="$TAG"
```

Watch:

```bash
RUN_ID=$(gh run list --workflow=tauri-windows.yml --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN_ID"
```

The `build` job runs on `windows-latest` (~15–20 min); the `upload`
job runs on `ubuntu-latest` (~1 min).

---

## 4. Download artifacts (optional QA)

To grab the NSIS bundle before the release goes public:

```bash
gh run download "$RUN_ID" -n tauri-nsis-bundle -D ./dist/ci-$TAG
ls dist/ci-$TAG
```

Expect `MashupForge_<ver>_x64-setup.exe`, `MashupForge_<ver>_x64-setup.exe.sig`,
`latest.json`. Artifacts are retained 7 days.

---

## 5. Verify the GitHub Release

The `upload` job creates the release and attaches three assets:

```bash
gh release view "$TAG" --json assets --jq '.assets[] | {name, size}'
```

Expect:

| Asset | Approx size | Purpose |
|---|---|---|
| `MashupForge_<ver>_x64-setup.exe` | ~133 MB | NSIS installer |
| `MashupForge_<ver>_x64-setup.exe.sig` | <1 KB | Minisign signature for the updater |
| `latest.json` | <1 KB | Updater manifest |

### Edit release notes

```bash
gh release edit "$TAG" --notes-file release-notes.md
# or inline:
gh release edit "$TAG" --notes "Fixes updater retry, bumps deps."
```

### Re-run just the upload job

If the build artifact is good but the upload step failed (wrong notes,
transient token issue), rerun only `upload` — the `build` artifact
persists for 7 days:

```bash
gh run rerun "$RUN_ID" --job upload
```

---

## 6. Smoke-test on Windows

Before announcing the release, install on a clean-ish Windows box
(ideally a throwaway VM; at minimum, a Windows user profile with no
prior MashupForge install):

```powershell
# From the Windows host, in PowerShell:
$TAG = "v0.1.9"   # whatever you just cut
Invoke-WebRequest -OutFile "$env:TEMP\mf-setup.exe" `
  "https://github.com/4neverCompany/MashupForge/releases/download/$TAG/MashupForge_$($TAG.TrimStart('v'))_x64-setup.exe"
Start-Process "$env:TEMP\mf-setup.exe"
```

### Required checks
- [ ] NSIS installer runs to completion without error.
- [ ] SmartScreen warning appears (expected until IMPROVE-002 lands —
      click "More info → Run anyway"). Not a regression; just confirm
      the binary is otherwise accepted.
- [ ] App launches, shows the Next.js UI within ~5 s of splash.
- [ ] Settings modal opens, API keys from `%APPDATA%\MashupForge\config.json`
      persist across relaunch.
- [ ] Auto-updater check: install the *previous* release first, then
      launch — it should detect the new tag via `latest.json` and
      prompt (dialog is suppressed per `tauri.conf.json` → manual
      check via DevTools console or the Settings "Check for updates"
      path if wired).
- [ ] No crash reports surface in `%APPDATA%\MashupForge\logs\` within
      10 min of normal use.

If any step fails, see §8 "Rollback".

---

## 7. Edit and publish release notes

The `upload` job creates the release with placeholder notes
(`"Tauri desktop build for Windows."`). Replace before announcing:

```bash
# Draft notes from the commit log since the last tag:
PREV_TAG=$(gh release list --limit 2 --json tagName --jq '.[1].tagName')
git log --pretty="- %s" "$PREV_TAG..$TAG" > release-notes.md
# Edit release-notes.md by hand — group into Features / Fixes / Chore.
gh release edit "$TAG" --notes-file release-notes.md
```

Keep the audience in mind — release notes are user-facing, not
developer-facing. Drop chore/internal commits, rephrase fix commits
in plain language.

---

## 8. Rollback

If the smoke test fails, **delete the release and retag** rather than
patching forward — users who grabbed the broken installer can re-pull
from the same URL once the new bundle is published.

```bash
# 1. Delete the GitHub Release (keeps the git tag)
gh release delete "$TAG" --yes

# 2. Delete the git tag locally and remotely
git tag -d "$TAG"
git push origin ":refs/tags/$TAG"

# 3. Fix the bug on main, run scripts/increment-version.sh again
#    (do NOT reuse the same version number — the auto-updater caches
#    latest.json by version), then redo §2–§5.
```

If the broken installer has already been downloaded by external users
and you cannot reissue under the same version, publish the fix as
`vX.Y.(Z+1)` — the auto-updater will pull it on next launch and the
bad release can be marked `prerelease: true` with a note pointing at
the patched version:

```bash
gh release edit "$TAG" --prerelease --notes "Superseded by v0.1.10 — do not install."
```

---

## 9. Local `makensis` on WSL — current status

**Not supported for release builds.** `apt install nsis` gives you
`makensis`, which can compile `.nsi` scripts to `.exe` installers on
Linux, but the Tauri release path also needs a Windows-targeted Rust
build + baked Windows `node.exe` + minisign signing. See
[`docs/bmad/stories/IMPROVE-001.md`](../bmad/stories/IMPROVE-001.md)
for the cross-compile feasibility research.

If IMPROVE-001 lands a self-hosted path, it will slot in here as
"§9b: local WSL build" without changing steps 1–8.

---

## 10. Troubleshooting

- **Version parity check fails** — run `bash scripts/increment-version.sh`,
  do not hand-edit version strings.
- **`.exe.sig` missing** — signing secrets unset; see §0.
- **`latest.json` missing from bundle** — workflow step
  "Synthesize latest.json if Tauri didn't emit one" should generate it
  from the `.sig`; check the `build` job log.
- **Installer >150 MB** — non-Windows `sharp` bindings weren't stripped;
  check the workflow's strip step.
- **`gh` says "release already exists"** — expected on re-runs; the
  `upload` job uses `--clobber` on each asset.
- **Tag push didn't trigger a run** — `tauri-windows.yml` triggers on
  tags matching `v*.*.*`. Confirm the tag name.
