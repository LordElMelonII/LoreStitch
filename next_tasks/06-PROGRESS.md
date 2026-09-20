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

## Phase 1 — Always-docked bar + focus policy (2026-09-20, ui-specialist)

- Commit: `8961b2d fix(shell): keep the mobile bar docked under drawers and dialogs`
  (9 files, +230/−103: `mobile-bottom-bar.ts/.html/.scss` + spec,
  `app.ts/.html` + `app.spec.ts`, `features/shell/README.md`,
  `mobile-bottom-bar/README.md`).
- What landed (§3.1 + §3.4):
  - `visible` collapsed to `isMobile() && activeProject() !== null`;
    `overlayOpen` input deleted; `drawerOpen` replaced by
    `barState: InputSignal<BarState>` with `BarState = 'normal' |
    'backgrounded' | 'batch'` (batch is union-only until P2 — final input
    contract in place from P1).
  - `backgrounded` = host `bar-backgrounded` class: scrim-token veil on
    `:host::after` (`--mat-sidenav-scrim-color` fallback mix, Material's 400ms
    curve), `[attr.inert]` on the `nav`, `pointer-events: none`. No z-index
    games (spatially disjoint per plan §2c).
  - Shell: `barState` computed (`anyDrawerOpen ? 'backgrounded' : 'normal'`);
    `onHistoryDrawerOpened` body-guard deleted; §3.4 pane-focus policy bound
    to BOTH sidenavs' `(opened)`, guarded `layout.isMobile()` (desktop
    persistent-trigger pin untouched).
  - Spec migrations per §3.6: bar spec's two "hides while…" tests inverted to
    stays-stamped/inert pins; app.spec history-focus narrative rewritten to
    the deterministic policy + new entries-pane case (§7.5 side fix pinned);
    desktop pin green untouched.
- Gates: `CI=true npm test -- --watch=false` **green** (993/993; coverage
  95.81/89.18/90.79/97.31 vs thresholds 80/75/80/80; bar component 100%);
  `npm run build` **green**. Playwright NOT run (e2e migration is P4 by
  design — `e2e/mobile-bottom-bar.spec.ts` pins old behavior until then).
- Visual evidence: canonical before/after sets captured with the identical
  pinned script (`__screenshots__/06-mobile-bar-swap/capture.mjs`):
  `before/` (pre-P1) and `after/` (post-P1), states 01 idle / 02 drawer open
  / 03 two selected / 04 drawer closed with selection, all mobile-390×844.
  Post-P1 DOM probe (`probe-after.mjs`): bar stamped + `bar-backgrounded` +
  content `inert` + host `pointer-events: none` under the open drawer;
  veil `color(srgb 0.176 0.188 0.220 / 0.4)` **identical** to the live
  `.mat-drawer-backdrop` scrim (risk §7.1 closed); workspace 723px vs 788px
  before — the §7.2 trade (drawer ~64px shorter), as planned. Supplementary
  3-state sets from the phase run also sit in `before/`/`after/`
  (`0N-*.png`; the `mobile-390x844-*` files are canonical).
- Deviations: none material — (1) inert precedent lives at
  `entry-editor/entry-keys/regex-test-panel.html` (plan cited the panel
    without the `entry-keys/` segment); binding written as `[attr.inert]`
    per the plan text. (2) The phase also removed the now-dead
    `ResponsiveOverlayService` injection + `anyOverlayOpen` alias from
    `app.ts` (direct consequence of deleting the `overlayOpen` input).

**Next:** §5 step 2 — user design checkpoint (swapped-toolbar mock,
transplant-vs-bar-items). P2 dispatch is BLOCKED until the user answers.

## Checkpoint evidence posted (2026-09-20, orchestrator)

- Mocks rendered over the real app in the P2 phone state (drawer open, two
  rows selected, in-drawer toolbar removed; script
  `__screenshots__/06-mobile-bar-swap/mock-swap.mjs`):
  `mock-A-transplant.png` (today's `.batch-bar` node moved into the bar
  strip, centered — real checkbox/buttons/tokens),
  `mock-A2-transplant-emphasis.png` (+ subtle `secondary-container` tonal
  top edge), `mock-B-bar-items.png` (five icon-over-label bar items, count
  as a label, select-all via the More menu). P2 implementation note banked
  from the mock: the transplanted toolbar's `.batch-bar` styles must be
  OWNED by the bar's stylesheet (entry-list's scoped rules nest under
  `.list-header` and stop applying once the node moves).
- **GATE OPEN — awaiting the user's answer. No P2 dispatch.**

## Checkpoint answer + rebase (2026-09-20, orchestrator)

- **User answered Gate 06-1: variant A2** — the transplanted `.batch-bar`
  toolbar in the bar strip, WITH the subtle `secondary-container` tonal
  top edge (inset `box-shadow`) as the foreground cue. P2 implements A2.
- User gave the ff-merge go-ahead for Task 07; `develop` fast-forwarded to
  `0b7f9a4` and pushed. This branch **rebased onto the new develop** (clean —
  P1's files are disjoint from 07's): P1 commit is now `f15b2f6`, branch
  HEAD `c7bfdba`, force-pushed with lease.
- Post-rebase sanity: `CI=true npm test -- --watch=false` **green**
  (54 files / 1013 tests — the union of both tasks' suites).
- **GATE CLOSED — P2 dispatched with the A2 decision.**

## PAUSED (2026-09-20, orchestrator — machine shutdown requested)

- P2 was dispatched but CANCELLED mid-phase by the user (machine pause).
  Its partial unverified work (9 files) was stashed as
  `stash@{0}` ("task 06 P2 partial (cancelled mid-phase…)") — insurance
  only; resume does NOT restore it, a fresh P2 dispatch starts from the
  plan. Nothing of P2 is committed.
- Working tree clean; branch HEAD `83c3a32`, pushed.
- **Next (resume point): P2 (ui-specialist)** — the full A2-design brief
  stands as written for the cancelled dispatch: §3.2 + §3.3, transplanted
  toolbar styled by the bar's stylesheet, barState batch case in the shell,
  `batchAction` output, EntryList public API, clear/delete-selection focus
  recovery. Gate: `npm test` + `npm run build`. Then P3 (ts-reviewer), P4
  (qa-auditor incl. re-captured after-set with the swapped state), task
  status commit, STOP for user test. After that: Task 08 P2 (treatment 1)
  → P3 → P4, then the archive step.
