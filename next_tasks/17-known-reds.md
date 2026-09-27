# Task 17 — Resolve the two documented known reds

**Source**: the "Known pre-existing reds" section of `AGENTS.md` (two entries,
accumulated across tasks 06→16); root-cause analysis session 2026-09-27 (this
plan distills it — the analysis was posted to the user in full before the go).

Both reds live in `e2e/mobile-bottom-bar.spec.ts` and have survived several
branch-final sweeps. One is a stale spec assertion (test-only migration); the
other is a real geometry defect on short viewports (product CSS + spec pin).

## Red A (desktop-chrome, test-only): drawer batch-count pin is stale

"with a selection the inline header batch toolbar stays in the drawer" asserts
`app-entry-list .batch-bar` contains the visible text `2 selected`
(`mobile-bottom-bar.spec.ts:402`). Task 12 (commit `10ce002`, user decision
2026-09-26) replaced the desktop toolbar's visible count span with the
tri-state select-all icon button whose count rides a `matBadge` and the
accessible name `Select all shown entries (2 selected)` (`entry-list.html:76`).
The task-12 sweep migrated `selectFirstTwoRows` (`e2e/helpers.ts:224`) and the
unit spec, but this spec re-pins the drawer-side contract inline and was
missed. The phone-side uses of the same string (spec lines 289/342) stay valid:
the mobile strip keeps the visible `{{ selectionCount() }} selected` label.

**Fix**: migrate the one assertion to the helper's contract, scoped to the
drawer toolbar. No product change, no visual change.

## Red B (mobile-safari, product): export menu cannot fit above the bar

"the Export action opens the shared export menu above the bar" pins
`panelBottom <= barTop + 2` (`mobile-bottom-bar.spec.ts:157`) — the task-06
contract that the `yPosition="above"` menu opens upward, bottom edge at the
bar's top. Measured failure (task-16 sweep artifacts, deterministic):
`Expected: <= 601, Received: 638.504`.

Root cause (engine-independent — a viewport-height fit problem, mislabeled
"WebKit" in the AGENTS.md note):

- The Playwright `iPhone 14` project's **layout viewport is 390×664** (844 is
  the *screen* size; Pixel 7's viewport is 412×839, 915 its screen).
- Bar host = 64px row + 1px border ⇒ `barTop = 664 − 65 = 599` ✓ (expected 601).
- The export menu renders at natural height **with no max-height clamp**
  (neither the `.export-menu` styles in `styles.scss:333` nor Material's panel
  CSS ship one): 7 two-line items + 4 section headers + 3 dividers ≈ 638.5px.
- CDK's primary "above" position needs panel top at `600 − 638.5 = −38.5`;
  the below fallback doesn't fit either; with no fitting position CDK applies
  the first position pushed into the viewport (top clamped at 0) ⇒ bottom =
  638.5, a 39.5px overlap. The failure screenshot confirms the panel at y=0
  covering the topbar.
- Pixel 7 (839px viewport): 638.5 < 774 above-space ⇒ fits, green.
  Break-even viewport height ≈ 705px.

**Fix (approved path 1 — cap the panel height)**: give the shared
`.mat-mdc-menu-panel.export-menu` a viewport-relative `max-height` so the
upward contract holds at every viewport height; the clamped panel scrolls
internally (`.mat-mdc-menu-panel` already ships `overflow: auto`). Material's
menu panel has no default max-height to fight; the app shell sizes itself with
`100dvh` (`app.scss:4`), so `dvh` is the house idiom.

The 72px constant serves both surfaces sharing the class: the phone bar menu
(needs panel ≤ viewport − 64 to clear the bar; cap gives an 8px top gap) and
the desktop topbar menu (opens downward from the 56px topbar; cap leaves a
≥24px bottom margin). The `env()` term mirrors the bar's own safe-area recipe
(`mobile-bottom-bar.scss:30`); it is 0 today (`index.html` sets no
`viewport-fit=cover`) and future-proofs the cap against a real-device meta.

**Checkpoint 17-0 (design gate — ANSWERED)**: the old-vs-new contract was
posted to the user on 2026-09-27 with both fix paths and a recommendation of
path 1 (cap); the user answered "Ok, let's solve them". The change reshapes UI
on short viewports (scrollable capped menu instead of a bar-covering one) ⇒
the visual-feature baseline protocol applies (§Baseline).

## Phases

- **P1 (qa-auditor)**: migrate the Red A assertion to the accessible-name
  contract (mirroring `selectFirstTwoRows`), scoped to the drawer toolbar.
  Commit `test(e2e): ...`.
- **P2 (ui-specialist, then qa-auditor)**: SCSS cap in `styles.scss`
  (`.mat-mdc-menu-panel.export-menu`); then extend the geometry test (probe +
  assert `panelTop >= 0`; assert the last menu row stays reachable via
  `scrollIntoViewIfNeeded` — pins the internal scrolling the cap relies on,
  a no-op where the natural panel fits). Captures per §Baseline. Commit
  `fix(export): ...`.
- **P3 (ts-reviewer)**: full branch diff review (SCSS + specs) before the
  branch-final gate.
- **P4 (orchestrator)**: branch-final sweep — full Playwright matrix per
  project + closing `npm test --coverage` + `npm run lint`.
- **P5 (orchestrator)**: docs — drop both known-red lines from `AGENTS.md`,
  correct its viewport parentheticals to the real layout viewports
  (390×664 / 412×839 — the 844/915 figures are screen sizes), archive status;
  push and STOP for user testing.

## Gates

Per phase: `npm run build`, `CI=true npm test -- --watch=false --coverage`,
`npm run lint`, `npm run typecheck:e2e`, desktop-chrome smoke of the touched
spec. P2 additionally smokes the spec on `mobile-safari` + `mobile-chrome`
(the fix's target project — verifying the fix's own red, not deferring it to
the sweep).

## Baseline (visual-feature protocol)

`__screenshots__/17-known-reds/capture.mjs` (adapted from the 06 precedent):
chromium, light theme seeded, Fate fixture via the real import path, settled
rendering; states — idle bar + export menu open at **390×664** (the actual
mobile-safari layout viewport, where the fix is visible; the standard 390×844
capture height shows no delta because the natural panel fits there) and the
topbar export menu at 1280×800 desktop (expected unchanged). Before/after
side-by-side posted with the P2 phase report.
