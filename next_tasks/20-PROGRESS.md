# Task 20 — Progress Ledger

Branch: `feature/20-shift-range-selection` (off `develop` @ `b0eff6c`)
Plan: `next_tasks/20-shift-range-selection.md` (D1–D5 locked, user decision 2026-09-28)

---

## P0 — Orchestrator setup

- **Status**: ✅ done
- **Commit**: docs-only plan + ledger commit (this one).
- **Grounding re-check at branch-off**: audit section of the plan re-verified
  against `develop` @ `b0eff6c` — every file/line reference accurate, zero
  drift (`selection` @ `entry-list.ts:202`, `toggleRow` @ `:336`,
  `clearSelection` @ `:350`, project-switch effect @ `:117-126`, `filtered()`
  @ `:256`, row template `entry-list.html:161-247`, checkbox `:175-181`,
  `selectFirstTwoRows` @ `e2e/helpers.ts:214`).
- **Deviations**: none. D5 exempts this task from the screenshot baseline and
  the design checkpoint (feature reuses the existing checkbox affordance
  verbatim; any other pixel delta is a defect).
- **Next**: P1 — `ui-specialist` dispatch (D1–D4), commit
  `feat(entry-list): shift-click and long-press range selection for entries`.

---

## P1 — Range selection implementation (ui-specialist)

- **Status**: ✅ done — commit `de24635`
  `feat(entry-list): shift-click and long-press range selection for entries`
- **Landed files**: `entry-list.model.ts` (pure `applyRangeSelection`, missing
  endpoint → `current` by reference), `entry-list.ts` (private
  `selectionAnchor`, exported `LONG_PRESS_MS = 500`, slop 8px, gesture state,
  `applyRangeGesture` D1 path incl. degradation, pointer/contextmenu handlers,
  capture-phase click interceptor), `entry-list.html` (checkbox pointer +
  contextmenu bindings + `data-entry-id`; `(click)`/`(change)` lines
  byte-identical), `entry-list.scss` (`user-select`/`-webkit-touch-callout` on
  `.row-select`), `entry-list.spec.ts` (+12 specs), `entry-list.model.spec.ts`
  (+3 tests), `README.md` (+1 hint line).
- **Orchestrator gates** (re-run by orchestrator, not just the agent): build ✅
  (14.5 s) · unit+coverage ✅ (61 files / 1401 tests, exit 0 — thresholds
  in-run; `entry-list.ts` 93.4% stmts) · lint ✅.
- **Deviation (evidence-backed, accepted)**: D2's interception is a delegated
  **capture-phase** click listener on the component host, not a bubble-phase
  handler on the mat-checkbox host — Material v22's `MatCheckbox` flips state
  and emits `(change)` from the inner input's own target-phase click listener,
  so bubble `preventDefault()` is too late (verified in real Chromium,
  gitignored `__screenshots__/task20-probe/`). The D2 *contract* holds and is
  unit-pinned: shift+click applies D1 exactly once, `(change)` never fires,
  plain clicks stay on the native path end-to-end.
- **Known gap routed to P2** (watch item): the pending long-press **timer** is
  not cleared on `DestroyRef` (the click listener is). Harmless in practice —
  a post-destroy fire only writes signals nothing reads — but P2's watch list
  requires the cleanup; flagged to ts-reviewer with the exact expectation.
- **Next**: P2 — `ts-reviewer` typing/lint review of `de24635`.

---

## P2 — Typing/lint review (ts-reviewer)

- **Status**: ✅ done — commit `44a1d4d`
  `refactor(entry-list): clean up long-press state on destroy and tighten click-interceptor id parse`
  (`entry-list.ts` only, +14/−4)
- **Findings fixed**: (1) the P1-flagged gap — `destroyRef.onDestroy(() =>
  this.cancelLongPress())` now clears an armed long-press at destroy; (2)
  `interceptCheckboxClick` id parse tightened to one DOM query, `string | null`
  exactly — the dead `undefined` branch removed, the `''` guard kept and
  documented (`Number('') === 0` would alias an id-0 entry; fixtures use id 0).
- **Judgment recorded**: `suppressNextClick` needs no destroy cleanup (the
  capture listener is unregistered at destroy, and any new press clears it);
  documented at the state declaration.
- **Reviewed clean**: public surface unchanged (the eleven shell-driven
  members); model stays pure; `(change)`/`(click)` template lines verified
  byte-identical; specs typed without `any`/`as unknown as`; comments
  load-bearing only.
- **Orchestrator gates** (re-run post-commit): build ✅ · unit+coverage ✅
  (exit 0, thresholds in-run) · lint ✅.
- **Next**: P3 — `qa-auditor` authors `e2e/entry-list-selection.spec.ts` +
  desktop-chrome smokes.
