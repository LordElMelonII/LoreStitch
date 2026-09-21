# Next Tasks — Planning

Planning documents for the remaining MEDIUM PRIORITY items in `ROADMAP.md`
(plus urgent fixes routed here). **Planning only — no implementation.**
Completed plans live in [archive/](./archive/).

## Pending

None — the 2026-09-20 bug-report batch (06–08) is implemented on feature
branches and archived (see [archive/README.md](./archive/README.md) for the
landing table; 06/08 await user test + ff-merge as of 2026-09-21).

## Shared Conventions (apply to every task)

- **Agents & routing**: follow the persona directory in `AGENTS.md` (`.agents/*.md`); the orchestrator dispatches the `core-engine`, `ui-specialist`, `qa-auditor`, and `ts-reviewer` subagents via the Agent tool. All four are registered agent types, and every skill they cite (`angular-developer`, `material-3`, `typescript-advanced-types`, `playwright-cli`, `frontend-design`) exists in `.agents/skills/` and `.zcode/skills/`. **Skill precedence**: workspace copies win — user-level `~/.agents/skills/` is a fallback only; when a user-level original changes, refresh the vendored copies (`frontend-design` was vendored 2026-09-19).
- **MCP availability**: `AngularMCP` (`angular-cli`) is configured in `.zcode/config.json` but may not be connected when a session starts. The orchestrator must confirm its tools are live before directing a subagent to it; otherwise the subagent falls back to the `angular-developer` skill plus installed typings under `node_modules/@angular/*`. qa-auditor browser work runs through the `playwright` MCP / `playwright-cli` skill.
- **Parallel dispatch**: concurrent subagent runs are allowed only on disjoint file sets; the orchestrator serializes their commits (single working tree) and runs verification gates between dispatches.
- **Review before QA**: in every pipeline, `ts-reviewer` fires before `qa-auditor` — typing/lint review and any refactor it triggers land before the expensive E2E/coverage runs, and `qa-auditor`'s pre-handoff checklist is the final gate. (Tasks 01–02 ran the older qa-first order.) Residual seam: E2E specs written in the qa phase get no dedicated `ts-reviewer` pass — `qa-auditor`'s closing lint/type gate covers them mechanically.
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
- **Verification gates** (per `AGENTS.md`): `npm run build`, `npm test`, `ng test --coverage`, `npx playwright test`, `npm run lint`.
- **Commit per phase**: each subagent deliverable lands as its own atomic conventional commit (`feat: ...`, `fix: ...`, `test: ...`, `refactor: ...`); task completion adds a `docs(next_tasks): ...` status commit (matches Task 01's history).
- **Test helpers**: new specs reuse the shared fixtures instead of copy-pasting helpers — unit specs pull from `src/testing/` (`projectOf`, `severityFixture`, `installMatchMediaStub`) and e2e specs from `e2e/helpers.ts` (`importLorebook`, `exportWorldInfo`, `selectFirstTwoRows`); the 2026-09-19 suite audit (root `TEST-REPORT.md`) traced ~150 lines of drift-prone duplication to copy-pasted helpers.
