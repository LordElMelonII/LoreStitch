# LoreStitch Agent Orchestrator

LoreStitch is an Angular editor and version control manager for SillyTavern lorebooks and World Info cards.

## Operating Principles

- **Route Before Acting**: Inspect your assigned task and read the corresponding persona guide in `.zcode/agents/` before modifying code.
- **Strict Invariants**:
  - Never drop unknown vendor keys during import/export.
  - No `::ng-deep` or legacy CSS overrides.
  - Angular 22 reactivity: use Signals (`signal()`, `computed()`, `input()`, `output()`) over RxJS state.
  - Dual-container panes (dialog on tablet/desktop, bottom sheet on phones) open only through `ResponsiveOverlayService.openResponsive` (`src/app/shared/services/responsive-overlay.service.ts`); viewport branching never appears at call sites.
- **Module Naming**: injectable classes get the `.service.ts` suffix + `@Service()` decorator; pure framework-free analysis code lands as bare-name modules with no decorator, even under `core/services/` (`sha256.ts`, `token-estimator.ts`, `linter.ts` precedent).
- **Workspace Mutations Go Through Service Mutators**: components write project/workspace state only via narrow typed public mutators on `WorkspaceService` (they route through the private `mutateProject` chokepoint → immutable replace → debounced IndexedDB save); never `activeProject.set` from features — a direct write skips persistence.
- **Pipeline Order**: implementation agents first (`core-engine` → `ui-specialist`), then `ts-reviewer` (typing/lint review) **before** `qa-auditor`; `qa-auditor`'s pre-handoff checklist is the final verification gate.
- **Gate Failures Fix Forward**: a red gate means the responsible subagent fixes and re-runs its own phase; the pipeline never advances on a red gate. After two consecutive failed fix attempts, stop and escalate to the user with the failing output.
- **Human Sign-off at Gates**: changes that alter exported bytes, entry `content` output, or behavior pinned by existing tests — and any visual design spec — require a user checkpoint: post the old-vs-new contract with a minimal repro (or the evidence-backed spec), then wait for the explicit answer; an unanswered gate means stop at the gate, never close on a recommended default, and never dispatch the downstream phase unapproved.
- **Verification First**: Always run tests and builds before completing a task.
- **Visual Feature Baseline**: any task that adds or reshapes UI captures before/after screenshots under the gitignored `__screenshots__/<task>/{before,after}/` (double underscore — the `.gitignore` rule and the `__screenshots__/linter/capture.mjs` precedent), with identical pinned conditions for both sets — same browser, fixed viewports (1280×800 desktop, 1024×768 tablet, 390×844 mobile), one explicit theme (never system), the same seeded project, settled rendering — and posts the side-by-side comparison to the user with the phase report.
- **Design Checkpoint Evidence**: a visual design gate is approved against evidence, not prose alone — every new interactive control in a design spec cites the in-app exemplar it reuses or attaches a rendered mock; prose-only specs hide affordance and state problems (all three of Task 03's post-acceptance fixes trace to a prose-only checkpoint).
- **Commit Per Task**: For each completed task, create an atomic git commit following Conventional Commits 1.0.0 — `<type>(<scope>): <description>` in imperative mood (e.g., `fix(delimiters): detect mismatched whole-content wrappers`); breaking behavior changes carry `!` or a `BREAKING CHANGE:` footer. Full spec and house rules: `.zcode/agents/rules/conventional-commits.md` (always-on).

## Persona Directory

| Task Scope                                    | File Path Focus                                         | Agent File                       | Skills & MCP                                                                                     |
| :-------------------------------------------- | :------------------------------------------------------ | :------------------------------- | :----------------------------------------------------------------------------------------------- |
| Views, Components, Material Design 3          | `src/app/features/`, `src/app/shared/`, `src/app/app.*` | `.zcode/agents/ui-specialist.md` | Skill: `angular-developer`, `material-3`, `frontend-design`<br>MCP: `angular-cli` (if connected) |
| JSON Serialization, VCS, Hashing              | `src/app/core/`                                         | `.zcode/agents/core-engine.md`   | Skill: `typescript-advanced-types`, `angular-developer`                                          |
| End-to-End, Unit Tests, Coverage, Round-trips | `e2e/`, `**/*.spec.ts`                                  | `.zcode/agents/qa-auditor.md`    | Skill: `playwright-cli`, `angular-developer`<br>MCP: `playwright`                                |
| Cross-cutting Architecture, Typing, Linting   | `src/app/**`, `tsconfig*.json`, `eslint.config.js`      | `.zcode/agents/ts-reviewer.md`   | Skill: `typescript-advanced-types`<br>MCP: `angular-cli` (if connected)                          |

## Standard Verification Commands

- Build check: `npm run build`
- Unit test suite: `npm test`
- Code coverage: `ng test --coverage`
- E2E & fidelity: `npx playwright test`
- E2E spec typecheck: `npm run typecheck:e2e`
- Linting: `npm run lint`

## Environment & Session Notes

- One-shot unit run: `CI=true npm test -- --watch=false` (plain `npm test` may watch); add `--coverage` for the coverage run.
- Dev-server ports: `npm start` serves on **4321** (pinned in `angular.json` → `projects.lore-stitch.architect.serve.options.port`); Playwright boots its own dev server on **4301** (`playwright.config.ts` `webServer`). Neither uses Angular's default 4200.
- Coverage thresholds (statements/functions/lines ≥ 80, branches ≥ 75) are enforced inside the test run — a threshold regression fails `npm test` itself.
- Pruning tests is coverage-sensitive: diff the per-file coverage table against the phase-start baseline before finishing — global thresholds stay green while a touched file drops, because a deleted duplicate assertion may still have held a unique execution path.
- Playwright filters by spec-name substring (`npx playwright test delimiters round-trip`); a large "skipped" count is by design — phone-pinned tests skip on desktop projects; the projects are `desktop-chrome`, `mobile-chrome` (Pixel 7, 412×915) and `mobile-safari` (iPhone 14 — the 390×844 device): name projects, not viewport figures. Entry editor assertions must scope to the active tab body (`.mat-mdc-tab-body-active`) — inactive mat-tabs keep their inputs in the DOM. A "strict mode violation" failure means the locator resolved to several elements — scope it or pin the multiplicity with `.first()`; `test-results/<run>/error-context.md` lists what matched. Content that multiplies across releases (changelog sections, list rows) must never be pinned as unique.
- Playwright locator construction: `locator.filter({ has })` re-roots its inner locator — build the `has` locator from `page`, not the outer element (an outer-rooted inner locator can never match); `getByLabel` needs `{ exact: true }` when another control's label contains the text.
- Material Symbols render from a self-hosted pre-subsetted woff2 (`public/fonts/material-symbols-outlined.woff2`) built by `scripts/refresh-icons.mjs` scanning `src/`; after adding a new icon ligature run `npm run icons:refresh` or the ligature renders as raw text. Stage the regenerated font with the feature commit. The scanner's regex needs the literal `</mat-icon>` on one line — a newline inside either tag (e.g. a prettier-wrapped `</mat-icon⏎>`) silently drops the ligature from the subset; keep `<mat-icon>name</mat-icon>` single-line (interpolated `{{ }}` names only land via the script's `DYNAMIC_ICONS`).
- Material chip theming from host classes must go through the `--mat-chip-*` tokens Material's internal rules read (e.g. `--mat-chip-elevated-container-color` for fills) — a literal `background:` on the host loses the cascade to `.mat-mdc-standard-chip` specificity.
- Repo-wide prettier drift is pre-existing and `format:check` is not a maintained gate — format only the files you touch; a repo-wide format commit is a user decision, not a drive-by.
- Shared spec fixtures: unit specs reuse `src/testing/` (`projectOf`, `severityFixture`, `installMatchMediaStub`) and e2e specs reuse `e2e/helpers.ts` (`importLorebook`, `exportWorldInfo`, `selectFirstTwoRows`) instead of copy-pasting helpers into each spec (root `TEST-REPORT.md` traces the duplication this removed).
- Task branches: every task executes on a `feature/<nn>-<slug>` branch created off `develop`; all of its phase commits land there. When the work completes, push the branch to origin and stop — never merge it back automatically. `git merge --ff-only` into `develop` happens only after the user has manually tested the branch and given the go.
- History is linear: merge with fast-forward only, no merge commits. Releases: `chore(release): vX.Y.Z` touching `package.json`, both `lore-stitch` version fields in `package-lock.json`, and `CHANGELOG.md` (writer-facing voice; no git tags). Releases change pinned behavior too — grep e2e specs for release-specific pins (e.g. the About changelog test) and migrate them in the release commit.
- Check `git status --short` before each phase commit; unrelated local edits (e.g. `.gitignore`) may appear mid-session — keep them out of atomic phase commits.
- When a task changes pinned behavior, grep existing unit AND e2e specs for tests pinning the old behavior and migrate them within the changing phase.
- Component-spec fake timers: `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })` — the default set starves `fixture.whenStable()`; settle debounces with `fixture.detectChanges()` then `advanceTimersByTimeAsync` (debounce-arming effects are view effects flushed by `appRef.tick()`). CDK's internal debounce runs on RxJS's interval-backed scheduler — a setTimeout-faked clock cannot settle it; use a real-timer ~10ms window for viewport flips (topbar.spec precedent).
- Long gates kill subagent dispatches (~10-min inactivity timeout; full three-project Playwright runs take 7–20 min): brief qa agents to run Playwright per project (`npx playwright test --project=<name>`) and keep every single command under ~8 minutes, reporting between.
- A cancelled/killed subagent leaves uncommitted partial work: before re-dispatching, check `git status` + `git stash list` and prefer an audit-and-complete brief (it preserved two full phases in the 06/08 batch) over a restart-from-scratch brief.
- Design-checkpoint mocks built by driving the real app (precedents `__screenshots__/*/[mock-]*.mjs`): scoped SCSS does not follow a moved DOM node (`.batch-bar` styles live under `.list-header`), and raw `mat-icon` elements need `class="mat-icon notranslate material-symbols-outlined"` to render the ligature font.
