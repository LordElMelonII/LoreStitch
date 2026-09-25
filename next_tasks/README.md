# Next Tasks — Planning

Planning documents for the remaining `ROADMAP.md` backlog (the LOW PRIORITY
items + quality-gate gaps routed here, since the MEDIUM batch closed with tasks
01–08; plus urgent fixes). **Planning only — no implementation.**
Completed plans live in [archive/](./archive/).

## Pending

Grounded at `develop` @ `ddc9f04` (2026-09-22 roadmap evaluation; see the
evaluation notes below). Task 15 (character-card round-trip), planned from the
same review, was completed and archived 2026-09-23 (shipped as v1.5.0). Task
09 (book schema validation & guided repair) was completed and archived
2026-09-25 (shipped as v1.6.0) — the pending queue below is unchanged.

| # | Plan | Scope | Status |
|---|------|-------|--------|
| 10 | [10-power-user-keyboard-shortcuts.md](./10-power-user-keyboard-shortcuts.md) | `Mod+S`/`Mod+N`/`Mod+F`, `Alt+↑/↓` + `J`/`K`, `Mod+Shift+D` wired over existing actions | ✅ Ready (checkpoint 10-1 after P1) |
| 11 | [11-multi-tab-session-lock.md](./11-multi-tab-session-lock.md) | Web Locks session guard + non-destructive takeover prompt; flush-before-release so no edit is discarded | ✅ Ready (checkpoint 11-1 after P1) |

### Queue (sketched during evaluation; planned when their turn comes)

- **12 — Single Linear Workspace Undo/Redo**: one workspace-global stack for
  macro actions (add, delete, bulk update); micro text edits stay on native
  `<textarea>` undo. Design direction from the evaluation: record at the
  `mutateProject` chokepoint as entry-level before/after diffs (never
  whole-book clones); commits and rollbacks are **barriers that clear the
  stack** (per-entry stacks desyncing from global VCS commits is the
  roadmap's stated failure mode); `updateEntry` stays unrecorded (it is the
  per-keystroke path). Wants task 10 first for the `Mod+Z`/`Mod+Shift+Z`
  chords.
- **13 — Pinned Reference Drawer**: collapsible right-hand inspector pinning
  any entry read-only while editing the primary one. Not a third
  `mat-sidenav` (the container hosts one end drawer and history holds it) —
  an in-editor rail under `entry-editor/` + shell affordance, phone behavior
  through the dual-container pattern. Visual feature ⇒ design-evidence
  checkpoint + screenshot baseline.
- ~~**14 — Starter Presets & Templates**~~ — **declassified 2026-09-22**
  (user decision; the character-card round-trip took the slot as the next
  high-impact item). The idea may return later; no plan file was written,
  the ROADMAP sketch is struck through, and the number stays retired —
  re-proposals take the next free number.
- **UX follow-ups from the 2026-09-22 app review** (branch
  `feature/2026-09-22-app-review`; surveyed, **none implemented** — each
  changes a flow or user-facing copy and needs the user's go-ahead first):
  history restore is destructive with no confirmation (the restore button in
  `commit-history.html` → `workspace.rollbackTo` silently discards
  uncommitted changes; route through `ConfirmDialog` naming what is
  discarded); single-entry delete confirms nothing while batch delete does
  (row delete icon in `entry-list`); drag-reorder has no keyboard alternative
  ("move up/down" row-menu leaves through `workspace.moveEntry`); the entry
  row is `role="button"` wrapping nested interactive controls (a
  listbox/option restructure would be cleaner but risks e2e selectors).
  The same review assessed `workspace.rollbackTo`'s direct-save path
  (non-debounced, outside `mutateProject`) as **sound by design** — no
  change wanted there.

Urgent bug reports still preempt this queue (intake convention below).

## Evaluation notes (2026-09-22)

- **Quality gates**: format compatibility and automated round-trip verification
  are mechanically enforced (`toSpecCompliantBook`, the import guards,
  `e2e/round-trip.spec.ts` + `src/app/core/models/lorebook.roundtrip.spec.ts`
  over the `example_card/` reference books). The **pre-flight export
  validation** bullet was the one unenforced gate — routed as task 09.
- **Recommended order** differs from the ROADMAP listing: gate enforcement and
  the friction/data-loss fixes (09–11) go before the architectural undo stack
  (12) and the two visual features (13–14), which carry design checkpoints and
  screenshot baselines. The queue is reorderable on request.
- **User-value reprioritization (2026-09-22, same day)**: within the 09–11
  batch, the execution order was re-ranked by usefulness to users —
  **10 → 09 → 11** (table above). 10 pays off for every user on every editing
  session (the ROADMAP's own "excessive friction" finding) and unlocks task
  12's `Mod+Z`/`Mod+Shift+Z` chords; 09 protects the export path's data
  integrity (its critical-gate status is an engineering priority — user value
  concentrates in third-party/hand-edited books with bad ids, and its
  day-to-day surface is invisible for clean books); 11 guards the narrower
  two-tabs-open data-loss scenario. 09 remains the only unenforced ROADMAP
  critical gate and stays ahead of the queue items.
- **ROADMAP.md structure fix**: the "Single Linear Workspace Undo/Redo" item
  had lost its heading level — its Why/What/Where were nested inside the
  keyboard-navigation bullet list (the undo rationale read as a third "Why"
  for shortcuts). Restored as its own item in `ROADMAP.md`.

## Shared Conventions (apply to every task)

- **Agents & routing**: follow the persona directory in `AGENTS.md` (`.agents/*.md`); the orchestrator dispatches the `core-engine`, `ui-specialist`, `qa-auditor`, and `ts-reviewer` subagents via the Agent tool. All four are registered agent types, and every skill they cite (`angular-developer`, `material-3`, `typescript-advanced-types`, `playwright-cli`, `frontend-design`) exists in `.agents/skills/` and `.zcode/skills/`. **Skill precedence**: workspace copies win — user-level `~/.agents/skills/` is a fallback only; when a user-level original changes, refresh the vendored copies (`frontend-design` was vendored 2026-09-19).
- **MCP availability**: `AngularMCP` (`angular-cli`) is configured in `.zcode/config.json` but may not be connected when a session starts. The orchestrator must confirm its tools are live before directing a subagent to it; otherwise the subagent falls back to the `angular-developer` skill plus installed typings under `node_modules/@angular/*`. qa-auditor browser work runs through the `playwright` MCP / `playwright-cli` skill.
- **Parallel dispatch**: concurrent subagent runs are allowed only on disjoint file sets; the orchestrator serializes their commits (single working tree) and runs verification gates between dispatches.
- **Review before QA**: in every pipeline, `ts-reviewer` fires before `qa-auditor` — typing/lint review and any refactor it triggers land before the coverage-enforced QA gate. (Tasks 01–02 ran the older qa-first order.) The full E2E matrix is **not** part of the per-task gate: per `AGENTS.md`, qa smokes touched e2e specs on `desktop-chrome` only in-task, and the three-project `npx playwright test` sweep runs once per task branch at its close (branch-final). Residual seam: E2E specs written in the qa phase get no dedicated `ts-reviewer` pass — `qa-auditor`'s closing lint/type gate covers them mechanically.
- **Progress ledger (crash resilience)**: during execution each task keeps
  `next_tasks/<nn>-PROGRESS.md`. After **every** phase it records what landed
  (files + commit SHA), gates run with results, decisions and deviations from the
  plan, and a `Next:` line — then is committed as
  `docs(next_tasks): task NN phase P progress` and **pushed with the task branch**
  (origin is the crash backup; unpushed history is lost history). A session
  resuming after a shutdown reads the plan + ledger + `git log --first-parent` of
  the branch to find the exact resume point and never redoes a green phase. When
  the task completes, the ledger is archived beside its plan (Task 02's
  `02-PROGRESS.md` precedent).
- **Urgent intake**: a confirmed bug report enters as a numbered plan file (next free number) with a `**Source**` bug-report line, a 🔴 Urgent status, and a regression-pin test case (old behavior → expected behavior); it preempts the recommended sequence. Task 05 (archived) is the template.
- **Re-grounding**: plans are point-in-time audits. Before dispatching a task, re-check its file list at current HEAD (directly or via a read-only `Explore` agent) and refresh any drifted section of the plan before phase 1 starts.
- **Visual-feature baseline**: any task that adds or reshapes UI captures before/after screenshots (`__screenshots__/<task>/{before,after}/`, gitignored) under identical pinned conditions — same browser, fixed viewports, one explicit theme, same seeded project, settled rendering — and posts the comparison to the user with the phase report (protocol template: archived 03 §3.5, adopted 2026-09-19).
- **Invariants**: never drop unknown vendor keys; no `::ng-deep`; Signals over RxJS; core services stay UI-framework-free.
- **Verification gates** (per `AGENTS.md`): per task — `npm run build`, `npm test`, `ng test --coverage`, `npm run lint` (+ `npm run typecheck:e2e` and a `desktop-chrome`-only smoke of touched e2e specs); branch-final — the full three-project `npx playwright test` sweep, run per project, plus a closing `npm test --coverage` and `npm run lint`.
- **Commit per phase**: each subagent deliverable lands as its own atomic conventional commit (`feat: ...`, `fix: ...`, `test: ...`, `refactor: ...`); task completion adds a `docs(next_tasks): ...` status commit (matches Task 01's history).
- **Test helpers**: new specs reuse the shared fixtures instead of copy-pasting helpers — unit specs pull from `src/testing/` (`projectOf`, `severityFixture`, `installMatchMediaStub`) and e2e specs from `e2e/helpers.ts` (`importLorebook`, `exportWorldInfo`, `selectFirstTwoRows`); the 2026-09-19 suite audit (root `TEST-REPORT.md`) traced ~150 lines of drift-prone duplication to copy-pasted helpers.
