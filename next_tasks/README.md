# Next Tasks — MEDIUM PRIORITY Planning

Planning documents for the four MEDIUM PRIORITY items in `ROADMAP.md` (plus urgent fixes routed here). **Planning only — no implementation.**

| # | Plan | ROADMAP Item | Primary Agents |
|---|------|--------------|----------------|
| 01 | [delimiters-edge-cases.md](./01-delimiters-edge-cases.md) ✅ Completed 2026-09-18 | Delimiters testing and edge cases | core-engine → ui-specialist → qa-auditor → ts-reviewer |
| 02 | [mobile-ergonomics.md](./02-mobile-ergonomics.md) ✅ Completed 2026-09-18 | Mobile Ergonomics & Responsive Viewport Guardrails | ui-specialist → qa-auditor → ts-reviewer |
| 03 | [lorebook-linter.md](./03-lorebook-linter.md) ✅ Completed 2026-09-19 | Lorebook Health Linter & Validator | core-engine → ui-specialist → ts-reviewer → qa-auditor |
| 04 | [regex-key-sandbox.md](./04-regex-key-sandbox.md) | Regex Key Testing Sandbox | core-engine → ui-specialist → ts-reviewer → qa-auditor |
| 05 | [urgent-mismatched-delimiters.md](./05-urgent-mismatched-delimiters.md) ✅ Completed 2026-09-19 | Bug report 2026-09-19 — reopens ROADMAP "Asymmetric Delimiters" (`<foo>…</bar>`) | core-engine → ui-specialist → ts-reviewer → qa-auditor |

## Execution Order & Dependencies

```
01 (Delimiters)  ── completed 2026-09-18
02 (Mobile)      ── completed 2026-09-18
05 (Urgent)      ── completed 2026-09-19 (mismatched/malformed delimiter detection & cleanup)
03 (Linter)      ── completed 2026-09-19 (shared st-regex/matcher modules landed for 04;
                   adopted 05's detectMalformedWrapper as a lint rule; user-amended with
                   per-issue ignore + rule mute persisted in .stproj archives)
04 (Sandbox)     ── depends on 03 Phase 1 (shared regex modules — landed)
```

Recommended sequence: **05 → 03 → 04** (01 and 02 completed 2026-09-18).
Rationale:

- Task 02 establishes the reusable dialog→bottom-sheet conversion pattern; the ROADMAP explicitly requires the (not-yet-built) Linter modal to be a bottom sheet on narrow screens, so 02 should land first.
- Task 03 extracts SillyTavern's `parseRegexFromString` / key-matching semantics into shared core modules (`st-regex`, key matcher) that Task 04 reuses. If 04 must run first, move 03's Phase 1 into 04 as its Phase 0.

## Shared Conventions (apply to every task)

- **Agents & routing**: follow the persona directory in `AGENTS.md` (`.agents/*.md`); the orchestrator dispatches the `core-engine`, `ui-specialist`, `qa-auditor`, and `ts-reviewer` subagents via the Agent tool. All four are registered agent types, and every skill they cite (`angular-developer`, `material-3`, `typescript-advanced-types`, `playwright-cli`, `frontend-design`) exists in `.agents/skills/` and `.zcode/skills/`. **Skill precedence**: workspace copies win — user-level `~/.agents/skills/` is a fallback only; when a user-level original changes, refresh the vendored copies (`frontend-design` was vendored 2026-09-19).
- **MCP availability**: `AngularMCP` (`angular-cli`) is configured in `.zcode/config.json` but may not be connected when a session starts. The orchestrator must confirm its tools are live before directing a subagent to it; otherwise the subagent falls back to the `angular-developer` skill plus installed typings under `node_modules/@angular/*`. qa-auditor browser work runs through the `playwright` MCP / `playwright-cli` skill.
- **Parallel dispatch**: concurrent subagent runs are allowed only on disjoint file sets; the orchestrator serializes their commits (single working tree) and runs verification gates between dispatches.
- **Review before QA**: in every pipeline, `ts-reviewer` fires before `qa-auditor` — typing/lint review and any refactor it triggers land before the expensive E2E/coverage runs, and `qa-auditor`'s pre-handoff checklist is the final gate. (Completed Tasks 01–02 ran the older qa-first order; pending Tasks 03–05 use review-first.) Residual seam: E2E specs written in the qa phase get no dedicated `ts-reviewer` pass — `qa-auditor`'s closing lint/type gate covers them mechanically.
- **Urgent intake**: a confirmed bug report enters as a numbered plan file (next free number) with a `**Source**` bug-report line, a 🔴 Urgent status, and a regression-pin test case (old behavior → expected behavior); it preempts the recommended sequence. Task 05 is the template.
- **Re-grounding**: plans are point-in-time audits. Before dispatching a task, re-check its file list at current HEAD (directly or via a read-only `Explore` agent) and refresh any drifted section of the plan before phase 1 starts.
- **Visual-feature baseline**: any task that adds or reshapes UI captures before/after screenshots (`__screenshots/<task>/{before,after}/`, gitignored) under identical pinned conditions — same browser, fixed viewports, one explicit theme, same seeded project, settled rendering — and posts the comparison to the user with the phase report (protocol template: 03 §3.5, adopted 2026-09-19).
- **Invariants**: never drop unknown vendor keys; no `::ng-deep`; Signals over RxJS; core services stay UI-framework-free.
- **Verification gates** (per `AGENTS.md`): `npm run build`, `npm test`, `ng test --coverage`, `npx playwright test`, `npm run lint`.
- **Commit per phase**: each subagent deliverable lands as its own atomic conventional commit (`feat: ...`, `fix: ...`, `test: ...`, `refactor: ...`); task completion adds a `docs(next_tasks): ...` status commit (matches Task 01's history).
- **Baseline**: plans are point-in-time audits (see Re-grounding); grounding SHAs and file ownership:

| Task | Grounded at | Notes |
|------|-------------|-------|
| 01, 02 | `4120bb9` (01 landed `a5f4c34`..`109061d`) | Completed 2026-09-18 |
| 03 | `329509b` (re-grounded 2026-09-19) | Completed 2026-09-19 — landed `552a6cc`..`37865dc`; owns `core/models/st-regex.*`, `core/models/st-key-match.*`, `core/services/linter.*`, `features/linter/**`, the topbar linter entry, `e2e/linter.spec.ts`, `example_card/linter-demo.lorebook.json`; design recorded in plan §3.6 (user-approved, incl. the ignore/mute `.stproj` amendment); 04 consumes `st-regex`/`st-key-match` |
| 04 | `4120bb9` | Pending — re-ground before dispatch (consumes 03's shared modules; `entry-keys.*` untouched since the audit, but re-check at HEAD) |
| 05 | `c003bce` (05 landed `ba8b753`..`ca41d39`) | Completed 2026-09-19 — owns `core/models/delimiters.*`, `features/delimiters/**`, `entry-content-field.*`, `e2e/delimiters.spec.ts`; disjoint from 03/04 |
