# Task 17 — Progress Ledger

Plan: [17-known-reds.md](./17-known-reds.md). Branch: `feature/17-known-reds`
(off `develop` @ `177df06`). Checkpoint 17-0 answered 2026-09-27 (user approved
the cap path for Red B: "Ok, let's solve them").

## Phase 0 — planning

**Status**: ✅ complete

- Branch created; plan + this ledger committed
  (`docs(next_tasks): plan task 17 ...`).
- Verified at HEAD: Red A assertion still stale (spec line 402); Red B still
  repros per the task-16 sweep artifacts (`test-results/…mobile-safari*`,
  `Expected: <= 601 / Received: 638.504`, both try and retry).
- Material panel ships `overflow: auto` (cap ⇒ internal scroll, no extra
  rule); topbar 56px; shell sizes with `100dvh`; no other spec pins the
  count/menu geometry (unit `mobile-bottom-bar.spec.ts:296` pins the mobile
  strip's visible label — still valid).

**Next**: before-captures, then P1 dispatch.

## Phase 1 — Red A spec migration (qa-auditor)

**Status**: ✅ complete — commit `440801b`
`test(e2e): pin the drawer batch count on the select-all accessible name`

- `e2e/mobile-bottom-bar.spec.ts` desktop describe: `toContainText('2 selected')`
  → `toolbar.getByRole('checkbox', { name: 'Select all shown entries (2 selected)' })`
  `.toBeVisible()` (mirrors the migrated `selectFirstTwoRows` contract). The
  two phone-side visible-label pins (lines 289/342) untouched — still valid.
- Gates: agent ran `typecheck:e2e` (clean) + desktop-chrome smoke of the spec
  (2 passed / 7 skipped — the previously red test green). Orchestrator fast
  gate: `npm run build` ✓ · `CI=true npm test --coverage` ✓ (60 files / 1329
  tests, thresholds enforced) · `npm run lint` ✓.
- Before-captures landed pre-P1 under `__screenshots__/17-known-reds/before/`;
  they independently reprove Red B's engine-independence (chromium 390×664:
  panel 0→638.5 vs barTop 599 — the exact task-16 WebKit numbers).

**Next**: P2 dispatch (ui-specialist cap, then qa-auditor spec extension).

## Phase 2 — Red B height cap + spec extension (ui-specialist → qa-auditor)

**Status**: ✅ complete — commit `04b281a`
`fix(export): cap export-menu height so the phone menu clears the bar`

- `src/styles.scss` (`.mat-mdc-menu-panel.export-menu`): `max-height:
  calc(100vh - 72px)` + `max-height: calc(100dvh - 72px - env(safe-area-inset-
  bottom, 0px))` (progressive pair; dvh is the house idiom, env mirrors the
  bar's safe-area recipe). Panel ships `overflow: auto` ⇒ clamp scrolls
  internally. ui-specialist verified the compiled CSS lands on the shared
  selector (topbar `topbar.html:122` + bar `mobile-bottom-bar.html:209`).
- `e2e/mobile-bottom-bar.spec.ts` export-menu test: edges probe now returns
  `panelTop`, asserted `>= -1`; last row ("Character card (JSON)") pinned
  reachable via `scrollIntoViewIfNeeded` (no-op where the natural panel fits).
- Measured after (capture script, chromium 390×664): panel 8→600 (592 clamped)
  vs barTop 599 — bottom = barTop+1, inside the pin's +2 tolerance; desktop
  1280×800 unchanged (48→686.5, unclamped). Before/after sets under
  `__screenshots__/17-known-reds/{before,after}/`.
- Gates: qa-auditor ran `typecheck:e2e` (clean) + the touched spec on all
  three projects — mobile-safari **7 passed / 0 failed (the fix's own red is
  green)**, mobile-chrome 7/0, desktop-chrome 2/0. Orchestrator fast gate:
  `CI=true npm test --coverage` ✓ (60 files) · `npm run lint` ✓ · build ✓
  (ui-specialist).

**Next**: P3 ts-reviewer, then the branch-final sweep.

## Phase 3 — ts-reviewer (review before the final gate)

**Status**: ✅ complete — commit `35da35c`
`test(e2e): correct the panel-top comment's clamp and fit regimes`

- Verdict: no blockers. One comment-only suggestion applied verbatim (the
  `panelTop` comment had the clamp/fit regimes swapped — clamped viewports put
  the top ~8px down, fitted ones far lower; the −1 tolerance stands). One nit
  recorded, no change (`toBeVisible` after `scrollIntoViewIfNeeded` is
  weak-but-sufficient; the scroll call is the load-bearing pin).
- Clean-bill areas: e2e typing (narrowed `DOMRect`, no `any`/`!`), strict-mode
  safety of the new locators, assertion ordering, CSS specificity + valid
  progressive fallback pair, no `::ng-deep`/`!important`.

## Phase 4 — branch-final sweep (orchestrator)

**Status**: ✅ complete — full matrix green, **zero failures across all three
projects for the first time since the reds were documented**

- `npx playwright test --project=desktop-chrome` → 72 passed / 16 skipped
- `npx playwright test --project=mobile-chrome` → 46 passed / 42 skipped
- `npx playwright test --project=mobile-safari` → 44 passed / 44 skipped
  (includes both previously-red tests)
- `CI=true npm test -- --watch=false --coverage` → 60 files passed, thresholds
  enforced ✓ · `npm run lint` → ✓ (re-run after the P3 comment fix)

## Phase 5 — docs & push (orchestrator)

**Status**: ✅ complete — commit `docs(agents): ...`

- `AGENTS.md`: the known-reds section replaced with a no-known-reds note
  carrying the transferable lesson (layout viewport vs screen size — 390×664 /
  412×839 — and the fit-cap precedent); the Playwright projects note's
  parentheticals corrected to layout viewports.
- Branch pushed to origin. **STOP** — awaiting the user's manual testing and
  merge go (`git merge --ff-only` into `develop` is theirs to run).

## Final state

- Commits on `feature/17-known-reds`: `7cd7acf` (plan) → `440801b` (P1 test)
  → `04b281a` (P2 fix) → `35da35c` (P3 comment) → docs commit (P5).
- Both AGENTS.md known reds resolved; visual baseline under
  `__screenshots__/17-known-reds/{before,after}/` (gitignored).
