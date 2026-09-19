# LoreStitch Agent Orchestrator

LoreStitch is an Angular editor and version control manager for SillyTavern lorebooks and World Info cards.

## Operating Principles

- **Route Before Acting**: Inspect your assigned task and read the corresponding persona guide in `.agents/` before modifying code.
- **Strict Invariants**:
  - Never drop unknown vendor keys during import/export.
  - No `::ng-deep` or legacy CSS overrides.
  - Angular 22 reactivity: use Signals (`signal()`, `computed()`, `input()`, `output()`) over RxJS state.
- **Pipeline Order**: implementation agents first (`core-engine` → `ui-specialist`), then `ts-reviewer` (typing/lint review) **before** `qa-auditor`; `qa-auditor`'s pre-handoff checklist is the final verification gate.
- **Gate Failures Fix Forward**: a red gate means the responsible subagent fixes and re-runs its own phase; the pipeline never advances on a red gate. After two consecutive failed fix attempts, stop and escalate to the user with the failing output.
- **Human Sign-off on Contract Changes**: any change that alters exported bytes, entry `content` output, or behavior pinned by existing tests requires a user checkpoint — post the old-vs-new contract with a minimal repro after planning, and dispatch the changing phase only after approval.
- **Verification First**: Always run tests and builds before completing a task.
- **Commit Per Task**: For each completed task, create an atomic git commit following Conventional Commits 1.0.0 — `<type>(<scope>): <description>` in imperative mood (e.g., `fix(delimiters): detect mismatched whole-content wrappers`); breaking behavior changes carry `!` or a `BREAKING CHANGE:` footer. Full spec and house rules: `.agents/rules/conventional-commits.md` (always-on).

## Persona Directory

| Task Scope | File Path Focus | Agent File | Skills & MCP |
| :--- | :--- | :--- | :--- |
| Views, Components, Material Design 3 | `src/app/features/`, `src/app/shared/`, `src/app/app.*` | `.agents/ui-specialist.md` | Skill: `angular-developer`, `material-3`, `frontend-design`<br>MCP: `angular-cli` (if connected) |
| JSON Serialization, VCS, Hashing | `src/app/core/` | `.agents/core-engine.md` | Skill: `typescript-advanced-types`, `angular-developer` |
| End-to-End, Unit Tests, Coverage, Round-trips | `e2e/`, `**/*.spec.ts` | `.agents/qa-auditor.md` | Skill: `playwright-cli`, `angular-developer`<br>MCP: `playwright` |
| Cross-cutting Architecture, Typing, Linting | `src/app/**`, `tsconfig*.json`, `eslint.config.js` | `.agents/ts-reviewer.md` | Skill: `typescript-advanced-types`<br>MCP: `angular-cli` (if connected) |

## Standard Verification Commands

- Build check: `npm run build`
- Unit test suite: `npm test`
- Code coverage: `ng test --coverage`
- E2E & fidelity: `npx playwright test`
- Linting: `npm run lint`
