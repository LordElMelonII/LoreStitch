# Task 10 Progress Ledger

Plan: [10-power-user-keyboard-shortcuts.md](./10-power-user-keyboard-shortcuts.md)
(rescoped 2026-10-01, re-grounded at `develop` @ `90bb582`; help dialog added
at `8fe8b80`).
Branch: `feature/10-keyboard-shortcuts-a11y` (off `develop` @ `90bb582`).

## Phase P1 — Pure resolver + help catalog (core-engine)

**Status**: ✅ complete — commit `c779b55` `feat(shortcuts): pure chord→action resolver`

**Landed**:
- `src/app/core/models/shortcut-map.ts` — bare framework-free module (zero
  imports, house shape per `st-trigger.ts`): `ShortcutAction` (12 actions),
  `ShortcutScope`, `ShortcutKeyEvent` (readonly), `resolveShortcut` (total,
  pure, ordered guard match — no class/registry/config), `ShortcutHelpEntry` +
  `SHORTCUTS_HELP` (one entry per action, §3.1 table order).
- `src/app/core/models/shortcut-map.spec.ts` — 38 tests: full §3.8 rows 1–2
  matrix (every §3.1 row × scope × platform, stray modifiers, isComposing,
  unknown chords, catalog completeness/groups/exact order).
- `src/app/core/models/README.md` — one entry line.

**Gates**: `npm run build` green · `CI=true npm test -- --watch=false` green
(65 files / 1523 tests; `shortcut-map.ts` 100/100/100/100) · `npm run lint`
green · `npm run typecheck:e2e` green.

**Bug caught by the spec, fixed in-phase**: first draft's exact-`Mod` block
swallowed `Ctrl+Space`; adjudicated before the Mod+letter block, list-scope
gated. All gates re-verified after.

**Decisions/deviations**:
1. nav chord display follows the §1.1 table (J = next), so `J / ↓` next and
   `K / ↑` prev (the dispatch brief's example had them flipped).
2. Catalog shows literal `Mod` (platform-aware rendering is the P2 dialog's
   concern; §3.8's e2e pin expects "Mod+S" verbatim).
3. `Ctrl+Space` is literal Ctrl on every platform (`Cmd+Space`/Spotlight
   stays unclaimed) — pinned by spec.
4. `?` allows Shift (only Mod/Alt are stray) — US layouts type it via Shift;
   pinned both ways.
5. Guard order is load-bearing: isComposing → Ctrl+Space → exact Mod+letter →
   text gate → Mod+Shift+D → Alt block → `?` → list-only chords.

**Next**: CHECKPOINT 10-1 (user) — §3.1 guard table, §3.3 auto-message +
snackbar copy, §3.5 confirm copy, §3.6 help-dialog design (SHORTCUTS_HELP
verbatim above + grouping + exemplar), §3.7 focus-ring/skip-link evidence.
Pipeline holds until the explicit answer.

## Checkpoint 10-1 — user gate

**Status**: ✅ approved 2026-10-01 (explicit answers via structured prompt)

- **Contract approved as posted**: §3.1 guard table + universal guards, §3.3
  copy (auto-message `Snapshot · <local yyyy-mm-dd hh:mm>`, "Nothing to
  commit.", `Committed <short-hash>.`, "Open an entry first."), §3.5 confirm
  copy, §3.6 help-dialog design, §3.7 focus-ring/skip-link design.
- **Help chord**: `?` only — the `Mod+/` alias is declined.
- **Delete copy**: user asked for the recommendation; proceeding with the
  plan's "This cannot be undone." (conservative warning, true in the worst
  case — a never-committed entry is unrecoverable; the batch-delete wording
  is the optimistic one of the two).
- **`aria-keyshortcuts`**: ADD (user decision) — mirrored controls only:
  filter input `Control+F`, both "New entry" buttons `Control+N`, topbar
  "Keyboard shortcuts" item `?`. ARIA-style literals, not the catalog's
  display `Mod` (the catalog stays single-source in the dialog).

**Next**: P2 — ui-specialist: BEFORE screenshots, shortcut service + app
dispatch, entry-list roving tabindex + bubbling fix + nav/move chords,
focusNameField + name aria-label, shortcuts help dialog + topbar entry +
annotations (§3.2–3.4, §3.6).

## Phase P2 — Shortcut wiring + help dialog (ui-specialist)

**Status**: ✅ complete — commit `8db5297` `feat(shortcuts): global shortcut service and keyboard entry navigation` (18 files, +1465/−23; tree clean)

**Landed**:
- BEFORE screenshots (9) under `__screenshots__/10/before/` — pinned
  conditions (3 viewports, light theme, seeded Fate fixture via real import,
  settled render, tooltips suppressed); parameterized
  `__screenshots__/10/capture.mjs` for P3's AFTER pass; import-button label
  re-probed (drifted from the linter precedent).
- `shared/services/keyboard-shortcuts.service.ts` (+174) + spec (+199) — one
  DOCUMENT keydown listener, overlay gate → scope classification → platform →
  `resolveShortcut`, preventDefault only on non-null, `DestroyRef` teardown;
  `register(fn)` two-arg `(action, scope)` shape (sanctioned deviation).
- `app.ts` `runShortcutAction` exhaustive never-switch (+152) — checkpoint
  copy verbatim (auto-message, "Nothing to commit.", `Committed <short>.`,
  "Open an entry first."); `show-help` → `openResponsive(ShortcutsDialog)`.
- Entry list (+260/−23): roving tabindex + `aria-current` + `data-entry-id`,
  `onRowKeydown` bubbling guard, `:focus-visible` ring (M3, resize-handle
  approach), `navigate`/`moveActive` (with `treeIndices` extracted from
  `drop()`)/`toggleFocusedSelection`/`extendSelection` over the task-20
  anchor model, `focusFilter`, `scrollToEntry` made reusable.
- `EntryEditor.focusNameField()` (`.mat-mdc-tab-body-active`-scoped,
  `afterRenderEffect`-deferred); `entry-name` `aria-label="Entry name"`.
- `shared/components/shortcuts-dialog/` — renders `SHORTCUTS_HELP` grouped
  Everywhere / In the entry list, kbd chips, opened only via
  ResponsiveOverlayService; topbar "Keyboard shortcuts…" item (cluster
  ellipsis convention) + `aria-keyshortcuts="?"`; annotations: filter
  `Control+F`, both New-entry buttons `Control+N`.
- Icon: NEW `keyboard` ligature; `icons:refresh` re-subset (69 icons),
  woff2 staged in-commit.

**Gates**: build green (after 3 in-phase type fixes) · full suite
**1545/1545** (66 files) · lint green · typecheck:e2e green · smoke
`entry-list-selection` desktop-chrome 5P/2S (+ insurance `topbar about`
6P/2S).

**Probe findings pinned by specs**: scope table verified in rendered
Chromium DOM (row ⇒ list; checkbox ⇒ list-not-text; filter ⇒ text;
mat-select HOST `mat-select[role=combobox]` ⇒ other — `closest('.mat-mdc-select')`,
not the trigger div); TestBed mounts under bare DIV — service spec nests a
real `<app-entry-list>` wrapper.

**Deviations** (evidence-backed):
1. Suffixed `(keydown.enter)` bindings don't fire on dispatched
   KeyboardEvents in vitest/jsdom (probe-verified; DO fire in Chromium) —
   row-activation spec drives `onRowKeydown` directly (`entry-keys`
   precedent); real wiring pinned by P5 e2e.
2. `scrollToEntry` jsdom guard (`Element.scrollTo` absent) via the file's
   existing "skip exotic environments" idiom.
3. `onRowKeydown($event: Event)` — strict-template typing of suffixed
   handlers.

**Note for P5**: `commit-snapshot` commits committed bytes only (no
draft-flush API exists) — type-then-commit e2e waits out
`EDIT_COMMIT_FLUSH_MS` (house precedent).

**Next**: P3 — ui-specialist: §3.5 (restore/delete ConfirmDialogs, remaining
`:focus-visible` coverage incl. bar-item ring upgrade, skip link, pane
labels + `aria-expanded`, sr-only h1) + one-shot DevTools a11y audit +
AFTER screenshots + side-by-side report.

## Phase P3 — A11y mechanics + audit + AFTER screenshots (ui-specialist)

**Status**: ✅ complete — commit `89d3a12` `feat(a11y): keyboard selection, focus baseline, and destructive-action confirmations` (18 files, +462/−22)

**Landed**:
- `ConfirmDialog` made dual-container (the Batch/Shortcuts twin idiom:
  optional `MatDialogRef`/`MatBottomSheetRef` + `MAT_DIALOG_DATA ??
  MAT_BOTTOM_SHEET_DATA`); backward compatible.
- `commit-history.restore()` through `openResponsive` — "Restore this
  state?" / locked message / "Restore" (danger); rollback only on accept.
- `entry-list.delete()` ditto — "Delete entry" / `Delete "<name>"? This
  cannot be undone.` / "Delete" (danger).
- Skip link ("Skip to editor", first tabbable, hidden-until-`:focus`,
  token-styled) + `#editor-content` `tabindex="-1"` target; pane
  `id`/`aria-label` + `role="complementary"`; sr-only `h1` = project title;
  topbar `role="banner"` + `entriesOpened`/`historyOpened` inputs +
  `aria-expanded`/`aria-controls` on both toggles; mobile bar items'
  state-layer hint → real 2px `:focus-visible` ring; `.sr-only` utility +
  `.app-confirm-sheet` recipe in `styles.scss`.

**Gates**: build green · full suite **1552/1552** · lint green ·
typecheck:e2e green · desktop-chrome smoke `entry-list-selection
batch-and-tokens session-lock` 14P/2S (phone-pinned skips by design).

**Discovery**: NO existing e2e spec clicks row-delete or history-Restore
(grep-verified) — P5's "migrate instant delete/restore pins" list is EMPTY;
P5 writes those pins fresh.

**One-shot DevTools-style a11y audit** (CDP `Accessibility.getFullAXTree` +
contrast checks over 8 real-app states; script kept at
`__screenshots__/10/audit.mjs`): fixed in-task — (1) pane aria-labels were
inert on role-less drawers → `role="complementary"` added; (2) row-select
checkboxes unnamed (host attr never reached MatCheckbox's inner input →
`[aria-label]` input); (3) `.token-count` contrast 3.46–4.05:1 →
`--mat-sys-on-surface-variant`; (4) h1→h3 heading skip → drawer titles h2.
Material-internal, recorded no-action: MatCheckbox `aria-expanded=""` on its
own inputs; CDK focus-trap aria-hides background landmarks while dialogs
open (correct modal semantics); mat-tab/mat-select internal wiring.

**AFTER screenshots**: 21 PNGs under `__screenshots__/10/after/` — identical
pinned conditions to BEFORE + new states 04–07 (skip link focused, delete
confirm dialog + phone sheet, restore confirm, shortcuts help desktop
dialog + phone sheet). Side-by-side posted to the user with the task report.

**Deviations**:
1. Curly quotes in delete copy (house idiom for embedded titles; severity
   wording untouched).
2. Batch delete still opens via plain `MatDialog` (it was never on
   openResponsive — plan grounding said otherwise); migrating it is
   unrequested scope, flagged for a later pass. Single delete + restore now
   set the dual-container pattern.
3. Skip-link first-Tab capture/e2e needs a pointer-free reload (Chromium
   resumes sequential focus from the last pointer position) — documented in
   `capture.mjs` state 04, relevant to P5.
4. Visual reveal of the skip link is proven by screenshots + real-Tab
   capture (jsdom has no layout engine); unit pins cover order + focus jump.

**Next**: P4 — ts-reviewer typing/lint review of everything touched
(c779b55, 8db5297, 89d3a12 diffs).

## Phase P4 — Typing/lint review (ts-reviewer)

**Status**: ✅ CLEAN — no fixes needed, no commit (review range
`8fe8b80..HEAD`, ~2,632 added lines)

Verdicts: exhaustive 12-action `never`-switch PASS (`app.ts:876-961`, +
SHORTCUTS_HELP completeness backstop) · listener teardown PASS (single
DOCUMENT listener, stable field identity, `DestroyRef`, spec-pinned via
`TestBed.resetTestingModule`) · signal purity PASS (list methods are plain
methods; Mod+N focus handoff = private pending signal +
`afterRenderEffect` on `tabs()`; topbar opened-inputs are `input(false)`
bound from existing shell signals, zero duplication) · scope-predicate
typing PASS (instanceof-only narrowing, typed optional `userAgentData`
view, jsdom default `'other'`) · strictness PASS (no `!` assertions, explicit
returns, dual-token ConfirmDialog = third house twin, `treeIndices`
behavior-identical to the old inline translation) · ESLint PASS.

Gates re-run: lint green · full suite 1552/1552 · build green (both new
dialogs lazy chunks) · typecheck:e2e green.

Residual notes (no failure mode): redundant `event.ctrlKey` in one resolver
guard documents intent; `ShortcutsDialog.groups` computed-over-constant;
`focusRow`/`scrollToEntry` bare `setTimeout`s verified no-op post-destroy;
jsdom suffixed-keydown limitation means row activation is unit-pinned via
direct `onRowKeydown` calls — P5 e2e is the real pin.

**Next**: P5 — qa-auditor: `e2e/keyboard-shortcuts.spec.ts` +
`e2e/keyboard-navigation.spec.ts` (§3.8, incl. help-dialog cases), fresh
delete/restore confirm pins (migration list empty), fast gate, smoke on
desktop-chrome + one mobile project.

## Phase P5 — E2E coverage (qa-auditor)

**Status**: ✅ complete — commit `73f241b` `test(e2e): keyboard shortcuts and navigation coverage` (2 spec files + helpers, 25 tests: 22 desktop + 3 phone-pinned)

**`e2e/keyboard-shortcuts.spec.ts`** (17): global chords (Mod+S dirty/clean,
Mod+N active-tab-body focus `toBeFocused`, Mod+F, Alt+↓ focus-untouched,
J/K roving, Alt+Shift+↓ reorder + reload persistence, Mod+Shift+D both ways,
filter no-hijack `jk` + `?`) · help dialog (?/topbar/Escape/inert-while-open,
exact-`kbd` Mod+S + ? pins) · delete confirm (exact copy, cancel/accept) ·
restore confirm (cancel keeps dirty, accept rolls back) · phone: bottom-sheet
confirm `.app-confirm-sheet`, chords inert, bar covers actions.

**`e2e/keyboard-navigation.spec.ts`** (8): skip link first-Tab (pointer-free
reload recipe) + Enter jump to `#editor-content` · roving contract (ONE
row-level stop, `aria-current` iff tabbable, bounded 15-stop forward window)
· 22 paced arrow/J/K steps past the rendered window (scrollTop + window
first-row polls) · Ctrl+Space/Shift+↓ range + batch Disable applies · Space
on checkbox toggles WITHOUT opening (bubbling-fix pin) + Enter on row opens ·
Escape closes confirm + help.

Helpers added to `e2e/helpers.ts` (`FIRST_ROW_TITLE`, `focusBody`,
`entryRowTitle`, `focusedTarget`) — no duplication.

**Gates**: typecheck:e2e green ×2 · build green · full unit suite 1552/1552 ·
lint green ×2 · desktop-chrome scoped run 22P/3S (1.2 m) · mobile-chrome
3P/22S (13 s) · proactive mobile-safari 3P/22S (19 s).

**Stabilizations (probe-verified, scripts in `__screenshots__/10/`)**:
fixture renders in `order` (row 0 = "The Greater Holy Grail…", not first
JSON key) ⇒ `FIRST_ROW_TITLE` + dynamic reads; Escape-vs-CDK-focus-trap race
⇒ assert in-pane focus before Escape-on-dialog (3/3 repro before fix);
forward tab walk unbounded by design (virtual scroll renders ahead) ⇒
bounded 15-stop window; batch toolbar unmounts at zero selection ⇒
`toHaveCount(0)`; strict-mode `exact: true` on the Commit button. One fixed
`SAVE_FLUSH_MS = 700` window before reorder-reload (debounced IndexedDB
save, `EDIT_COMMIT_FLUSH_MS` precedent).

**Next**: branch-final sweep — three-project Playwright matrix per project +
closing `npm test --coverage` + `npm run lint`, then push + stop.

## Branch-final sweep + push (orchestrator)

**Status**: ✅ sweep green at `73f241b`; branch pushed; STOPPED (no merge —
user tests first)

Sweep results (one project at a time, then closing unit+lint):
- `npx playwright test --project=desktop-chrome`: **113 passed / 23
  skipped** (5.1 m) — green.
- `npx playwright test --project=mobile-chrome`: **57 passed / 79 skipped**
  (3.4 m) — green.
- `npx playwright test --project=mobile-safari`: **55 passed / 81 skipped**
  (4.9 m) — green. (Large skip counts by design — phone-pinned tests skip on
  desktop and vice versa.)
- `CI=true npm test -- --watch=false --coverage`: exit 0 — 66 files,
  **1552/1552**; global coverage 95.66 / 90.13 / 91.68 / 96.54
  (stmts/branches/funcs/lines vs 80/75/80/80 floors).
- `npm run lint`: green ("All files pass linting").

**Branch history** (linear, off `develop` @ `90bb582`):
- `8fe8b80` docs(next_tasks): task 10 adds the shortcuts help dialog (pre-task)
- `c779b55` feat(shortcuts): pure chord→action resolver (P1)
- `4572abd` docs(next_tasks): task 10 phase P1 progress
- `f64eca9` docs(next_tasks): task 10 checkpoint 10-1 approved
- `8db5297` feat(shortcuts): global shortcut service and keyboard entry navigation (P2)
- `3253e10` docs(next_tasks): task 10 phase P2 progress
- `89d3a12` feat(a11y): keyboard selection, focus baseline, and destructive-action confirmations (P3)
- `c8ad1d1` docs(next_tasks): task 10 phase P3 progress
- `f100d60` docs(next_tasks): task 10 phase P4 progress (review clean, no fix commit)
- `73f241b` test(e2e): keyboard shortcuts and navigation coverage (P5)
- `b72114d` docs(next_tasks): task 10 phase P5 progress
- final docs commit: sweep entry + plan/README status sync (this commit)

**Visual baseline** (gitignored): `__screenshots__/10/before/` (9 PNGs,
pre-task) vs `__screenshots__/10/after/` (21 PNGs, post-P3) — identical
pinned conditions; side-by-side posted with the task report. Capture +
audit scripts kept at `__screenshots__/10/{capture,audit}.mjs`.

**Next**: USER gate — manual test of the pushed branch; `git merge --ff-only`
into `develop` only on the explicit go (then the archival batch pass moves
this plan + ledger + task 11's documents into `archive/`).

## Manual-test fix-forward (orchestrator + ui-specialist)

**Status**: ✅ complete — commit `36764e4` `fix(shortcuts): keyboard range selection shrinks per step and scrolls only at the window edge` (3 files, +169/−24)

The user's manual test reported two bugs; both diagnosed at root cause in the
P2 code before dispatch:

1. **Shift+↑ after extending down collapsed the range** ("many rows get
   deselected"): `extendSelection` reused the mouse shift+click gesture
   (`applyRangeGesture`), which inverts the gesture row's state and paints it
   over the whole anchor..cursor slice — one step back painted deselect over
   the entire range. The unit spec at `entry-list.spec.ts:1149` had pinned
   the collapse. Fix: native listbox semantics — two transient fields
   (`selectionPaint`, `gestureBase`, non-signal like `selectionCursor`);
   first extension of a gesture snapshots the selection and takes the
   anchor's state as paint; every extension repaints the anchor..cursor
   slice from the base via the same `applyRangeSelection` math; anchor never
   moves. Gesture resets in `toggleRow`/`clearSelection`/`applyRangeGesture`
   (mouse ends the keyboard gesture). Mouse shift+click untouched.
2. **Auto-scroll lurch on held Shift+arrow**: `scrollToEntry` called
   `viewport.scrollToIndex(index, 'smooth')` unconditionally — CDK aligns the
   target to the viewport TOP, so every step smooth-scrolled even when the
   row was visible; key auto-repeat piled queued scrolls. Fix in the shared
   function: scroll only when the target is outside
   `viewport.getRenderedRange()` (deferral + jsdom try/catch kept).

Specs: rewritten keyboard-extension truth table (shrink-by-one regression
pin, re-grow, upward growth across the anchor, deselect gesture; mouse
parity block unchanged) + new `scrollToEntry` rendered-range guard test +
new e2e case (extend down 3, up 2 → count drops one per press). Failing-first
verified (pre-fix run failed exactly on the two pins).

Gates: build green · full unit suite **1553/1553** · lint green ·
typecheck:e2e green · `keyboard-navigation` desktop-chrome 9P · insurance
`keyboard-shortcuts` desktop-chrome 14P/3S (orchestrator, rides the changed
scroll path).

Deviations (minor): Bug-2 test flushes the deferral via the file's
`advanceTimersByTimeAsync` idiom (the file runs fake timers — a bare
macrotask await would hang); upward-growth block sits last in the rewritten
test (`createList` reassigns the shared fixture).

**Next**: USER gate (resumed) — re-test the two fixed interactions; on the
explicit go, `git merge --ff-only` into `develop`.

## Manual-test fix-forward round 2 (orchestrator, probe-verified)

**Status**: ✅ complete — commit `de31fa4` `fix(shortcuts): keyboard selection cursor follows every row touch` (3 files, +126/−15)

The user re-tested and reported the behavior still unpredictable across
three variants (row-body click vs checkbox click before Shift+↓), plus the
mid-turn ask: verify every variant in a real browser, incl. shift+click on
row/checkbox and arrows with shift held. The orchestrator drove a temporary
7-variant Playwright probe against the real app (e2e harness, Fate fixture,
fresh page per variant, selection state read from the rendered DOM) —
deleted after verification, evidence below.

**Probe findings (before the fix)**:
- V4 isolated the root cause: a keyboard extension parks `selectionCursor`,
  a later MOUSE checkbox toggle moves the anchor but not the cursor, and the
  next Shift+↓ then extended from the STALE cursor (7 rows swept instead of
  5). The user's variants 2–3 extra rows were accumulated stale state across
  attempts, not fresh-state behavior.
- V1 (row-body click then Shift+↓) swept from the OLD anchor (6–7 rows):
  activation moved neither cursor nor anchor.

**Fix (all in `entry-list.ts`, the "last touched row" model)**:
- `toggleRow`, `applyRangeGesture`, `open`, `navigate` now all update
  `selectionCursor` — it can never go stale (round-1 reset only the
  paint/base).
- Row ACTIVATION (`open`, row click / Enter) also moves the range anchor —
  native click semantics; activation still never selects.
- New `anchorPaint` field: the gesture paint is fixed at anchor placement
  (toggle → its checked state; activation → SELECT), replacing the
  `base.has(anchor)` read — deriving from the anchor's selection bit made
  Shift+↓ after a plain open select nothing (caught by probe iteration,
  fixed before landing).

**Post-fix probe (all variants, real browser)**: user's three scenarios ALL
converge on {anchor-retained rows + clicked row + its neighbor} (3 rows in
the probe geometry); shift+click on a row BODY opens without selecting
(task-20 by design); shift+click on a CHECKBOX sweeps and Shift+arrows
continue/shrink one row per press; no-anchor keyboard-only start degrades to
per-row toggles; arrows (J/K/Alt) move the cursor but never the anchor.

**Pins**: new unit test (cursor after mouse toggle — the V4 discriminator
{0,1,3,4} not {0,1,2,3}; activation re-anchor + select-paint; shift+click
parks the cursor; navigate moves cursor, never anchor) + new e2e case
(mouse toggle re-anchors the next Shift+ArrowDown). Round-1 truth table and
all task-20 mouse pins untouched and green.

**Gates**: build green · full unit suite **1554/1554** · lint green ·
typecheck:e2e green · `keyboard-navigation keyboard-shortcuts`
desktop-chrome **24 passed** ×2 consecutive runs.

**Flake note**: one cold combined run red on the pre-existing "chords are
inert" Escape pin (pane stayed open); it passes isolated and in two
consecutive combined runs after warm-up — same Escape-vs-focus-trap race
class P5 documented, not touched by this diff. Unreproduced since; left
unpatched rather than fix speculatively.

**Next**: USER gate (resumed) — re-test the selection variants; on the
explicit go, `git merge --ff-only` into `develop`.

## Manual-test fix-forward round 3 (orchestrator, probe-verified)

**Status**: ✅ complete — commit `9af9bc5` `fix(editor): only the active tab's close button is a Tab stop in a paginated strip` (3 files, +79)

The user asked how Tab traversal works between editor and sidenavs, and
reported: with many tabs open, tabbing reached the close buttons of
OFF-SCREEN tabs (tooltip visible, row clipped away) and never a tab label —
"cannot select a tab, only close it".

**Probed** (temporary e2e harness, deleted after): with a paginated
7-tab header, focus walked via Tab/Shift+Tab in both directions + Arrow/Enter
on tab labels. Findings: Material keeps only the SELECTED tab label as a Tab
stop (ArrowRight moves focus, Enter activates — verified), but every tab's
close button was `tabindex` 0 — the backward walk through the strip ran
close-button, close-button… including tabs translated left of the viewport,
and labels of non-selected tabs were never stops.

**Fix (one line + pins)**: the close button's `tabindex` binds to
`tab.id === workspace.activeTabId()` — the strip's single close stop rides
the active tab, which Material always scrolls into view, so no off-screen
close button can ever take focus. Tab activation (arrows + Enter on the
label) is native Material behavior, verified unchanged.

**Pins**: new `entry-editor.spec` test (non-active close −1 / active 0, and
it follows `activeTabId`) + new e2e case in `keyboard-navigation.spec`
(the paginated-strip traversal: Shift+Tab ×4 backward + forward stop never
lands on a non-active close; the stop after the label is the active tab's
own close).

**Gates**: build green · full unit suite **1555/1555** · lint green ·
typecheck:e2e green · `keyboard-navigation keyboard-shortcuts`
desktop-chrome **25 passed**.

**Traverse question answered with probe data**: Tab moves linearly across
every region — skip link → topbar → entries drawer (filter, roving active
row + inner controls) → tab strip (active label, active close) → name
input → content textarea → delimiters/focus buttons → enabled switch →
type rate radios → options toggle → history commit field → bottom bar;
Shift+Tab walks back over the same path, so editor ⇄ side panels traverse
freely.

**Next**: USER gate (resumed) — on the explicit go, `git merge --ff-only`
into `develop`.

## Manual-test fix-forward round 4 (orchestrator)

**Status**: ✅ complete — commit `93885d3` `fix(editor): only the active row's inner controls are Tab stops in the entry list` (3 files, +55/−13)

User report: tabbing out of the entry list toured every rendered row's
duplicate/delete buttons (hover-revealed affordances with residual tab
stops) before reaching the editor. Fix: the same roving principle as the
row stops — only the ACTIVE row's checkbox/Duplicate/Delete are Tab stops;
every non-active row's inner controls leave Tab order. MatCheckbox's
`[tabIndex]` input (null keeps the active row's native 0; −1 for the rest)
+ `[tabindex]` on the ghosts — note the binding is the DIRECTIVE input
(`matIconButton` owns `tabindex`, host-bound to `_getTabIndex()`); an
`[attr.tabindex]` binding is silently overridden (unit spec caught it).
Keyboard routes preserved: selection via roving focus + Ctrl+Space; a
non-active row's delete = activate the row (arrows/Enter), then Tab to its
now-stoppable delete.

Updated the roving e2e's forward-exit contract (stops = the active row's
three controls, then past the rows) + new unit pin (3×3 tabIndex matrix).

**Gates**: full unit suite **1556/1556** · lint green · build green ·
typecheck:e2e green · `keyboard-navigation keyboard-shortcuts`
desktop-chrome **25 passed**.

**Next**: USER gate (resumed) — on the explicit go, `git merge --ff-only`
into `develop`.
