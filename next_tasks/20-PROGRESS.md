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
