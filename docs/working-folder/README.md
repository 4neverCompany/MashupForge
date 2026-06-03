# Working Folder — pre-prod assets & tools

This directory holds the **working artifacts** generated during the v1.0
prep and the v1.0.4 Higgsfield release. They are NOT user-facing, NOT
shipped in the app bundle, and not required at runtime. They live in
the repo so that the next operator (or agent) can:

- See what was generated
- Re-run the visual capture pipeline without guessing the viewport /
  scroll / device-scale-factor settings
- Find the source PNGs alongside the exported WebP versions that
  actually ship in `public/landing/` and `assets/`

## Layout

```
docs/working-folder/
├── README.md                  ← you are here
├── png-sources/               ← source PNGs for the AI-generated landing assets
│   ├── flow-bg.png              · exported as  public/landing/flow-bg.webp        (51 KB)
│   ├── hero-collage.png         · exported as  public/landing/hero-collage.webp   (161 KB)
│   ├── mesh-bg.png              · exported as  public/landing/mesh-bg.webp        (40 KB)
│   ├── orb-bg.png               · exported as  public/landing/orb-bg.webp         (121 KB)
│   ├── readme-hero.png          · exported as  assets/hero-banner.webp           (144 KB)
│   ├── readme-pipeline.png      · exported as  assets/pipeline-banner.webp       (82 KB)
│   ├── window-2d.png            · Tauri 2D window mockup, unused in prod
│   └── window-3d.png            · Tauri 3D window mockup, unused in prod
│
├── landing-screens/           ← Playwright capture outputs (all .png)
│   ├── desktop-full.png          · 1440×900, full landing page (5.6 MB)
│   ├── desktop-hero.png          · 1440×900, hero panel only (2.1 MB)
│   ├── section-hero.png          · 1440×900, hero section slice (782 KB)
│   ├── section-features.png      · 1440×900, features bento slice (207 KB)
│   ├── section-pipeline.png      · 1440×900, pipeline state-machine slice (543 KB)
│   ├── section-stack.png         · 1440×900, tech stack slice (315 KB)
│   ├── section-cta-footer.png    · 1440×900, CTA + footer (116 KB)
│   ├── mobile-full.png           · 390×844, full mobile landing (1.1 MB)
│   ├── mobile-hero.png           · 390×844, mobile hero (730 KB)
│   ├── mobile-features.png       · 390×844, mobile features (374 KB)
│   ├── mobile-pipeline.png       · 390×844, mobile pipeline (141 KB)
│   └── tablet-full.png           · 820×1180, full tablet landing (2.9 MB)
│
└── scripts/                   ← Playwright + GitHub API helpers
    ├── landing-screens.py        · capture full-page + viewport screenshots
    ├── landing-slices.py         · capture per-section slices (hero/features/pipeline/stack)
    ├── landing-mobile-slices.py  · capture mobile section slices
    ├── create-release.py         · v1.0.1 release body creator (one-shot, superseded)
    ├── update-release.py         · v1.0.1 release body updater (one-shot, superseded)
    ├── update-v102.py            · v1.0.2 release body updater (one-shot, superseded)
    └── update-v103.py            · v1.0.3 release body updater (one-shot, superseded)
```

## Re-running the landing screenshots

The Playwright capture scripts need a local dev server on `localhost:3939`.
If you change the landing page (`app/page.tsx` or any of its components),
re-capture to refresh these artifacts.

```bash
# 1. Start the landing dev server on port 3939
cd /workspace/mashupforge
PORT=3939 bunx next dev &

# 2. Wait for it to compile
sleep 8

# 3. Run the capture scripts (any order; full page first)
python3 docs/working-folder/scripts/landing-screens.py
python3 docs/working-folder/scripts/landing-slices.py
python3 docs/working-folder/scripts/landing-mobile-slices.py

# 4. Outputs land in docs/working-folder/landing-screens/*.png
# 5. Re-export the 6 PNG sources to WebP (see scripts/webp-export.sh
#    in commit history if you need a reference) and overwrite the
#    exports under public/landing/ and assets/.

# 6. Don't commit the script changes — they hit /workspace, not the repo.
```

## Why the v1.0.1–v1.0.3 release-body scripts are kept

The four `create-release.py` / `update-v*.py` scripts were ad-hoc
helpers used during the v1.0.1 → v1.0.3 release work to push a body
into the GitHub Release draft via the REST API. They have been
**superseded by the new workflow**:

- Hand-curated body lives in `docs/changelog-highlights/<ver>.md`
- `scripts/release.sh <ver>` splices the highlights into CHANGELOG.md
- The operator then copies the highlights content into the GitHub
  Release body (since the release workflow uses
  `generate_release_notes: true` and ignores anything else)
- Documented in `.claude/rules/release-flow.md`

The old scripts are kept for archeology (a future operator might want
to see how a release body was pushed back in June 2026). They are
**not** the current way to do this; do not copy-paste them for new
releases.

## Why the 2 window-2d/3d mockups are kept

I generated these during the Tauri 2 design phase as a visual
reference for the app shell (top bar, sidebar, content area). They
were **not** used in the final UI — `app/studio/page.tsx` and
`app/page.tsx` (landing) were implemented with hand-tuned Tailwind
classes, not from these mockups. Kept here in case you want a
visual reference when working on the desktop app shell.
