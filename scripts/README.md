# scripts/

- `generate-build-info.mjs` — writes `src/app/core/models/build-info.prod.ts` (version, commit SHA, timestamp) before every production build.
- `refresh-icons.mjs` — re-subsets the self-hosted Material Symbols font (`public/fonts/material-symbols-outlined.woff2`) from the ligatures used in `src/`. Run `npm run icons:refresh` after adding an icon, and stage the font with the feature commit.
- `capture-feature-shots.mjs` — captures feature UI states as PNGs (desktop 1440×900, mobile 390×844) into `test-results/feature-shots`; needs a dev server already listening on 4301.
- `make-fuyuki-stproj.mts` — dev utility: converts the Fuyuki lorebook fixture into a `.stproj`-shaped workspace for seeding.

**Hints**

- A new icon ligature renders as raw text until the font is regenerated.
