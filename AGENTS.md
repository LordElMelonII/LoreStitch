# LoreStitch Agent Orchestrator

LoreStitch is an Angular editor and version control manager for SillyTavern lorebooks and World Info cards.

## Operating Principles

- **Route Before Acting**: Inspect your assigned task and read the corresponding persona guide in `.agents/` before modifying code.
- **Strict Invariants**:
  - Never drop unknown vendor keys during import/export.
  - No `::ng-deep` or legacy CSS overrides.
  - Angular 22 reactivity: use Signals (`signal()`, `computed()`, `input()`, `output()`) over RxJS state.
- **Verification First**: Always run tests and builds before completing a task.

## Persona Directory

| Task Scope | File Path Focus | Agent File | Skills & MCP |
| :--- | :--- | :--- | :--- |
| Views, Components, Material Design 3 | `src/app/features/`, `src/app/shared/components/` | `.agents/ui-specialist.md` | Skill: `angular-developer`, `material-3`<br>MCP: `angular-cli` |
| JSON Serialization, VCS, Hashing | `src/app/core/` | `.agents/core-engine.md` | Skill: `typescript-advanced-types`, `angular-developer` |
| End-to-End, Unit Tests, Coverage, Round-trips | `e2e/`, `**/*.spec.ts` | `.agents/qa-auditor.md` | Skill: `playwright-cli`, `angular-developer` |
| Cross-cutting Architecture, Typing, Linting | `src/app/**`, `tsconfig*.json`, `eslint.config.js` | `.agents/ts-reviewer.md` | Skill: `typescript-advanced-types`<br>MCP: `angular-cli` |

## Standard Verification Commands

- Build check: `npm run build`
- Unit test suite: `npm test`
- Code coverage: `ng test --coverage`
- E2E & fidelity: `npx playwright test`
- Linting: `npm run lint`
