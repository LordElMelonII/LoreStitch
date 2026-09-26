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
