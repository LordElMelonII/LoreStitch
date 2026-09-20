# Task 06 — Progress Ledger

Plan: [06-mobile-bottom-bar-docked-swap.md](./06-mobile-bottom-bar-docked-swap.md)
Branch: `feature/06-mobile-bar-docked-swap` (off `develop` @ `c05592a`)

## Phase 0 — Prep & re-ground (2026-09-20)

- Re-grounded the plan against `develop` @ `aabdb3c`: verified every pinned
  reference (`mobile-bottom-bar.ts:71-78` visible computed, `html:6` `@if`,
  `scss:34-36` `.bar-hidden`, `app.html:67-71` bindings, `app.ts:87/183-203`
  anyDrawerOpen + body-guard hook, `entry-list.html:55-103` toolbar,
  `entry-list.ts:234/248-267/281-361` selection API, `app.spec.ts:257-311/313-333`,
  `mobile-bottom-bar.spec.ts:82-116`, e2e pins `mobile-bottom-bar.spec.ts:42/128/178`,
  `ui-responsiveness.spec.ts:541`, `helpers.ts:93-105`). **No drift** (only docs
  commits since the `2468de3` grounding). Committed on develop:
  `c05592a docs(next_tasks): re-ground task 06 at aabdb3c (no drift)`.
- Branch `feature/06-mobile-bar-docked-swap` created.
- **Before screenshots** captured to `__screenshots__/06-mobile-bar-swap/before/`
  (protocol: chromium, 390×844, DSF 1, light theme via `lorestitch-theme`
  init-script, FATE fixture via the real import path, settled rendering):
  `01-idle-bar`, `02-entries-drawer-open`, `03-two-selected`,
  `04-drawer-closed-selected`. Capture script + DOM probe kept beside them.
- Objective defect probe (before state): idle → bar stamped; drawer open →
  host `bar-hidden`, content unstamped, workspace height 788px (bar row
  reclaimed) — defect 1. Batch toolbar renders inside the drawer between the
  filter field and the viewport — defect 2. Clear-✕ right edge 335px vs
  sidenav right edge 340px (5px slack; clips on narrower devices) — defect 3.
- Dev note: the leftover dev server on 4301 serves this working tree and
  `playwright.config.ts` reuses it (`reuseExistingServer`).
- Gates run: none yet (docs-only phase).
- Decisions/deviations: none — plan followed as written.

**Next:** P1 (ui-specialist) — §3.1 always-docked bar + §3.4 phone drawer
focus policy. Gate: `npm test` + `npm run build`; background-state screenshots.
