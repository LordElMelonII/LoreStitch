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
