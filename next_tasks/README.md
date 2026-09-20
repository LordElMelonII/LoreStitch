# Next Tasks — Planning

Planning documents for the remaining MEDIUM PRIORITY items in `ROADMAP.md`
(plus urgent fixes routed here). **Planning only — no implementation.**
Completed plans live in [archive/](./archive/).

## Pending

Three plans from the 2026-09-20 user bug report (numbered off the archive; none
started). Recommended order:

1. **[06 — Mobile bottom bar: always-docked bar & multi-select action swap](./06-mobile-bottom-bar-docked-swap.md)** —
   bar no longer unstamps under drawers/dialogs (stutter fix); batch toolbar
   relocates into a raised bar swap while the entries drawer holds a selection
   (fixes the row-skip and the ✕ overflow on phones). Phone focus policy rides
   along. Design checkpoint before the swap phase.
2. **[07 — Search responsiveness: debounced filter & preview](./07-search-responsiveness.md)** —
   ~200ms trailing debounce + haystack pre-fold for the sidebar filter, debounced
   preview for Search & Replace; results stay byte-identical.
3. **[08 — Test keys: SillyTavern trigger verdict](./08-test-keys-trigger-verdict.md)** —
   pure `st-trigger` module evaluates disabled/constant/keys/secondary-logic/
   probability exactly like the vendored `world-info.js`; panel gains an explicit
   "would it be inserted?" verdict row (fixes the green-on-blocking-key report).
   Design checkpoint before the panel phase.

06 and 07 both end in `e2e/` work — serialize their qa phases; 06 and 08 are
otherwise file-disjoint and could interleave, but run them sequentially to keep
the single verification pipeline honest.

## Shared Conventions (apply to every task)

- **Agents & routing**: follow the persona directory in `AGENTS.md` (`.agents/*.md`); the orchestrator dispatches the `core-engine`, `ui-specialist`, `qa-auditor`, and `ts-reviewer` subagents via the Agent tool. All four are registered agent types, and every skill they cite (`angular-developer`, `material-3`, `typescript-advanced-types`, `playwright-cli`, `frontend-design`) exists in `.agents/skills/` and `.zcode/skills/`. **Skill precedence**: workspace copies win — user-level `~/.agents/skills/` is a fallback only; when a user-level original changes, refresh the vendored copies (`frontend-design` was vendored 2026-09-19).
- **MCP availability**: `AngularMCP` (`angular-cli`) is configured in `.zcode/config.json` but may not be connected when a session starts. The orchestrator must confirm its tools are live before directing a subagent to it; otherwise the subagent falls back to the `angular-developer` skill plus installed typings under `node_modules/@angular/*`. qa-auditor browser work runs through the `playwright` MCP / `playwright-cli` skill.
- **Parallel dispatch**: concurrent subagent runs are allowed only on disjoint file sets; the orchestrator serializes their commits (single working tree) and runs verification gates between dispatches.
- **Review before QA**: in every pipeline, `ts-reviewer` fires before `qa-auditor` — typing/lint review and any refactor it triggers land before the expensive E2E/coverage runs, and `qa-auditor`'s pre-handoff checklist is the final gate. (Tasks 01–02 ran the older qa-first order.) Residual seam: E2E specs written in the qa phase get no dedicated `ts-reviewer` pass — `qa-auditor`'s closing lint/type gate covers them mechanically.
- **Urgent intake**: a confirmed bug report enters as a numbered plan file (next free number) with a `**Source**` bug-report line, a 🔴 Urgent status, and a regression-pin test case (old behavior → expected behavior); it preempts the recommended sequence. Task 05 (archived) is the template.
- **Re-grounding**: plans are point-in-time audits. Before dispatching a task, re-check its file list at current HEAD (directly or via a read-only `Explore` agent) and refresh any drifted section of the plan before phase 1 starts.
- **Visual-feature baseline**: any task that adds or reshapes UI captures before/after screenshots (`__screenshots__/<task>/{before,after}/`, gitignored) under identical pinned conditions — same browser, fixed viewports, one explicit theme, same seeded project, settled rendering — and posts the comparison to the user with the phase report (protocol template: archived 03 §3.5, adopted 2026-09-19).
- **Invariants**: never drop unknown vendor keys; no `::ng-deep`; Signals over RxJS; core services stay UI-framework-free.
- **Verification gates** (per `AGENTS.md`): `npm run build`, `npm test`, `ng test --coverage`, `npx playwright test`, `npm run lint`.
- **Commit per phase**: each subagent deliverable lands as its own atomic conventional commit (`feat: ...`, `fix: ...`, `test: ...`, `refactor: ...`); task completion adds a `docs(next_tasks): ...` status commit (matches Task 01's history).
- **Test helpers**: new specs reuse the shared fixtures instead of copy-pasting helpers — unit specs pull from `src/testing/` (`projectOf`, `severityFixture`, `installMatchMediaStub`) and e2e specs from `e2e/helpers.ts` (`importLorebook`, `exportWorldInfo`, `selectFirstTwoRows`); the 2026-09-19 suite audit (root `TEST-REPORT.md`) traced ~150 lines of drift-prone duplication to copy-pasted helpers.
