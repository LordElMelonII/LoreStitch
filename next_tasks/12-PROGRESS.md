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
