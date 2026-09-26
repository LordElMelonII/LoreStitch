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
