# Task 21 progress ledger — entry drawer UX

Plan: [21-entry-drawer-ux.md](./21-entry-drawer-ux.md) · Branch:
`feature/21-entry-drawer-ux` (off `develop` @ `c4e6f43`).

## P0 — Orchestrator setup (2026-09-28)

**Re-grounding audit at branch-off** (read-only, no drift requiring a gate):

- All pinned refs verified at HEAD: `styles.scss:566-576` (max-content CDK
  wrapper) and `:578-583` (export-dialog `width: 100%` precedent);
  `entry-list.scss:91-98` (`.list-viewport` `overflow-x: auto`), `:167-176`
  (`.item-main`/`.item-title` truncation CSS), `:185-190`, `:219-225`
  (`.item-actions` + stale "no horizontal scrolling" comment), `:115-127`,
  `:256-275` (ghost reveal + touch floors); `app.html:7`, `app.scss:17-21`,
  `:39-44`, `:50-54` (stale "full-width panels" comment), `app.ts:83-84`,
  `:122-136`; e2e pins `ui-responsiveness.spec.ts:585-651`, `:402-423`,
  `:79-95`, `:268-291`; `mobile-bottom-bar.spec.ts:206-211`;
  `entry-list.spec.ts:352+` (batch bar); `src/app/app.spec.ts` exists.
- One cosmetic drift: the `close` ligature sits at `entry-list.html:34`, not
  the plan's `:31` (3-line shift; the claim — ligature already subsetted —
  holds). Not design-relevant; no gate.

**BEFORE baseline** (`__screenshots__/21-entry-drawer-ux/before/`, gitignored):
capture.mjs per the task-12 pinned-conditions recipe — Playwright chromium,
fresh context per viewport (1280×800 / 1024×768 / 390×844, dsf 1, light theme
via `lorestitch-theme` localStorage init, en-US/UTC), new "E2E Lorebook"
project + the `ui-responsiveness.spec.ts:585` repro entry (long title + 6
keys) through the real editor flow, settled rendering (row title + "+3" chip
observed, fonts.ready + double rAF + settle). One shot per viewport
(`01-entries-drawer`).

Numeric evidence of the before-state bug (probe-before.mjs, same conditions):

| viewport | list overflow | Duplicate beyond viewport @ scrollLeft=0 | title ellipsizes | drawer width |
|---|---|---|---|---|
| desktop 1280×800 | 328px | 264px | no | 320px |
| tablet 1024×768 | 328px | 264px | no | 320px |
| mobile 390×844 | 315px | 247px | no | 340px (min(88vw,340px)) |

**Gates run**: none yet (docs-only phase).

**Commit**: `docs(next_tasks): plan task 21 entry drawer ux` (plan + README
row + this ledger).

**Next**: P1 dispatch 1 — ui-specialist, D1 truncation commit
(`fix(entry-list): truncate long titles and key chips instead of scrolling`)
with the same-commit `ui-responsiveness.spec.ts:585-651` migration.

## P1 — ui-specialist (three atomic commits)

### P1.1 — `fix(entry-list): truncate long titles and key chips instead of scrolling` (2026-09-28)

**Landed**: commit `817e736` — `src/styles.scss` (CDK wrapper `max-content` →
`width: 100%`, export-dialog pattern; comments rewritten to the truncation
contract), `entry-list.scss` (`.list-viewport` `overflow-x: auto` → `hidden`;
`.item-actions` stale comment rewritten), `e2e/ui-responsiveness.spec.ts`
(same-commit migration: test renamed `long entry names and key chips truncate
with actions visible`; new approved pins — no viewport/page overflow,
Duplicate rect inside viewport at `scrollLeft = 0`, `.item-title`
`scrollWidth > clientWidth`; four per-fact `expect.poll` calls so a
regression names the failing fact).

**Gates**: build ✓ (26s) · unit+coverage ✓ (95s) · lint ✓ (25s) ·
desktop-chrome smoke of `ui-responsiveness` ✓ 22/22 (82s, mobile leg
confirms polls absorb the drawer slide-in).

**Deviations**: none — D1 implemented exactly as locked.

**Notes carried forward**: the spec's `document.querySelector('.list-viewport')`
first-match assumption holds unless a second `app-entry-list` instance ever
appears; truncation engages at every D3 width (320–480), so the D1 pins hold
at min/mid/max resize.

### P1.2 / P1.3

_Not started._

## P2 — ts-reviewer

_Not started._

## P3 — qa-auditor

_Not started._

## Branch-final sweep

_Not started._
