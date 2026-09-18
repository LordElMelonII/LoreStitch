# Next Tasks — MEDIUM PRIORITY Planning

Planning documents for the four MEDIUM PRIORITY items in `ROADMAP.md`. **Planning only — no implementation.**

| # | Plan | ROADMAP Item | Primary Agents |
|---|------|--------------|----------------|
| 01 | [delimiters-edge-cases.md](./01-delimiters-edge-cases.md) ✅ Completed 2026-09-18 | Delimiters testing and edge cases | core-engine → ui-specialist → qa-auditor → ts-reviewer |
| 02 | [mobile-ergonomics.md](./02-mobile-ergonomics.md) ✅ Completed 2026-09-18 | Mobile Ergonomics & Responsive Viewport Guardrails | ui-specialist → qa-auditor → ts-reviewer |
| 03 | [lorebook-linter.md](./03-lorebook-linter.md) | Lorebook Health Linter & Validator | core-engine → ui-specialist → qa-auditor → ts-reviewer |
| 04 | [regex-key-sandbox.md](./04-regex-key-sandbox.md) | Regex Key Testing Sandbox | core-engine → ui-specialist → qa-auditor → ts-reviewer |

## Execution Order & Dependencies

```
01 (Delimiters)  ── independent, can run any time
02 (Mobile)      ── independent start, but MUST land before 03's modal UI
03 (Linter)      ── produces shared st-regex/matcher modules consumed by 04
04 (Sandbox)     ── depends on 03 Phase 1 (shared regex modules)
```

Recommended sequence: **03 → 04** (01 and 02 completed 2026-09-18).
Rationale:

- Task 02 establishes the reusable dialog→bottom-sheet conversion pattern; the ROADMAP explicitly requires the (not-yet-built) Linter modal to be a bottom sheet on narrow screens, so 02 should land first.
- Task 03 extracts SillyTavern's `parseRegexFromString` / key-matching semantics into shared core modules (`st-regex`, key matcher) that Task 04 reuses. If 04 must run first, move 03's Phase 1 into 04 as its Phase 0.

## Shared Conventions (apply to every task)

- **Agents & routing**: follow the persona directory in `AGENTS.md` (`.agents/*.md`); the orchestrator dispatches the `core-engine`, `ui-specialist`, `qa-auditor`, and `ts-reviewer` subagents via the Agent tool. All four are registered agent types, and every skill they cite (`angular-developer`, `material-3`, `typescript-advanced-types`, `playwright-cli`) exists in `.agents/skills/` and `.zcode/skills/`.
- **MCP availability**: `AngularMCP` (`angular-cli`) is configured in `.zcode/config.json` but may not be connected when a session starts. The orchestrator must confirm its tools are live before directing a subagent to it; otherwise the subagent falls back to the `angular-developer` skill plus installed typings under `node_modules/@angular/*`. qa-auditor browser work runs through the `playwright` MCP / `playwright-cli` skill.
- **Parallel dispatch**: concurrent subagent runs are allowed only on disjoint file sets; the orchestrator serializes their commits (single working tree) and runs verification gates between dispatches.
- **Re-grounding**: plans are point-in-time audits. Before dispatching a task, re-check its file list at current HEAD (directly or via a read-only `Explore` agent) and refresh any drifted section of the plan before phase 1 starts.
- **Invariants**: never drop unknown vendor keys; no `::ng-deep`; Signals over RxJS; core services stay UI-framework-free.
- **Verification gates** (per `AGENTS.md`): `npm run build`, `npm test`, `ng test --coverage`, `npx playwright test`, `npm run lint`.
- **Commit per phase**: each subagent deliverable lands as its own atomic conventional commit (`feat: ...`, `fix: ...`, `test: ...`, `refactor: ...`); task completion adds a `docs(next_tasks): ...` status commit (matches Task 01's history).
- **Baseline**: plans were grounded against `develop` @ `4120bb9`; Task 01 has since landed (`a5f4c34`..`109061d`, delimiters + `topbar.*`). No file-set overlap with 02–04 except `topbar.html/.scss/.spec.ts` (touched by Task 02 P1 and Task 03 P3) — re-read topbar at current HEAD before those phases.
