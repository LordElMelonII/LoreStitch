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
