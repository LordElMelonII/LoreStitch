# Task 24 progress ledger — LoreStitch brand mark (app icons + in-app)

Branch: `feature/24-brand-icon` (off `develop` @ `809ecf6`). Direct user
intake: the user designed the mark (`new-icon-svg-optimized.svg`, untracked
at the repo root) and asked "what now", then approved full scope — asset
pipeline ("take care of everything, apple-touch-icon too") plus in-app
placement ("could be shown instead of the icon in the topbar", extended
mid-task to "In the About dialog too" and "the Glyph in welcome screen
should be gone too").

## P1 — Icon set pipeline (`a1f792f`)

- `public/icons/icon.svg`: the source mark, moved from the repo root —
  single canonical artwork, both the served SVG favicon and the generator
  input.
- `scripts/generate-icons.mjs` + `npm run icons:generate` (devDeps `sharp`,
  `png-to-ico`): regenerates every shipped icon from that one SVG —
  favicon.ico (16/32/48 layers), the eight any-purpose PWA PNGs (72–512,
  full-bleed), maskable PNGs (192/512, mark at 60% on an opaque white tile),
  apple-touch-icon (180, same padded treatment). Density-scaled vector
  rasterization (no big-render downsample) keeps the 16px layer crisp;
  pixel-probe verified the alpha plane (transparent ground + transparent
  left page, `#a40` right page).
- `public/manifest.webmanifest`: the old lumped `"purpose": "maskable any"`
  per file is split — full-bleed set is `any`, padded set is `maskable`
  (launchers crop maskable icons to the central 80% circle, which the
  full-bleed frame corners violate); plus an `icon.svg` entry
  (`image/svg+xml`, `sizes: any`). Filenames stay stable so the ARD
  catalog's `logoUrl` (`icon-512x512.png`) keeps resolving; the
  `/icons/*` immutable-cache caveat is documented in
  `public/icons/README.md`.
- `src/index.html`: SVG favicon link first (Chromium/Firefox pick it, ICO
  covers Safari) + the missing `apple-touch-icon` link.

## P2 — In-app mark (`f383d80`)

- `shared/constants/brand-mark.ts`: the mark as an inline SVG literal —
  same MatIconRegistry strategy as `GITHUB_ICON` (same-tick paint, no
  fetch, no precache entry), registered as `lorestitch-mark` in
  `app.config.ts`. Unlike the GitHub mark it does NOT use `currentColor`:
  `#a40` is the brand color itself (user-approved at the gate), identical
  to the shipped icon set; the constant doc pins the byte-equal-artwork
  coupling to `icon.svg`.
- Swapped the `auto_stories` glyph at all three brand spots: topbar
  `.brand-icon`, About dialog header `.app-icon` (34px), welcome hero
  `.welcome-icon` (64px, keeps its 0.85 mute). The `--mat-sys-primary`
  tint came off all three (inert on the fixed-color SVG).
- Last `auto_stories` usage gone → `npm run icons:refresh` regenerated the
  subsetted Material Symbols font without it (staged woff2, 67 icons).

**Tests**: no e2e/unit spec pinned the old glyphs or any icon URL (grepped);
the four specs rendering affected templates register the literal directly
(`app`, `topbar`, `welcome-screen`, `about-dialog` — the app-initializer
registration is bypassed under TestBed), and the topbar spec now pins the
brand glyph as an inline SVG.

**Gates run**: `npm run build` green; full suite with coverage 63 files /
1449 tests passed (thresholds enforced in-run); `npm run lint` green;
`npm run typecheck:e2e` green.

**Visual baseline** (`__screenshots__/24-brand-icon/`, pinned
chromium/light/1280+1024+390 + dark desktop, fresh context per viewport,
`capture.mjs`/`compose.mjs` alongside): before/after welcome + About pane
per viewport (before-About shot via a stash-cycle on the pre-P2 tree),
stacked topbar crops at 2× and About-header crops, and an icon contact
sheet (sizes 16–512 on light/dark ground, apple-touch + maskable tiles,
circle-crop simulation, old Angular placeholder for contrast). User
**approved** at the gate (tunables offered: fixed `#a40` vs currentColor,
white vs amber maskable tile — both defaults kept).

**Branch-final sweep**: Playwright per project — desktop-chrome 87 passed /
20 skipped, mobile-chrome 50 / 57, mobile-safari 48 / 59 (skips are the
phone-pinned legs, by design); zero failures. Final `CI=true npm test --
--watch=false --coverage` 1449 passed, lint green.

**Commits**: `feat(brand): generate the app icon set from the LoreStitch
mark` + `feat(brand): show the LoreStitch mark in the top bar, About dialog
and welcome screen` + this ledger.

**Next**: user merges (ff-only) after testing the branch.
