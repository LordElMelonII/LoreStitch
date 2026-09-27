# Task 16 — Topbar & Entry-Editor Restyle (token-meter battery, action dividers, focus-toggle relocation)

> **Source**: user hand-styled the full change set as an uncommitted 8-file WIP on `develop`
> (2026-09-27 session) and ordered it completed through the standard pipeline — design-complete
> intent, not accidental drift.
> **Type**: Visual restyle + two behavior refinements (About reachability, tablet meter shape)
> **Suggested agents**: `ui-specialist` (audit-and-complete lead) → `ts-reviewer` → `qa-auditor`
> **Status**: ✅ Implemented; checkpoint approved 2026-09-27; branch pending user testing.
> **Branch**: `feature/16-topbar-token-meter-restyle` (off `develop` @ `2e8ec7c`).

---

## 1. The four changes (the WIP as spec)

1. **Token meter → progressive-fill "battery"** (`token-meter.ts`): the Always Active Token
   Footprint pill gains a `--meter-fill` track fill proportional to budget usage, a tertiary
   near-budget tier at ≥85% (`near-budget` class), and an over-budget error tier
   (`over-budget`, error fill + `priority_high` glyph). New computeds `hasBudget`,
   `fillPercentage`, `isNearBudget` read `TokenFootprint.usage`/`.budget`.
2. **Topbar action regrouping** (`topbar.html/.scss`): vertical `mat-divider` separators
   (non-mobile only) frame the action groups; `more_vert` moved **before** the export button;
   the app-level group (Theme, About) is divider-framed.
3. **Focus-mode toggle relocation**: removed from the topbar; re-homed inside the entry
   content field, docked in an in-field `mat-toolbar` next to the delimiter button
   (desktop-only, same `aria-pressed`/tooltip contract). Angular projects the toolbar into the
   form-field **infix**, so the controls render as a bottom-docked pill row inside the content
   well; the toolbar's default container background is neutralized via component tokens.
4. **Global corner token**: `--mat-sys-corner-extra-extra-large: 32px` on `html` (and mirrored
   into `html.theme-dark`, whose `mat.theme()` re-emits the token set at higher specificity —
   without the mirror the 32px died in dark theme only). Consumer: the in-field toolbar's
   pill radius.

## 2. Checkpoint decisions (user, 2026-09-27)

1. **Tablet meter**: the meter "should look like on desktop" — the pill branch is
   `!isMobile()`, so tablets 768–1279 keep the labeled battery pill; only phones <768 render
   the icon-only circle. (The WIP's original `isDesktop()` branch would have given tablets the
   circle; flagged at the checkpoint, reversed by decision.) Pinned in `topbar.spec.ts`.
2. **About reachability**: the standalone About button renders **only while no project is
   open** (`@if (!workspace.activeProject())`, removal not hiding — the GitHub-link parking
   precedent). With a project open, About lives in the More menu's universal entry. Rationale:
   a permanent About button clutters the bar. Note: the raw WIP had deleted the standalone
   button entirely, which left About unreachable from the welcome screen (the More menu is
   project-gated); the pipeline restored it and the user chose the gated form.
3. **Overall design approved** (battery tiers, divider grouping, focus-toggle relocation).

## 3. Visual baseline

- Capture script: `__screenshots__/16/capture.mjs` (`node __screenshots__/16/capture.mjs before|after`).
- Pinned conditions: Playwright chromium, fresh context per viewport (1280×800 / 1024×768 /
  390×844), light theme seeded via `lorestitch-theme` localStorage before boot, Fate Stay Night
  fixture through the real welcome-screen import flow, settled rendering + hover-tooltip
  parking before every shot.
- Sets: 18 shots each under `__screenshots__/16/{before,after}/` — welcome, project-open
  (no-budget meter state), meter healthy ~50% / near ~92% / over ~140% (budgets calibrated off
  the book's exact token total, read from the inspector's "Over budget by ~N tokens" caption
  with budget=100), and the entry editor.
- The before-set was captured from `develop` HEAD (WIP stashed for the capture, then
  restored); the after-set was re-captured after the checkpoint amendments.

## 4. Contracts & notes

- The meter keeps the 48px touch floor on the circle via `--mat-icon-button-state-layer-size`
  (the old <768px CSS floor); no `!important` on Material internals (the WIP's icon-margin
  `!important` was replaced with a specificity-correct rule).
- Multi-tab focus-toggle duplication (inactive mat-tab bodies stay in the DOM): accepted and
  documented in the template — inactive bodies are `visibility: hidden`, so extra copies are
  unclickable and out of the a11y tree; e2e assertions scope to `.mat-mdc-tab-body-active`.
- `matTextSuffix` on the delimiter button is inert post-relocation (the toolbar projects into
  the infix; projection is shallow) — left in place, harmless.
- Ligature set unchanged (verified against the pre-subsetted font); no `icons:refresh` needed.
