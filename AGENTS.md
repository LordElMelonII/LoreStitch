# LoreStitch Agent Orchestrator

LoreStitch is an Angular editor and version control manager for SillyTavern lorebooks and World Info cards.

## Operating Principles

- **Route Before Acting**: Inspect your assigned task and read the corresponding persona guide in `.agents/` before modifying code.
- **Strict Invariants**:
  - Never drop unknown vendor keys during import/export.
  - No `::ng-deep` or legacy CSS overrides.
  - Angular 22 reactivity: use Signals (`signal()`, `computed()`, `input()`, `output()`) over RxJS state.
  - Dual-container panes (dialog on tablet/desktop, bottom sheet on phones) open only through `ResponsiveOverlayService.openResponsive` (`src/app/shared/services/responsive-overlay.service.ts`); viewport branching never appears at call sites.
- **Module Naming**: injectable classes get the `.service.ts` suffix + `@Service()` decorator; pure framework-free analysis code lands as bare-name modules with no decorator, even under `core/services/` (`sha256.ts`, `token-estimator.ts`, `linter.ts` precedent).
- **Workspace Mutations Go Through Service Mutators**: components write project/workspace state only via narrow typed public mutators on `WorkspaceService` (they route through the private `mutateProject` chokepoint → immutable replace → debounced IndexedDB save); never `activeProject.set` from features — a direct write skips persistence.
- **Pipeline Order**: implementation agents first (`core-engine` → `ui-specialist`), then `ts-reviewer` (typing/lint review) **before** `qa-auditor`; `qa-auditor`'s pre-handoff checklist is the final verification gate.
- **Gate Failures Fix Forward**: a red gate means the responsible subagent fixes and re-runs its own phase; the pipeline never advances on a red gate. After two consecutive failed fix attempts, stop and escalate to the user with the failing output.
- **Human Sign-off on Contract Changes**: any change that alters exported bytes, entry `content` output, or behavior pinned by existing tests requires a user checkpoint — post the old-vs-new contract with a minimal repro after planning, and dispatch the changing phase only after approval.
- **Verification First**: Always run tests and builds before completing a task.
- **Visual Feature Baseline**: any task that adds or reshapes UI captures before/after screenshots under the gitignored `__screenshots/<task>/{before,after}/`, with identical pinned conditions for both sets — same browser, fixed viewports (1280×800 desktop, 1024×768 tablet, 390×844 mobile), one explicit theme (never system), the same seeded project, settled rendering — and posts the side-by-side comparison to the user with the phase report.
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

## Environment & Session Notes

- One-shot unit run: `CI=true npm test -- --watch=false` (plain `npm test` may watch); add `--coverage` for the coverage run.
- Coverage thresholds (statements/functions/lines ≥ 80, branches ≥ 75) are enforced inside the test run — a threshold regression fails `npm test` itself.
- Playwright filters by spec-name substring (`npx playwright test delimiters round-trip`); a large "skipped" count is by design — phone-pinned tests skip on desktop projects, mobile-chrome/mobile-safari run them. Entry editor assertions must scope to the active tab body (`.mat-mdc-tab-body-active`) — inactive mat-tabs keep their inputs in the DOM.
- Material Symbols render from a self-hosted pre-subsetted woff2 (`public/fonts/material-symbols-outlined.woff2`) built by `scripts/refresh-icons.mjs` scanning `src/`; after adding a new icon ligature run `npm run icons:refresh` or the ligature renders as raw text. Stage the regenerated font with the feature commit.
- Repo-wide prettier drift is pre-existing and `format:check` is not a maintained gate — format only the files you touch; a repo-wide format commit is a user decision, not a drive-by.
- Task branches: every task executes on a `feature/<nn>-<slug>` branch created off `develop`; all of its phase commits land there. When the work completes, push the branch to origin and stop — never merge it back automatically. `git merge --ff-only` into `develop` happens only after the user has manually tested the branch and given the go.
- History is linear: merge with fast-forward only, no merge commits. Releases: `chore(release): vX.Y.Z` touching `package.json`, both `lore-stitch` version fields in `package-lock.json`, and `CHANGELOG.md` (writer-facing voice; no git tags).
- Check `git status --short` before each phase commit; unrelated local edits (e.g. `.gitignore`) may appear mid-session — keep them out of atomic phase commits.
- When a task changes pinned behavior, grep existing unit AND e2e specs for tests pinning the old behavior and migrate them within the changing phase.
