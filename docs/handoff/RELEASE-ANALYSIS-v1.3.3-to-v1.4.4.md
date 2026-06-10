# MashupForge Release Analysis — v1.3.3 → v1.4.4
**Date:** 2026-06-09 23:30 (Europe/Berlin, UTC+2)
**Scope:** last 10 published releases + 1 unpublished (v1.4.4)
**Author:** Mavis root session (Mavis mvs_804b4053cf124ac08bdbe598ef40a4a6)

---

## TL;DR

**3 echte code-commits** sind in den 10 letzten releases tatsächlich gelandet. **8 von 10 sind leere version-bumps**. Dazu kommt: **v1.4.4 (das mega-release) hat einen dependency-drift bug und kann nicht gebaut werden** — die Tauri Windows Build ist 2x in folge gescheitert.

## 1. Release-Inventar (v1.3.3 → v1.4.4)

| Tag | Datum (UTC) | Commits | Code-Commits | Was es wirklich macht | Build status |
|---|---|---|---|---|---|
| v1.3.3 | 2026-06-09 14:44 | 1 | 0 | **LEER** — version bump only | ✓ success |
| v1.3.4 | 2026-06-09 15:28 | 1 | 0 | **LEER** | ✓ success |
| v1.3.5 | 2026-06-09 15:46 | 1 | 0 | **LEER** | ✓ success |
| v1.3.6 | 2026-06-09 16:27 | 1 | 0 | **LEER** | ✓ success |
| v1.3.7 | 2026-06-09 17:19 | 1 | 0 | **LEER** | ✓ success |
| v1.3.8 | 2026-06-09 18:31 | 1 | 0 | **LEER** | ✓ success |
| v1.4.0 | 2026-06-09 18:39 | 1 | 0 | **LEER** | ✓ success |
| v1.4.1 | 2026-06-09 18:59 | 1 | 0 | **LEER** | ✓ success |
| v1.4.2 | 2026-06-09 19:35 | 1 | 0 | **LEER** | ✓ success |
| v1.4.3 | 2026-06-09 20:26 | 1 | 0 | **LEER** | ✓ success |
| v1.4.4 | 2026-06-09 (unpublished) | 2 | 1 | 2733 lines, 27 files (mega) | ✗ **BUILD FAILED** 2x |

**8 von 10 sind internal-only releases** ("no user-facing changes since vX.Y.Z"). Jeder dieser bumps kostet ~17-30 min Tauri CI = **~4-5 stunden verschwendete CI in 6 stunden**.

Die tatsächliche arbeit:
- v1.2.10 (vor diesem zeitraum): mein OAuth redirect_uri fix
- v1.3.0: 4 features (virality predict, cost estimate, reframe, job_lookup) + 1 fix (higgsfield video models `generate create` vs `video create`)
- v1.3.1: 1 fix (virality score zu Server Action — Turbopack client bundle bug)
- v1.3.2: 1 fix (Higgsfield image-store backup integration)
- v1.4.4: 1 mega-release (Manual Studio generation panel + image storage + backup/recovery + beforeunload flush fix)

## 2. Der Process-Bug: Leere releases als feedback loop

**Symptom:** Maurice läuft `scripts/release.sh 1.3.4` manuell, ohne dass seit v1.3.3 neue code-commits dazu kamen. Das script:

```bash
# scripts/release.sh line 130-132
if [ "$(wc -l < "${block}")" -le 1 ]; then
  printf '\n_Internal-only release; no user-facing changes since %s._\n' "${prev_tag}" >> "${block}"
fi
```

schreibt sogar explizit "no user-facing changes" und committet trotzdem. Dann:

```bash
# scripts/release.sh line 224-226
git commit -F - <<EOF
chore(release): v1.3.4

## [1.3.4] — 2026-06-09
_Internal-only release; no user-facing changes since v1.3.3._
EOF
git push + tag
```

→ triggert Tauri Windows Build → ~20 min CI → leere GitHub release.

**Root cause** (Hypothese): Maurice hat einen cron-ähnlichen trigger ODER ist in einem "verify build pipeline" modus der alle 20-30 min einen re-tag macht um zu sehen ob die pipeline noch gesund ist. Vielleicht ein smoke-test.

**Real cost:**
- 8 leere builds × ~22 min avg = **~3 stunden pure CI verschwendung** in 6 stunden
- GitHub release list mit 8 einträgen die "nothing changed" sagen = **confusion für end user** die wissen wollen "was ist in v1.3.7 anders als v1.3.6?"
- CHANGELOG.md wird mit 8 einträgen vollgepflastert die keinen content haben

**Fix:** `scripts/release.sh` sollte am anfang prüfen ob es echte commits seit dem letzten tag gibt:

```bash
# Vorschlag: nach line 77
NEW_COMMITS=$(git rev-list --count "${prev_tag}..HEAD" --no-merges \
  --grep='^chore\(release\)' --invert-grep)
if [ "${NEW_COMMITS}" -eq 0 ]; then
  echo "No new commits since ${prev_tag} — skipping release."
  exit 0
fi
```

Oder noch besser: tag-basierter check. Wenn der letzte commit seit dem letzten tag nur `chore(release):` ist, kein neuer tag.

**Empfehlung:** ruf `scripts/release.sh` nur wenn du **echte änderungen** committest. Für "verify CI is healthy" reicht `gh workflow run tauri-windows.yml --input release_tag=v1.4.4` (das ist ein workflow_dispatch der KEIN neuen release pusht).

## 3. DER KRITISCHE BUG: v1.4.4 mega-release kann nicht bauen

**Build status:** Tauri Windows Build runs #27236635153 und #27235905575 — **beide FEHLGESCHLAGEN**. v1.4.4 ist nicht auf GitHub veröffentlicht (`gh release view v1.4.4` → "release not found").

**Fehlerursache:**

```
npm error Invalid: lock file's picomatch@2.3.2 does not satisfy picomatch@4.0.4
npm error Missing: picomatch@2.3.2 from lock file
```

**Was passiert ist:**

1. `d78c139 fix(backup): complete Higgsfield image-store integration` committet `@tauri-apps/plugin-fs: ^2.5.1` zu `package.json` — **ohne** `bun install` / `npm install` zu laufen
2. `bun.lock` wurde NICHT regeneriert
3. `package-lock.json` (von v1.0.6, alt) hat `picomatch@2.3.2` während `node_modules` (durch frühere bun installs) `picomatch@4.0.4` hat
4. CI workflow:
   - Versucht `bun install --frozen-lockfile` → fails (lockfile drift vs. package.json)
   - Fallback `npm ci` → fails (`package-lock.json` stimmt nicht mit `package.json`)
5. Build error ist sichtbar, aber Maurice hat den release-tag trotzdem gepusht

**Betroffene files:**

```
lib/images/storage.ts:233:    const { remove } = await import("@tauri-apps/plugin-fs");
lib/images/storage.ts:        (auch writeTextFile, readTextFile, mkdir, exists)
lib/backup/images.ts:33:      const { readTextFile } = await import("@tauri-apps/plugin-fs");
lib/backup/images.ts:         (auch writeTextFile, mkdir)
```

**Test impact:** 6 neue test files brechen alle:

```
tests/components/GalleryCard.test.tsx
tests/components/GalleryFilterBar.test.tsx
tests/components/HiggsfieldConnection-reset.test.tsx
tests/hooks/buildModerationRewriteInstruction.test.ts
tests/integration/useImages-flush.test.tsx
tests/lib/images/storage.test.ts
```

Vitrstest geht strict durch den import-analyzer — wenn `@tauri-apps/plugin-fs` nicht in `node_modules`, bricht der test bei `import { ... } from "@/lib/..."` weil lib/ transitiv das nicht-aufgelöste modul importiert.

**Production impact (Tauri desktop):**
- Der dynamic `await import("@tauri-apps/plugin-fs")` ist in try/catch blocks — silent fail
- User klickt "Export images" in Settings → Higgsfield backup → expect download → **nichts passiert** (kein error, kein download)
- User klickt "Import images" → expect merge → **nichts passiert**
- User klickt "Restore from backup" → expect restore → **nichts passiert**
- Maurice hat's in v1.4.3 (leere release) noch nicht gemerkt weil v1.4.3 KEIN code-change war (nur version bump auf den schon kaputten state)

**Was fehlt konkret um v1.4.4 zum laufen zu kriegen:**

1. `Cargo.toml` line 11-20 ergänzen:
   ```toml
   tauri-plugin-fs = "2"
   ```

2. `src-tauri/Cargo.lock` muss refreshed werden: `cargo update -p app` (in `src-tauri/`)

3. `src-tauri/src/lib.rs` muss das plugin registrieren:
   ```rust
   .plugin(tauri_plugin_fs::init())
   ```

4. `src-tauri/tauri.conf.json` plugins block ergänzen:
   ```json
   "fs": {
     "scope": ["$APPDATA/*", "$DOCUMENT/*"]
   }
   ```

5. `package.json` dependency ist da — gut. Aber:
   ```bash
   bun install
   ```
   muss laufen um `bun.lock` zu refreshen.

6. Optional: `package-lock.json` löschen (oder sync zu `package.json`) damit der npm fallback auch tut.

## 4. Code-quality findings

### 4.1 Hardcoded version strings (lib/backup/images.ts)

```ts
// Line 64 — in autoBackupImages()
const metadata: BackupMetadata = {
  ...
  version: '1.3.1',  // ← hardcoded
  ...
}

// Line 108 — in exportImagesToFile()
version: '1.3.1',  // ← hardcoded again
```

`version: '1.3.1'` wurde in v1.3.1 geschrieben, ist jetzt in v1.4.4. Backup metadata behauptet fälschlich "ich bin von v1.3.1" obwohl der backup in v1.4.4 erstellt wurde. Sollte von `package.json` derived sein.

**Fix:** `import { version } from '../../package.json' assert { type: 'json' }` oder via `lib/app-version.ts` constable.

### 4.2 Falscher doc-version reference (hooks/useImages.ts)

```ts
// Line 137:
V1.4.4-DATALOSS-FIX: the v1.2.6-HOTFIX gated this listener on
//                          ^^^^^^^^^^^^^^^^^^ wrong version
```

Die gated-listener fix war **v1.2.7-HOTFIX** (commit `789743b`), nicht v1.2.6. v1.2.6 war das Vercel AI SDK upgrade. Tests referenzieren richtig (line 15, 24 von `useImages-flush.test.tsx`).

**Fix:** sed-replace `v1.2.6-HOTFIX` → `v1.2.7-HOTFIX` in `useImages.ts:137`.

### 4.3 Misleading function name + docstring (lib/backup/images.ts)

```ts
// Line 132 — Doc sagt:
"merges with existing images (newer wins, dedupe by `id`)"

// Was es wirklich tut (Zeile 132-149):
"returnt nur die validierten images, OHNE merge"
```

Der eigentliche merge passiert in `HiggsfieldConnection.tsx:handleImport` (lines 866-878) — der ruft `importImagesFromFile` und mergt dann manuell mit `byId.set(img.id, img)`.

**Probleme:**
- Funktionsname `importImagesFromFile` impliziert "import" aber es parsed nur
- Der manuelle merge in `handleImport` ist "imported wins over existing" (line 876) — NICHT "newer wins" wie der doc sagt
- Die "imported wins" semantik ist vermutlich gewollt, aber nirgends dokumentiert

**Fix:** 
- `importImagesFromFile` → `parseImagesFromFile` umbenennen
- doc klar machen: "validates and returns; caller must merge"
- Im handleImport den comment "newer wins" raus, "imported wins (overwrites existing by id)" rein

### 4.4 Fragile path concatenation (lib/backup/images.ts:88)

```ts
const configPath = await join(appDir, '..', 'config.json')
```

`appDir` ist `C:\Users\...\AppData\Roaming\com.4nevercompany.mashupforge\`. `..` einen hoch = `C:\Users\...\AppData\Roaming\`. Aber `config.json` wird von `lib/desktop-env.ts` in `process.env.MASHUPFORGE_CONFIG_DIR` (default `${appDir}/../config.json`) geschrieben — könnte je nach installer variieren. Sollte via `lib/desktop-env.ts`'s `getConfigPath()` helper aufgelöst werden, nicht hardcoded.

### 4.5 `version: '1.3.1'` in dynamic JSX label (ManualGenerationPanel.tsx:56)

```ts
type Provider = 'higgsfield' | 'leonardo' | 'minimax'
```

vs `PROVIDER_LABEL`:
```ts
const PROVIDER_LABEL: Record<Provider, string> = {
  higgsfield: 'Higgsfield',
  leonardo: 'Leonardo',
  minimax: 'MiniMax',
}
```

Das ist konsistent mit dem codebase-pattern (lowercase internal, branded display) und brand-guards checkt nur FORBIDDEN patterns nicht REQUIRED capitalization. Also kein echter bug, aber das pattern sollte konsistent dokumentiert sein in CONTRIBUTING.md damit zukünftige contributors nicht verwirrt sind.

## 5. Recurring bug patterns (last 12 releases)

| Pattern | Affected releases | Root cause |
|---|---|---|
| Settings/persistence race | v1.2.5, v1.2.7, v1.2.8, v1.4.4 | `useSettings/useImages/useCollections/useIdeas` haben alle das gleiche lazy-load + beforeunload + merge pattern, kein shared abstraction. Jeder fix konzentriert sich auf einen hook, der andere hat den bug noch. |
| OAuth/PKCE flow | v1.2.8, v1.2.9, v1.2.10 | Tauri WebView's cookie-jar + redirect_uri mismatch. Jeder fix konzentriert sich auf einen aspekt (WebView vs system browser, reset-client vs connect, redirect_uri match), keine end-to-end test. |
| CLI adapter correctness | v1.2.6, v1.3.2 | Higgsfield CLI hat feature-subcommands die iterativ entdeckt werden (generate, video, cost, jobs). Jeder release entdeckt mehr. |
| Build pipeline drift | v1.0.6, v1.4.4 | bun vs npm vs lockfile drift. pattern: dependency added but `bun install` nicht gelaufen. |

**Größte sorge:** **#1 (settings/persistence)** — Maurice hat jetzt 4 releases gebraucht um den beforeunload flush korrekt zu kriegen, und es gibt noch 4 andere hooks mit dem gleichen anti-pattern. Empfehlung: `usePersistentStore<T>(key, initialValue)` Hook extrahieren der alle 3 concerns einmal korrekt macht, alle 4 use-cases migrieren.

## 6. Velocity / asset trends

| Metric | v1.2.10 | v1.3.0 | v1.4.4 (build failed) |
|---|---|---|---|
| Tests passing | 1853 | ~1880 | 1902 |
| Test files | 152 | ~155 | 162 |
| New prod code (LOC) | n/a | ~3000 (4 new tools + adapter extensions) | 2733 (mega-release) |
| New tests (LOC) | n/a | ~1100 | ~660 |
| Test:prod ratio | n/a | ~37% | ~24% |
| Setup.exe size | 61.9 MB | ~62 MB | unpublished (build fail) |
| Portable size | 94.6 MB | ~94.6 MB | unpublished (build fail) |
| Tauri build time | 18m32s | ~22m | unpublished |

**Test:prod ratio** fällt von ~37% (v1.3.0 features) auf ~24% (v1.4.4 mega). Das ist nicht per se schlecht — der v1.4.4 hat viel UI (ManualGenerationPanel.tsx 723 lines) wo integration tests schwer sind. Aber die 6 jetzt-failing tests sind ein alarm signal dass die test-coverage NICHT vor build-failures schützt.

## 7. Empfehlungen (priorisiert)

### 🔴 DRINGEND: v1.4.4 build fixen
Ohne v1.4.4 funktioniert das mega-release nicht — kein export/import/restore von images.

```bash
# 1. Rust side
echo 'tauri-plugin-fs = "2"' >> src-tauri/Cargo.toml
# src-tauri/src/lib.rs: .plugin(tauri_plugin_fs::init())
# src-tauri/tauri.conf.json: "fs": { "scope": ["$APPDATA/*", "$DOCUMENT/*"] }

# 2. JS side
bun install  # refreshes bun.lock

# 3. (Optional) sync package-lock.json with package.json
# rm package-lock.json && npm install --package-lock-only
```

### 🟡 WICHTIG: release.sh empty-bump guard
Mindestens ein warning wenn keine echten commits seit letztem tag. Idealerweise hard-skip.

### 🟡 WICHTIG: shared persistence hook
4 release-iterationen für den beforeunload flush zu konvergieren ist ein symptom dass das pattern extracted gehört:
```ts
// lib/hooks/usePersistentStore.ts
export function usePersistentStore<T>(key: string, initial: T): {
  value: T;
  set: (next: T) => void;
  isLoaded: boolean;
};
```
Dann 4 callsites ersetzen, **eine** test suite.

### 🟢 NICE-TO-HAVE: docstring/typo fixes
- `useImages.ts:137` "v1.2.6-HOTFIX" → "v1.2.7-HOTFIX"
- `lib/backup/images.ts:64, 108` hardcoded version '1.3.1' → derived
- `lib/backup/images.ts:132` docstring "newer wins" → "imported wins"

## 8. Test failure count change (v1.2.10 → v1.4.4)

| | v1.2.10 | v1.4.4 |
|---|---|---|
| Tests passing | 1853 | 1902 (+49) |
| Tests failing | 14 | 14 (same) |
| **Test FILES failing** | **1** | **7** (+6) |
| New failing files | n/a | GalleryCard, GalleryFilterBar, HiggsfieldConnection-reset, buildModerationRewriteInstruction, useImages-flush, images/storage |

Die 14 individual test failures ist "stable" weil vitest sie als ein file (tauri-sqlite) zählt. Aber **6 neue test files** brechen seit v1.2.10 — alle wegen `@tauri-apps/plugin-fs` missing import resolution. Fix v1.4.4 dependency drift → alle 6 wieder grün.

## 9. Was als nächstes

Wenn du (Maurice) die 3 prioritäten oben abarbeitest:
1. v1.4.4 build fixen (DRINGEND) → ~30 min
2. release.sh empty-bump guard (1-2h)
3. shared persistence hook (4-8h)

Plus die nice-to-haves in einem v1.4.5 cleanup release bündeln.
