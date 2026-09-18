# Next Tasks — MEDIUM PRIORITY Planning

Planning documents for the four MEDIUM PRIORITY items in `ROADMAP.md`. **Planning only — no implementation.**

| # | Plan | ROADMAP Item | Primary Agents |
|---|------|--------------|----------------|
| 01 | [delimiters-edge-cases.md](./01-delimiters-edge-cases.md) ✅ Completed 2026-09-18 | Delimiters testing and edge cases | core-engine → ui-specialist → qa-auditor → ts-reviewer |
| 02 | [mobile-ergonomics.md](./02-mobile-ergonomics.md) | Mobile Ergonomics & Responsive Viewport Guardrails | ui-specialist → qa-auditor → ts-reviewer |
| 03 | [lorebook-linter.md](./03-lorebook-linter.md) | Lorebook Health Linter & Validator | core-engine → ui-specialist → qa-auditor → ts-reviewer |
| 04 | [regex-key-sandbox.md](./04-regex-key-sandbox.md) | Regex Key Testing Sandbox | core-engine → ui-specialist → qa-auditor → ts-reviewer |

## Execution Order & Dependencies

```
01 (Delimiters)  ── independent, can run any time
02 (Mobile)      ── independent start, but MUST land before 03's modal UI
03 (Linter)      ── produces shared st-regex/matcher modules consumed by 04
04 (Sandbox)     ── depends on 03 Phase 1 (shared regex modules)
```

Recommended sequence: **01 and 02 in parallel → 03 → 04**.
Rationale:

- Task 02 establishes the reusable dialog→bottom-sheet conversion pattern; the ROADMAP explicitly requires the (not-yet-built) Linter modal to be a bottom sheet on narrow screens, so 02 should land first.
- Task 03 extracts SillyTavern's `parseRegexFromString` / key-matching semantics into shared core modules (`st-regex`, key matcher) that Task 04 reuses. If 04 must run first, move 03's Phase 1 into 04 as its Phase 0.

## Shared Conventions (apply to every task)

- **Agents & routing**: follow the persona directory in `AGENTS.md` (`.agents/*.md`); the orchestrator dispatches the `core-engine`, `ui-specialist`, `qa-auditor`, and `ts-reviewer` subagents via the Agent tool.
- **Invariants**: never drop unknown vendor keys; no `::ng-deep`; Signals over RxJS; core services stay UI-framework-free.
- **Verification gates** (per `AGENTS.md`): `npm run build`, `npm test`, `ng test --coverage`, `npx playwright test`, `npm run lint`.
- **Commit per task**: for each completed task, create an atomic git commit following the repository's conventional commit format (`feat: ...`, `fix: ...`, `test: ...`, `refactor: ...`).
- **Baseline assumption**: plans are grounded against `develop` @ `4120bb9` (About dialog already implemented — it is the reference pattern for responsive dialogs).
