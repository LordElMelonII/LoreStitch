# Task 20 — Entry list shift-click + long-press range selection (checkbox only)

**Status**: 🟢 In progress (branch `feature/20-shift-range-selection`)
**Source**: direct user request 2026-09-28 — preempts the pending queue (task 12
intake precedent).
**Grounded at**: `develop` @ `b0eff6c`, re-grounded 2026-09-28 before phase 1 —
every file/line reference below re-verified accurate at branch-off (no drift).

## Objective

Today, selecting a range of entries means clicking each row checkbox one by one.
Add range multi-selection to the entries drawer list — **shift+click and
long-press, BOTH on the row checkbox only** (user decision 2026-09-28; the row
body keeps its plain open behavior untouched).

## Grounding audit

- Selection state is component-local: `EntryList.selection` is a
  `signal<ReadonlySet<number>>` of entry ids (`src/app/features/entry-list/entry-list.ts:202`).
  Per-row toggles go through `toggleRow(item, checked)` (`entry-list.ts:336`); wholesale
  resets go through `clearSelection()` (`entry-list.ts:350`) and the project-switch effect
  (`entry-list.ts:117-126`, also resets `tagFilter`).
- Row template: `src/app/features/entry-list/entry-list.html:161-247`. The row is
  `role="button"` with `(click)="open(item)"` — this handler stays untouched by this
  task. The row checkbox is
  `<mat-checkbox class="row-select" [checked]="selection().has(item.id)"
  (change)="toggleRow(item, $event.checked)" (click)="$event.stopPropagation()"
  [attr.aria-label]="'Select ' + item.title">`. The checkbox has NO matTooltip (relevant
  to long-press: no tooltip fires on touch hold). Per-row duplicate/delete buttons
  already `stopPropagation`. Rows live in a `cdk-virtual-scroll-viewport` over
  `filtered()` with `trackById`; drag reorder is handle-only, so long-press on a row
  never starts a drag.
- `filtered()` (`entry-list.ts:256`) is the view-ordered list the user sees (text query
  debounced, tag chips immediate). The batch bar / tri-state select-all / count badge,
  and the mobile bottom bar's batch swap, are all derived from `selection()` — no
  toolbar or bar changes are needed for range selection.
- Existing pins that must stay green unchanged: unit specs in
  `src/app/features/entry-list/entry-list.spec.ts` (toggle on/off, select-all vs
  filtered, project-switch reset, batch actions); e2e contract in `e2e/helpers.ts:214`
  (`selectFirstTwoRows` — batch toolbar checkbox named
  "Select all shown entries (N selected)"); `.row-select` click flows in
  `e2e/mobile-bottom-bar.spec.ts` and `e2e/batch-and-tokens.spec.ts`.
- Touch e2e precedent: `e2e/nested-menu-touch.spec.ts` (`hasTouch` describes,
  project-gated skips, per-suite timeout allowances for cold WebKit boot). Playwright has
  no native long-press primitive — see P3 for the sanctioned synthesis routes.

## Locked design (decided with the user, 2026-09-28 — do not relitigate)

**D1 — Range semantics (Gmail/Explorer model).** Keep a private anchor
`signal<number | null>` = the last row checkbox toggled *without* a range gesture. A
range gesture on a row sets every entry in the inclusive `filtered()` slice between the
anchor and the gesture row (either direction) to the gesture row's *new* state: gesture
row currently unselected → select the whole range; currently selected → deselect the
whole range. The anchor does NOT move on a range gesture (gesture A→C then A→E covers
A→E). Degradation: no anchor, or anchor not present in the current `filtered()` view
(filtered out or deleted) → behave as a plain single toggle of the gesture row and set
the anchor to it. `clearSelection()` and the project-switch reset also null the anchor.
`toggleSelectAll` deliberately does not move the anchor. A "range gesture" is exactly one
of: shift+click (D2) or a completed long-press (D3) — both feed the same D1 path.

**D2 — Checkbox shift-click wiring.** Plain clicks must keep the native `(change)` path
byte-identical (existing pins). Shift-clicks are intercepted on the mat-checkbox host
`(click)`: `preventDefault()` (this cancels the label→input forwarding / input
activation, so `(change)` never fires and the box doesn't also natively toggle) + keep
the existing `stopPropagation()`, then apply D1. Verify no double-application in unit
AND e2e.

**D3 — Long-press on a checkbox = the touch range gesture.** On the row checkbox only
(NOT the row body): arm a timer on `pointerdown` with `pointerType` of `touch` or `pen`
(mouse never arms — desktop keeps D2 semantics); when it fires after
`LONG_PRESS_MS = 500` (export the constant for specs), apply D1 as a range gesture.
Cancellation: `pointerup`/`pointercancel` before the threshold (the virtual scroller
taking over the drag fires `pointercancel` — that is the scroll path, do not fight it),
and pointer movement beyond a small slop (~8px, finger drift). After a fired long-press,
the release still synthesizes a `click`: swallow it via the D2 click guard (flag +
`preventDefault()` + `stopPropagation()`) so the native toggle doesn't apply a second
time; clear the flag on the swallowed click or the next `pointerdown`. While a press is
armed or has fired, `preventDefault()` the checkbox's `contextmenu` (Android fires it on
long-press; guard by gesture state, never unconditionally, so desktop right-click is
unaffected). CSS guards on the existing `.row-select` host class in `entry-list.scss`:
`user-select: none` and `-webkit-touch-callout: none` (host-level class in our own
template — no `::ng-deep`). No haptics — feedback is the visible selection state plus
the mobile bottom bar's batch swap (already signal-driven). Typical flow this enables:
tap checkbox A (anchor), long-press checkbox C → A–C selected.

**D4 — Pure range helper.** The slice/set math lands as a pure function in
`src/app/features/entry-list/entry-list.model.ts` (bare module, beside `matchesQuery`),
e.g. `applyRangeSelection(current: ReadonlySet<number>, view: EntryListItem[],
fromId: number, toId: number, target: boolean): ReadonlySet<number>` — computed over the
filtered view order, never the DOM, so rows outside the rendered virtual window are
included. Unit-test it in `entry-list.model.spec.ts`; component behavior (anchor
lifecycle, both gesture wirings, long-press timer machinery) in `entry-list.spec.ts`
(fake timers per the house `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })`
convention; if the test env lacks `PointerEvent`, dispatch a spec-local Event/MouseEvent
subclass carrying `pointerType` — enough for the handler, which is what the unit specs
pin).

**D5 — Scope fence.** Non-goals: ctrl/cmd-click semantics, keyboard-only range
selection, row-body gestures of any kind (shift+click on the row body still opens the
entry; long-press on the row body does nothing special — long-pressing text rows
collides with the iOS magnifier and Android text-selection gestures anyway), haptics,
any copy/tooltip/aria changes, any batch-bar changes. No visual delta is intended
beyond the existing `.selected` row state: **skip the screenshot baseline and the design
checkpoint** — the feature reuses the existing checkbox affordance verbatim; if any
other pixel delta appears, treat it as a defect, not a baseline.

## Phases & gates

- **P0 — Orchestrator setup**: branch, this plan, `20-PROGRESS.md` ledger.
  Commit: `docs(next_tasks): plan task 20 shift range selection`.
- **P1 — ui-specialist** (`.zcode/agents/ui-specialist.md`): implement D1–D4
  (model helper + anchor + both gesture wirings + long-press machinery in
  `entry-list.ts` / `entry-list.html` / `entry-list.scss`; unit specs in
  `entry-list.model.spec.ts` and `entry-list.spec.ts`). The row body's
  `(click)="open(item)"` is not modified. Fast gate before commit: `npm run build`,
  `CI=true npm test -- --watch=false --coverage`, `npm run lint`. Commit:
  `feat(entry-list): shift-click and long-press range selection for entries`
  (includes the one-line entry-list README hint: both range gestures, checkbox only,
  their semantics).
- **P2 — ts-reviewer** (before qa-auditor, per pipeline order): strict-typing and lint
  review of the phase-1 diff; refactors land as `refactor(entry-list): ...` + fast gate
  re-run. Watch: anchor + gesture state private to `EntryList`; model helper stays pure
  (no signal/Angular imports); timer ids and gesture state cleaned up on `DestroyRef`;
  template handlers keep the house `$event` style.
- **P3 — qa-auditor**: author `e2e/entry-list-selection.spec.ts` (reuse
  `e2e/helpers.ts`; committed inputs from `e2e/fixtures/` only). Desktop describe
  (project-gated skip on mobile projects): range select + deselect, anchor semantics
  (A, shift-C, shift-E → A..E), shift+click on row body still opens the editor,
  filtered-view range. Mobile describe (`hasTouch`, project-gated skip on
  `desktop-chrome`, WebKit timeout allowance): long-press A→C selection, no-anchor
  degradation, release-click no double toggle. Long-press synthesis: CDP
  `Input.dispatchTouchEvent` on `mobile-chrome`; DOM `PointerEvent`s via `page.evaluate`
  on `mobile-safari`, falling back to a documented project skip (unit specs carry
  cross-engine gesture coverage). Per-task gate: build, unit+coverage, lint,
  `typecheck:e2e`, desktop-chrome smoke of touched specs. Commit:
  `test(e2e): pin shift-click and long-press range selection`.
- **Branch-final sweep (orchestrator)**: full three-project Playwright matrix per
  project + closing `npm test --coverage` + `npm run lint`. Red spec → fix-forward to
  the authoring phase, re-run failing project/spec, repeat the sweep. Push the branch,
  STOP for user testing — never self-merge to `develop`.

## Stop conditions

- Any change that would alter an existing pinned behavior (rather than extend it) is a
  human sign-off gate: post the old-vs-new contract with a minimal repro and wait.
- Two consecutive failed fix attempts on a gate → stop, escalate with the failing
  output.
- Check `git status --short` before every phase commit; unrelated local edits stay out
  of atomic commits. Conventional Commits throughout
  (`.zcode/agents/rules/conventional-commits.md`).
