# Task 16 — Progress Ledger (topbar & entry-editor restyle)

Plan: [16-topbar-token-meter-restyle.md](./16-topbar-token-meter-restyle.md).
Branch: `feature/16-topbar-token-meter-restyle` (created 2026-09-27 off `develop` @ `2e8ec7c`; the user's WIP rode along uncommitted).
Push policy: pushed to origin at branch close (task brief overrides the per-phase crash-backup rule this session).

## Phase 0 — branch + before captures (orchestrator, 2026-09-27)

- Working tree verified to match the expected 8-file WIP list exactly; `git stash push` → before-set
  captured from HEAD → `git stash pop` (8-file list re-verified) → branch created. A pre-existing
  unrelated stash from a pre-task-09 session remained in the stash list throughout — untouched.
- Capture script `__screenshots__/16/capture.mjs` written to the linter-capture pinned-conditions
  protocol; 18 before shots from HEAD in `__screenshots__/16/before/` (welcome / project-open /
  three budget tiers / entry editor × 3 viewports).
- Two capture-script bugs hit and fixed en route, both now documented in-script:
  - The welcome import row has read **"Import lorebook or character card"** since task 15 (the
    linter capture's stale `Import .json / .stproj` name matches zero buttons and stalls at
    filechooser — the AGENTS.md drift note applied to us verbatim).
  - The budget-calibration helper originally returned with the inspector dialog still open, so the
    next meter click sat behind the dialog backdrop until timeout — close the pane before returning.
- Meter-tier calibration: set budget=100 in the inspector, parse the exact overage from the
  "Over budget by ~N tokens" caption, derive total = N + 100, then set tier budgets at
  50% / 92% / 140%. Fixture total: ~320 tokens.

## Phase 1 — ui-specialist (audit-and-complete, 2026-09-27)

Build green after hygiene fixes (token-meter.ts EOF newline, stray double blank line in
entry-content-field.ts, prettier on touched files only). Risk-point verdicts:

- **(a) tablet regression**: verified live (after tablet-02 showed the circle) — reported to the
  checkpoint, branch condition left as written; reversed to `!isMobile()` after the user's decision.
- **(b) touch targets**: 48px floor restored via `--mat-icon-button-state-layer-size: 48px` on
  `.token-meter-icon`; the WIP's `mat-icon { margin: 0 !important }` replaced with a
  specificity-correct `margin: 0` (Material's only competing rule is the form-field-suffix
  `margin: auto`, which cannot reach the topbar).
- **(c) corner token**: real bug — `html.theme-dark`'s `mat.theme()` re-emits the token set at
  higher specificity, so 32px died in dark theme only; mirrored into `html.theme-dark`. No theme-light
  block exists (ThemeService only toggles `theme-dark`). Sole consumer: `.toolbar-content`.
- **(d) toolbar-in-field**: the `mat-toolbar` (direct form-field child) matches no affix selector and
  projects into the **infix** — bottom-docked pill row inside the content well. Its default
  `--mat-sys-surface` container neutralized via component tokens (transparent, no elevation); hint
  subscript alignment verified at 1280/1024/390. `matTextSuffix` on the delimiter button is now inert.
- **(e) focus-toggle duplication**: multi-tab editing can render one field per open tab; inactive
  bodies are `visibility: hidden` (unclickable, out of the a11y tree) and the toggle drives one
  global signal — accepted + documented in the template with the `.mat-mdc-tab-body-active` rule.
- **(f) icons**: ligature set byte-identical to HEAD across touched templates; no `icons:refresh`.
- **Bonus defect**: the raw WIP had deleted the standalone About button entirely → About unreachable
  from the welcome screen (More menu is project-gated). Restored next to Theme in the divider-framed
  app-level group, then re-gated per the checkpoint decision (see plan §2.2).
- Spec migrations: `topbar.spec.ts` (focus tests removed with the control; meter tier + variant tests
  added with viewport flips; About contract), `entry-content-field.spec.ts` (relocated toggle contract),
  `e2e/batch-and-tokens.spec.ts` (meter face branches by viewport; hover-tooltip assertion replaced with
  aria-label/face/click-through — Material shows tooltips on long-press under
  `touchGestures: 'auto'`, so hover provably fails on touch projects). History single-control contract
  kept green. After-set captured 18/18.

## Checkpoint — approved 2026-09-27 (user)

Tablet → desktop-style labeled pill (`!isMobile()`); standalone About → welcome screen only
(`@if (!workspace.activeProject())`, removal not hiding); overall design approved. Amendments applied by
the ui-specialist: template/comment flips, `src/testing/match-media-stub.ts` gained `setTablet` (a real
tablet classification needs the tablet query answered — the two-flip stub couldn't), `topbar.spec.ts`
pins the tablet pill + About-absent-with-project contracts, `e2e/batch-and-tokens.spec.ts` boundary
corrected from ≥1280 to ≥768. After-set re-captured 18/18 (tablet shots now show the pill).
Gates re-run green: build, 1329/1329 unit, lint, typecheck:e2e, desktop smoke 32 passed / 2 by-design skips.

## Phase 2 — ts-reviewer (2026-09-27)

Zero blocking findings, zero fixes. Signal discipline verified (note: `TokenFootprint.usage` is
`number | null`, not `number | undefined` — the `(fp.usage ?? 0)` pattern covers both); no `as`/`any`/`!`
introduced; component tokens only in SCSS; `setTablet` typed consistently. Left as-is (cosmetic, no
import-order rule): `MatToolbarModule` import placement; two dropped explanatory comments on
`openInspector` (facts remain documented on sibling methods).

## Phase 3 — qa-auditor fast gate (2026-09-27)

All green: build 14.5s; **60 files / 1329 tests passed** with coverage thresholds enforced in-run
(global 96.13 stmts / 91.08 branch / 91.4 fn / 97.35 lines); lint clean; typecheck:e2e clean;
desktop-chrome smoke (`batch-and-tokens ui-responsiveness about-dialog`) 32 passed / 2 skipped in 1.4m.
Per-file coverage matched the phase baselines exactly (token-meter 100/91.89/100/100; topbar.html fn 44 =
byte-identical pre-existing uncovered menu-item listeners). Explicit-assertion checklist verified by
reading the specs: both meter variants via flips (phone circle + aria-label, tablet + desktop pill),
near/over/no-budget tiers, relocated toggle contract, About welcome-present/project-absent.

## Phase 4 — docs + branch-final sweep + push (2026-09-27)

- Branch-final sweep, per project (full suite each):
  - `desktop-chrome`: 71 passed / 16 skipped / **1 failed** — `mobile-bottom-bar.spec.ts:391`
    "with a selection the inline header batch toolbar stays in the drawer" expects visible
    "2 selected" text in `.batch-bar`; the app carries the count on the select-all badge
    ("2") only. **Proven pre-existing**: with the task's changes stashed, the identical A/B run
    on `develop` HEAD fails the same way (task 12+ count-badge drift; the AGENTS.md known-red
    note lists only the mobile-safari export failure). Not task 16's regression; queued for the
    user to assign a fix task — not silently patched in this branch.
  - `mobile-chrome`: 46 passed / 42 skipped (by-design) / 0 failed.
  - `mobile-safari`: 43 passed / 44 skipped / **1 failed** — exactly the documented known
    pre-existing red (`mobile-bottom-bar.spec.ts:123` "Export action opens the shared export
    menu above the bar"; panel bottom ~37.5px under the bar top on WebKit). The task brief's
    extra look confirmed the shape is unchanged: the failing control is the mobile bottom
    bar's Export item, not the reordered topbar row.
- Final gates: `CI=true npm test -- --watch=false --coverage` — 60 files / **1329 passed**,
  thresholds green; `npm run lint` — all files pass.
- Commits: `refactor(entry-editor)` (in-field toolbar + relocated toggle, with its spec),
  then `feat(topbar)` (battery meter, dividers, About gating, corner token, with spec
  migrations + match-media stub), then `docs(next_tasks)` (plan + ledger). Pushed to origin.
- Merged 2026-09-27 after user testing and go-ahead: rebased onto `develop` @ `23ca52c`
  (the `docs(agents)` lesson-distillation commit landed mid-branch, no file overlap),
  fast-forward-merged as `ac784a1` (history stayed linear), origin updated; the rebased
  branch was force-with-lease synced to keep its ref identical to `develop`'s merged tip.
