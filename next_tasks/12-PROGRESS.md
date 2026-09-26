# Task 12 — Progress Ledger

Branch: `feature/12-delimiters-selection-and-markdown` (off `develop` @ `5b4544a`)
Plan: `next_tasks/12-delimiters-selection-and-markdown.md` (D1–D10 locked)

---

## P0 — Before-set screenshots (orchestrator)

- **Status**: ✅ done
- **Commit**: docs-only ledger commit (screenshots live under gitignored
  `__screenshots__/12/before/`; capture script `__screenshots__/12/capture.mjs`,
  same pinned-conditions protocol as the `__screenshots__/linter/capture.mjs`
  precedent — chromium, LIGHT theme seeded pre-boot, Fate fixture through the
  real welcome-screen import path, settled rendering, deviceScaleFactor 1,
  locale en-US / timezone UTC).
- **Shots** (6):
  - `desktop-1280x800-01-delimiters-dialog.png` — centered
    `app-compact-fullscreen-dialog` pane, editor-opened
  - `desktop-1280x800-02-batch-toolbar.png` — docked sidenav, 2 rows checked,
    batch toolbar visible
  - `tablet-1024x768-01-delimiters-dialog.png`
  - `tablet-1024x768-02-batch-toolbar.png`
  - `mobile-390x844-01-delimiters-dialog.png` — the full-screen fallback P2
    replaces with the bottom sheet
  - `mobile-390x844-02-bottom-bar-batch.png` — bottom bar `batch` swap,
    2 selected
- **Deviations**: capture script fixes during P0 only (no app code touched):
  the welcome-screen import row reads "Import lorebook or character card"
  since task 15 (the linter capture's "Import .json / .stproj" name was
  stale); the desktop editor is a docked pane, so the batch-toolbar shot
  keeps it open (natural user state) instead of force-closing it.
- **Next**: P1 — `core-engine` dispatch (plan §4), commit
  `feat(delimiters): add markdown wrapper style with name-matched detection`.

---

## P1 — Core: markdown wrapper style (core-engine)

- **Status**: ✅ done — commit `2f1e7cd`
  `feat(delimiters): add markdown wrapper style with name-matched detection`
- **Landed files**: `src/app/core/models/delimiters.ts` (style + options +
  detection order tag→bracket→markdown→separator + name-matched strip +
  separator fallback + `empty-header`/`no-space-header` malformed kinds),
  `src/app/core/models/delimiters.spec.ts` (Tier-1 matrix, ~80 new cases),
  `src/app/features/delimiters/delimiter-dialog.ts` (minimal compile fix
  only: two exhaustive `MalformedWrapper.kind` switches gained the new kinds;
  no UI behavior/copy/coverage change — P2 still owns the dialog).
- **Orchestrator gates**: lint ✅ · build ✅ · `CI=true npm test --watch=false`
  ✅ (60 files / 1310 tests; coverage thresholds enforced in-run).
- **Migrated pins**: style-options list gained `markdown`; no literal task-01
  "markdown is payload" pins existed (deferral was behavioral) — new
  classification pins carry the migration comment.
- **Deviations (reported by agent, accepted)**: bare-marker guard in markdown
  wrap (fixed-point requirement); rewrap post-strips unwrapped inner for
  markdown targets; `no-space-header` requires non-`#` char (`^#{1,6}[^#\s]`);
  `empty-header.level` typed 1–6 literal; legacy no-names markdown unwrap
  strips detected header (rewrap convergence; D7 gate governs the
  `expectedNames` path the dialog uses).
- **Next**: Checkpoint 12-1 (blocking, user) → P2 `ui-specialist`.

---

## Checkpoint 12-1 — ✅ APPROVED by user

The two §4.4 detection-order effects (badge `---`→`## Name`;
`# Header` payload→wrapper) accepted with the minimal repros. P2 unlocked.

---

## P2 — UI: responsive pane + selection + markdown controls (ui-specialist)

- **Status**: ✅ done — commit (a) `3f63014`
  `feat(delimiters): apply to the checked selection via the batch toolbar`;
  commit (b) `c8fe23a` `feat(delimiters): markdown style controls in the pane`
- **Landed (a)**: dual-container `DelimiterDialog` (optional dialog/sheet refs +
  both DATA tokens, `close()` routes to whichever ref); `app-delimiters-sheet`
  added to styles.scss on the `app-batch-sheet` recipe; `DelimiterDialogData`
  gained `entryIds?`; selection mode (locked targets, "Delimiters — N entries"
  header, no Apply-to select, no hint); `EntryList.openDelimiters()` mirroring
  `openBatchOperations` (guard → openResponsive → paneResult → clearSelection
  on applied); desktop toolbar labeled `code` button "Apply delimiters to
  selection" after Batch edit; mobile strip gained labeled Delimiters button
  (`'delimiters-selection'` in `BatchBarAction`, routed in `app.ts`).
- **Landed (b)**: markdown level select (`# — H1`…`###### — H6`, default `##`),
  "Add trailing ---" checkbox (default off), live example card, options through
  preview+apply (preview-is-what-is-written), chips `empty header` /
  `missing space` + banner + repair; hint copy = plan's, verbatim.
- **Orchestrator gates**: lint ✅ · build ✅ · unit ✅ (60 files / 1323 tests).
- **Deviations (reported, for 12-2 review)**: pane self-paints
  `.pane-header/.pane-body/.pane-footer` (BatchOperationsDialog recipe) instead
  of `mat-dialog-*` sections; `.batch-bar .bar-item` flex-basis changed
  `1 1 0`→`1 1 auto` (measurement-mandated: equal flex ellipsized labels once
  the 6th item landed; re-measured zero ellipsized at 2 and 70 selected);
  labeled mobile Delimiters button FITS at 390px (no §9.6 icon-only fallback).
- **Pin migrations (unit)**: mobile-bottom-bar strip counts 5→6, app.spec
  routing walks ten members, delimiter-dialog spec dual-token providers +
  `.pane-footer` selectors, entry-content-field opener spy → openResponsive.
- **Known red until P4**: `e2e/delimiters.spec.ts` 390×844 suite still pins the
  full-screen dialog on mobile projects (migrates in P4 per plan §6).
- **Next**: after-set capture + checkpoint 12-2 (blocking) → P3 `ts-reviewer`.

---

## After-set capture (orchestrator, checkpoint 12-2 evidence)

- **Status**: ✅ done — `__screenshots__/12/after/` (12 shots: the 6 base
  targets re-captured by the IDENTICAL script + 6 after-only new-feature
  shots) and `__screenshots__/12/compare/` (4 before|after composites).
- **After-only shots**: desktop/tablet `03-delimiters-selection-pane`
  (locked "Delimiters — 2 entries", per-entry naming), desktop/tablet
  `04-markdown-controls` (level select + toggle + live format card + diff),
  mobile `03-delimiters-selection-sheet`, mobile `04-delimiters-markdown-sheet`.
- **Capture-hygiene deviations (logged)**: Material hover tooltips raced the
  pointer during select-overlay picks and stuck visible mid-animation,
  photobombing the markdown shots; the after set suppresses
  `.mat-mdc-tooltip-panel` capture-side (transient UI, not part of the
  settled pane; before set showed none). Also: post-markdown dismissal uses
  the pane's own close button (Escape is flaky right after a select-overlay
  pick — linter-capture precedent), and the mobile markdown flow re-parks the
  editor before releasing the drawer (addEntryOnPhone choreography). No pinned
  condition (viewport/theme/fixture/settle) changed.

---

## Checkpoint 12-2 — ✅ APPROVED by user

Composites, new-feature shots, exemplar reuse and the three deviations
(self-painted pane sections, batch-strip flex fix, labeled mobile button)
accepted. P3/P4 unlocked.

---

## P3 — Review: strict typing (ts-reviewer)

- **Status**: ✅ done — commit `bd90d54`
  `refactor(delimiters): tighten typing across the markdown and selection surfaces`
- **Changed** (2 files): `unwrapContent` + `delimiterLabel` (`delimiters.ts`)
  and the dialog `example` computed: `default:` → explicit `case 'none':` so a
  future `DelimiterStyle` member is a compile error, not a silent fallthrough.
  Zero behavior change.
- **Verified clean**: all `MalformedWrapper.kind` consumers exhaustive;
  `DelimiterDialogData` use sites honest; no new `any`/assertions; signals-only
  state; return types present; no `$any` in touched templates.
- **Flagged, not changed** (reviewer's judgment, accepted): dual DATA-token
  casts byte-identical to the BatchOperationsDialog twin (shared-pattern
  follow-up, not a drive-by); `as unknown as` mock-call idiom in new specs
  (house idiom); pre-existing `entry.id ?? -1` sentinel.
- **Orchestrator gates**: lint ✅ · build ✅ · unit ✅ (60 files / 1323 tests).
- **Next**: P4 `qa-auditor` (Tier-3 e2e + branch-final sweep).

## P4 — QA: Tier-3 e2e + branch-final sweep (qa-auditor)

- **Status**: ✅ done — commit `2dfd98f`
  `test(e2e): selection flow, markdown survival, and mobile sheet suite`
- **Changed** (4 files): `e2e/delimiters.spec.ts` (5 new desktop tests; the
  390×844 describe migrated off the retired `.app-compact-fullscreen-dialog`
  pin onto the `app-delimiters-sheet` 88dvh contract; a new phone-pinned
  bottom-bar batch-strip suite), `e2e/helpers.ts` (parameterized
  `openEntryRow` — `openFirstEntry` delegates at index 0 — plus an
  active-tab-scoped `readEntryContent`), and two pin migrations the sweep
  caught: `e2e/ui-responsiveness.spec.ts` (delimiters phone leg → sheet
  contract) and `e2e/mobile-bottom-bar.spec.ts` (swapped-strip items 5 → 6,
  Task 12's Delimiters item).
- **Tier-3 coverage added** (`delimiters.spec.ts`): desktop — selection apply
  from the batch toolbar (locked pane, per-entry wrappers, selection cleared),
  markdown idempotency + level normalization + trailing-`---` toggle,
  markdown export → re-import byte survival, empty-`##` header repair
  (byte-identical payload), glue-typed `#Name` header hint-gating + repair;
  phone — 88dvh sheet geometry + apply, malformed repair in the sheet,
  batch-strip → locked sheet → apply → selection cleared.
- **De-dup**: the spec's local `setEntryContent`/`readEntryContent`/
  `openFirstEntry`/welcome-screen `createProject` copies replaced by the
  shared `e2e/helpers.ts` implementations (active-tab scoped, per the
  AGENTS.md locator rule).
- **Branch-final sweep** (per project, committed state):
  - `desktop-chrome`: 87 tests — 71 passed, 16 phone-pinned skipped, 0 failed.
  - `mobile-chrome`: 87 tests — 46 passed, 41 skipped, 0 failed.
  - `mobile-safari`: 87 tests — 43 passed, 43 skipped, 1 failed = the
    documented pre-existing WebKit red (`mobile-bottom-bar.spec.ts` "the
    Export action opens the shared export menu above the bar", ~37px panel
    offset — AGENTS.md known-red, not this task's regression).
  - Fix-forwards inside the sweep: the two pin migrations above (re-ran only
    the failing project/spec, then repeated the full desktop project).
- **Final gates**: `npm test --coverage` 60 files / 1323 tests passed, all
  files ≥ thresholds (96.1% stmts / 91.06% branches / 91.36% funcs / 97.32%
  lines — no `src/` files touched, no touched-file deltas); `npm run lint`
  clean; `npm run build` and `typecheck:e2e` clean.
- **Next:** the branch is ready for user testing.

---

## Post-testing fix round 1 — markdown toggle marker on switch (user report)

- **Report**: re-wrapping markdown content (with trailing `---`) to tag/bracket
  kept the marker inside the new shell; the same was reported for `---`
  ("separator") content. Screenshot: 圣杯 entry, markdown → Tag preview.
- **Root cause**: the §4.4 matrix row approved at 12-1 ("tag, bracket: kept as
  payload") applied regardless of the detected current style. For a detected
  markdown wrapper the trailing `---` is provably the style's own toggle
  marker (part of the markdown shape), so keeping it was wrong; for bare
  separator-detected prose it is byte-identical to a scene break (Phase-1 D4
  guard).
- **Fix (this commit)**: `rewrapContent` consumes the trailing `---` for every
  target when the detected current style is `markdown` (name-matched strip
  strips it from the payload; foreign header keeps D7 header protection, its
  marker is still consumed). Separator-detected prose and tag/bracket payloads
  keep the D4 scene-break protection — pinned explicitly next to the migrated
  pin. Preview is affected identically (shared rewrap path).
- **Pins migrated**: `keeps a trailing --- as payload when re-wrapping markdown
  to tag` → `consumes the markdown toggle marker when re-wrapping markdown to
  tag/bracket` (+ idempotency) with two new boundary pins (D7 foreign-header
  marker consumption; D4 separator-detected protection). No e2e pins existed
  for markdown→tag.
- **Gates**: unit 60 files / 1325 passed · build ✓ · lint ✓.
- **Open question for the user**: separator-detected → tag/bracket consumption
  would reverse the Phase-1 D4 scene-break guard (byte-indistinguishable
  inputs) — asked, awaiting answer.
- **Plan doc**: §4.4 table carries the dated amendment.
