# Task 03 — Lorebook Health Linter & Validator

> **Source**: `ROADMAP.md` → MEDIUM PRIORITY → *"Lorebook Health Linter & Validator"*
> **Type**: New feature (pure diagnostic core + diagnostic modal)
> **Suggested agents**: `core-engine` (lead) → `ui-specialist` → `ts-reviewer` → `qa-auditor`
> **Depends on**: Task 02 ✅ (landed 2026-09-18 — `ResponsiveOverlayService.openResponsive` dual-container pattern) and Task 05 ✅ (landed 2026-09-19 — `detectMalformedWrapper`, adopted here as a lint rule).
> **Produces**: shared ST-regex + key-matching core modules that Task 04 reuses.
> **Re-grounded**: `develop` @ `329509b` (2026-09-19). This audit supersedes the original `4120bb9` snapshot; drifted sections (§2, §3.2–§3.4) were refreshed.

---

## 1. Objective

Give authors a one-click health check that surfaces the silent failure classes SillyTavern never reports: duplicate/colliding primary keys, orphaned/ignored secondary keys, circular recursion loops, invalid regex syntax in keys, and malformed whole-content wrappers (adopted from Task 05, per `next_tasks/README.md`). The scanner is a **pure, read-only** core function (it must never mutate the book — lossless invariant); the UI is a severity-grouped diagnostic modal that jumps to the offending entry.

## 2. Current State (code audit, `develop` @ `329509b`)

- **Greenfield for linting**: no linter code anywhere. `src/app/core/services/` holds import-export, sha256, storage, theme, token-estimator, vcs, workspace. **Naming convention observed at HEAD**: injectable classes get the `.service.ts` suffix + `@Service()` decorator (workspace, vcs, import-export…); pure analysis modules get a bare name and no decorator (`sha256.ts`, `token-estimator.ts` — exported functions only). The linter core is pure ⇒ it lands as `linter.ts`, not `linter.service.ts`.
- **Model** (`src/app/core/models/lorebook.model.ts`): editing shape `CharacterBookEntry` (line 52: `id?: number`, `keys`, `secondary_keys?`, `selective?`, `constant?`, `enabled`, `case_sensitive?`, `extensions: Record<string, unknown>`) and typed `EntryExtensions` (line 1206: `exclude_recursion`, `prevent_recursion`, `delay_until_recursion`, `probability`, `vectorized`, `automation_id`, `triggers`, `group`, `scan_depth`, `case_sensitive`, `match_whole_words`, `match_*` flags). Helpers: `entryTitle()` (line 858), `entryTriggers()`/`entryTriggerState()`, `ST_LOGIC_OPTIONS`.
- **Entry ids are guaranteed in practice**: `normalizeImportedBook` (line 793) assigns `entry.id ?? nextId++` to every imported entry, and `WorkspaceService.nextEntryId()` assigns ids on creation. `id` stays optional in the type, so the linter still resolves `entry.id ?? index` defensively.
- **Only regex code in the app**: `features/search-replace/search-replace.model.ts` → `escapeRegExp()` + `compileSearchPattern()` (try/catch → `null`, surfaced as `patternError` computed) — the UX precedent for inline regex errors. **No `/pattern/flags` ST-key parsing exists anywhere.**
- **Authoritative ST semantics are vendored in-repo**: `sillytaver-world-info-doc/world-info.js` + `worldinfo.md`:
  - `parseRegexFromString` (world-info.js:2821): key is a regex iff it matches `/^\/([\w\W]+?)\/([gimsuy]*)$/` with no unescaped inner `/`; `\\/` unescapes; compiled in try/catch, `null` on failure (**ST silently ignores invalid regexes**).
  - `matchKeys` (world-info.js:337, `WorldInfoBuffer` method): regex keys are tested first and **override case-sensitivity/whole-word options**; plaintext matching is case-insensitive unless `caseSensitive` (global default false); whole-word single-word keys use `(?:^|\W)(word)(?:$|\W)`; multi-word keys use `includes`.
  - Recursion (worldinfo.md ~395–404): entries activate others **when their `content` mentions the other's keywords**; `excludeRecursion` = cannot be activated by other entries; `preventRecursion` = once activated, triggers nothing further; `delayUntilRecursion` = only reachable in recursive passes.
- **Task 02 landed — dual-container opener is canonical**: `src/app/shared/services/responsive-overlay.service.ts` exposes `openResponsive(component, { data?, dialog: MatDialogConfig, sheetPanelClass?, sheetConfig? })` → `MatDialogRef | MatBottomSheetRef`. Phones (`LayoutService.isMobile()`, < 768px — the single viewport truth) get a `MatBottomSheet` **only when `sheetPanelClass` is registered**; all other viewports get a `MatDialog`. Top-level `data` is canonical. The opened component adapts via `inject(MatDialogRef, { optional: true })` + `inject(MatBottomSheetRef, { optional: true })` — the `about-dialog.ts` exemplar. `anyOverlayOpen` hides the mobile FAB under any pane.
- **Topbar anatomy at HEAD** (`features/shell/topbar/topbar.ts/.html`): project-gated action row with `desktop-only` buttons (New entry `post_add`, Search `find_replace`), focus toggle ≥1280px, Export menu, More menu (Search & replace / Merge / Export / GitHub / Theme-mobile / About). **Badge precedent**: the history button uses `[matBadge]="… ? '!' : null" matBadgeColor="warn" [matBadgeHidden]="…"`; `MatBadgeModule` is already imported. `openAbout()` shows the lazy-load + `openResponsive` call shape. **Per-mutation full-book compute precedent**: `TokenMeter` runs `computeTokenFootprint` over the whole book in the template on every project signal change.
- **Task 05 landed — malformed wrappers**: `core/models/delimiters.ts` exports `detectMalformedWrapper(content, hints?)` (line 327; `MalformedWrapper` = `mismatched`/`orphan-open`/`orphan-close`), `malformedWrapperLabel()`, `stripMalformedWrapper()`, `entryDelimiterName()`/`entryDelimiterNameFromKey()`. Already surfaced per-entry by the `entry-content-field` badge with hint chain `[entryDelimiterName(entry), entryDelimiterNameFromKey(entry)]` (entry-content-field.ts:79) and in the delimiter dialog preview. `next_tasks/README.md` directs Task 03 to adopt the detector as a lint rule.
- **Jump-to-entry mechanism**: `WorkspaceService.openEntry(entryId)` (workspace.service.ts:375) — no-op for unknown ids, opens a tab if absent, sets `activeTabId`. This is the same mechanism the entry list uses.
- **Typing exemplar**: `features/entry-editor/entry-activation/` — typed reads of `extensions` via `EntryExtensions` guards (ts-reviewer's reference pattern, also cited by Task 04).
- **Test conventions**: Vitest globals, TestBed with standalone imports, `workspace.activeProject.set({...})` seeding + `await fixture.whenStable()`, protected-member access via `component['member']()`, pure-model specs beside the model. qa-auditor's **three-tier matrix**: Tier 1 pure model specs (no DOM), Tier 2 component specs, Tier 3 Playwright E2E with one mobile-viewport (390×844) pass.
- **E2E layout**: specs live in `e2e/*.spec.ts`; fixtures live in `example_card/` (the Fate/Stay Night lorebook is the precedent, read at module load and uploaded through the real import picker). Playwright projects: `desktop-chrome`, `mobile-chrome` (Pixel 7), `mobile-safari` (iPhone 14); phone-pinned tests skip on the desktop project by design. Icons are Material Symbols Outlined (app.config.ts) — `health_and_safety` is available.

## 3. Design

### 3.1 New shared core modules (justified addition beyond ROADMAP's "Where" — needed by Task 04 too)

**`src/app/core/models/st-regex.ts`** — faithful port of ST's parser (framework-free, pure):

```ts
export interface StRegex { source: string; flags: string; regex: RegExp; }
/** Mirrors world-info.js parseRegexFromString: returns null when not /body/flags-shaped OR invalid. */
export function parseStRegex(key: string): StRegex | null;
export function isRegexShapedKey(key: string): boolean;   // matches /^\/.+\/[gimsuy]*$/ shape (even if uncompilable)
export function isValidStRegex(key: string): boolean;     // shaped && parses
export function matchStRegex(key: string, text: string): boolean;
```

**`src/app/core/models/st-key-match.ts`** — ST `matchKeys` semantics for plaintext keys:

```ts
export interface StMatchOptions { caseSensitive?: boolean | null; matchWholeWords?: boolean | null; }
/** True when `key` would activate against `text` under ST rules (regex keys bypass options). */
export function matchStKey(key: string, text: string, options: StMatchOptions): boolean;
```

(Single-word whole-word keys → `(?:^|\W)escaped(?:$|\W)`; multi-word → `includes`; case-folded unless `caseSensitive`. Regex-shaped keys delegate to `parseStRegex` and ignore the options — mirroring ST.)

### 3.2 `src/app/core/services/linter.ts` — pure, deterministic, read-only

Bare module, no decorator — the `token-estimator.ts`/`sha256.ts` convention for pure analysis code (no Angular Material imports — core invariant).

```ts
export type LintSeverity = 'error' | 'warning' | 'info';
export type LintRuleId =
  | 'invalid-regex' | 'duplicate-key' | 'secondary-keys-ignored'
  | 'selective-without-secondary' | 'never-activatable'
  | 'recursion-cycle' | 'self-trigger' | 'malformed-wrapper';
export interface LintDiagnostic {
  rule: LintRuleId;
  severity: LintSeverity;
  entryIds: number[];        // resolved as entry.id ?? array index (ids are guaranteed post-normalization; fallback is type-defensive)
  message: string;           // human sentence, entryTitle()-based
  details?: string;          // e.g. the duplicated key string, the cycle path "A → B → A", or malformedWrapperLabel(...)
}
export function lintBook(book: CharacterBook): LintDiagnostic[];   // sorted: severity (error → warning → info) → entry order
```

**Rules:**

| Rule | Severity | Condition | Suppressions / nuances |
|------|----------|-----------|--------------------------|
| `invalid-regex` | error | `isRegexShapedKey(key) && !isValidStRegex(key)` on any primary/secondary key | none — ST silently drops the key |
| `malformed-wrapper` | error (`mismatched`) / warning (orphans) | `detectMalformedWrapper(entry.content, [entryDelimiterName(entry), entryDelimiterNameFromKey(entry)])` non-null | exact hint chain of the `entry-content-field` badge ⇒ both surfaces classify identically; `details` = `malformedWrapperLabel(...)`; reported regardless of `enabled` (the defect ships in exported bytes); the linter diagnoses only — repair stays in the delimiter flow |
| `duplicate-key` | warning | same primary key on 2+ *enabled* entries, compared case-insensitively when neither entry sets `case_sensitive` (ST default) | entries sharing a non-empty `extensions.group` → downgrade to info (group scoring is *supposed* to compete); exact-case duplicates when both `case_sensitive` stay warning |
| `secondary-keys-ignored` | warning | `secondary_keys?.length && (constant \|\| !selective)` | constant entries ignore *all* keys (message says so); non-selective entries ignore secondary keys |
| `selective-without-secondary` | info | `selective && !secondary_keys?.length` | harmless but usually unintended |
| `never-activatable` | warning | `!constant && keys` empty/blank | suppressed when an alternate activation source exists: `extensions.vectorized`, `extensions.automation_id`, `entryTriggers()` non-empty, any `match_*` flag true |
| `recursion-cycle` | warning | directed cycle (SCC size > 1) in the recursion graph | see below |
| `self-trigger` | info | entry's own content matches its own keys | self-edge of the graph, reported separately (common intentional pattern) |

**Recursion graph** (edges = "A's content could recursively activate B"):

- Edge A→B exists iff: A `.enabled` && !A `.prevent_recursion` (source can propagate) && B `.enabled` && !B `.constant` && !B `.exclude_recursion` (target is recursion-activatable) && B has usable keys && `B.keys.some(k => matchStKey(k, A.content, { caseSensitive: B.case_sensitive, matchWholeWords: B.extensions.match_whole_words }))`.
- Whole-entry content is scanned (conservative **superset** of ST's `scan_depth` message window — document this in the diagnostic copy: "may activate during recursion").
- Cycle detection: Tarjan SCC over the adjacency map; emit each SCC ≥2 once with the entry-title path in `details`. Complexity O(V·E) key-tests worst case — acceptable offline (hundreds of entries).
- **Perf guard (concrete)**: above `LARGE_BOOK_THRESHOLD = 1500` entries the graph rules (`recursion-cycle`, `self-trigger`) are skipped and one `info` diagnostic notes the skip; the O(V·k) key rules always run. `matchStKey` input content is capped at 5,000 chars per test (same bound Task 04 sets for its playground) to bound catastrophic-pattern cost.

**Immutability**: `lintBook` never mutates its input — pinned by a deep-frozen-fixture spec (protects the lossless invariant; `token-estimator`/`delimiters` precedent).

### 3.3 Diagnostic UI — `src/app/features/linter/`

**`linter-state.ts`** — one shared reactive source (no RxJS):

```ts
@Service()
export class LinterState {
  private readonly workspace = inject(WorkspaceService);
  /** Single memoized lint pass shared by the topbar badge and the dialog. */
  readonly diagnostics = computed(() => {
    const project = this.workspace.activeProject();
    return project ? lintBook(project.activeBook) : [];
  });
  /** errors + warnings — drives the badge; info never counts. */
  readonly issueCount = computed(() => /* count of error+warning diagnostics */);
}
```

Recompute cadence matches the `TokenMeter` precedent (a full-book pure pass per project mutation). Root-provided, consumed cross-feature exactly like `ProjectActionsService`.

**`linter-dialog.ts/.html/.scss/.spec.ts`** — dual-container pane:

- Opened only through `openResponsive` (never a bare `MatDialog.open`): `dialog: { width: '100%', maxWidth: 'min(94vw, 720px)', panelClass: 'app-linter-dialog' }`, `sheetPanelClass: 'app-linter-sheet'`, `sheetConfig: { ariaLabel: 'Lorebook health check' }` — the `openAbout()` shape, lazy-loaded at the call site. Panel classes styled in the global overlay stylesheet (persona rule). Dual optional `MatDialogRef`/`MatBottomSheetRef` injections; dismiss whichever ref is live.
- Content: summary header (`2 errors · 5 warnings · 3 notes`); re-run is automatic — the dialog reads `LinterState.diagnostics` (computed), no manual refresh; sections by severity; each row = severity icon (`error`/`warning`/`info`), rule message, entry chips; **"Go to entry"** action → `workspace.openEntry(entryId)` + close the pane.
- Empty state: "No issues found — lorebook looks healthy."
- Rows are textual; the header + per-row Go-to buttons carry ARIA; 44px touch floors; sheet comfortable at ~88dvh with sticky header.

**Entry point — topbar** (`features/shell/topbar/topbar.ts/.html/.scss` + `topbar.spec.ts`):

- Inside the project-gated row, after Search: a `desktop-only` `matIconButton` (icon `health_and_safety` — confirmed in the registered Material Symbols Outlined set) with `[matBadge]="issueCount() || null" matBadgeColor="warn" [matBadgeHidden]="!issueCount()"` — exactly the history-button badge shape; tooltip "Health check".
- More menu gains "Health check…" (universal — phones reach it there), mirroring how Search & replace is mirrored. No project open ⇒ neither control renders (project-gated row).
- Optional nicety (only if cheap): warning dot on entry-list rows that appear in any error/warning diagnostic.

**Visual design is checkpointed before code**: P3a (§4) produces an annotated design spec + baseline screenshots and waits for user approval; P3b implements only the approved design. Lesson from Task 02 — its FAB design was implemented unreviewed and replaced by the M3 bottom bar after real-device feedback.

### 3.4 Test plan

- **`st-regex.spec.ts` / `st-key-match.spec.ts`** (Tier 1, core-engine): table-driven against the vendored ST source behavior — valid/invalid flags, unescaped inner slash, `\\/` unescaping, case folding, whole-word single vs multi-word, regex keys overriding options.
- **`linter.spec.ts`** (Tier 1, core-engine): one fixture book per rule + suppressions (group downgrade, vectorized suppression, `case_sensitive` duplicates, malformed-wrapper severities incl. disabled entries); cycle fixtures (A→B→A, 3-cycle, self-loop, `prevent_recursion` breaking a would-be cycle, `exclude_recursion` target); large-book threshold skip; **immutability guard** (deep-freeze fixture, post-run structural equality).
- **`linter-state.spec.ts` + `linter-dialog.spec.ts` + `topbar.spec.ts` additions** (Tier 2, ui-specialist): seeding per test conventions, severity grouping render, jump-to-entry wiring via `openEntry`, badge visibility/hiding at 0, sheet-mode instantiation (dual optional refs), More-menu item on mobile layout.
- **`e2e/linter.spec.ts`** (Tier 3, qa-auditor): fixture `example_card/linter-demo.lorebook.json` (ST-native format so it exercises the real import path) containing all five defect classes; import → open linter from topbar → assert counts/messages → click-through selects the entry in the editor → fix one invalid regex via the entry editor → badge count drops on recompute. One `mobile-chrome` run asserting the bottom-sheet variant via the More menu.

### 3.5 Visual baseline & comparison protocol (P3a → P3b)

No automated visual-diff exists in this repo, so the UI phase carries a manual one:

- **Before (P3a, prior to any UI code)**: full-page screenshots of every surface P3b touches — topbar with a project open at desktop (≥1280), tablet (768–1279), and mobile (390×844) widths; More menu open; one existing dual-container pane (About: dialog on desktop, sheet on mobile) as the pattern reference; the entry editor. Stored under `__screenshots/linter/before/` (already gitignored).
- **After (P3b close)**: the same set — unchanged surfaces must be pixel-comparable, proving the change is additive (only the new linter affordance appears) — plus the new surfaces: badge states (0, n), linter dialog with seeded defects, sheet on mobile, empty state. Stored under `__screenshots/linter/after/`.
- **Comparison**: side-by-side before/after posted to the user in the P3b phase report. The baseline doubles as design-input: P3a's spec is drawn against the real current chrome, not memory.

## 4. Implementation Plan

| Phase | Files | Work |
|-------|-------|------|
| **P1 — Shared semantics modules** (core-engine) | `core/models/st-regex.ts` + spec, `core/models/st-key-match.ts` + spec | §3.1, fidelity-tested against `sillytaver-world-info-doc/world-info.js` |
| **P2 — Linter core** (core-engine) | `core/services/linter.ts` + spec | §3.2 rules (incl. `malformed-wrapper` via `core/models/delimiters.ts`), recursion graph, perf guard, immutability test |
| **P3a — UI design proposal + baseline** (ui-specialist) | no `src/` changes; design spec + `__screenshots/linter/before/` | §3.3 visual design as an annotated spec (dialog + sheet layouts, severity icon/color mapping on `--mat-sys-*` tokens, badge treatment, row anatomy, complete copy incl. empty state) drawn against the §3.5 baseline screenshots; **user approval checkpoint** |
| **P3b — Diagnostic UI** (ui-specialist) | `features/linter/linter-state.ts` + spec, `features/linter/linter-dialog.ts/.html/.scss/.spec.ts` (new), `features/shell/topbar/topbar.ts/.html/.scss/.spec.ts`, global overlay stylesheet (`app-linter-dialog` / `app-linter-sheet`) | §3.3 implementation of the approved design only; closes with the §3.5 after-set + comparison |
| **P4 — Review** (ts-reviewer) | all touched | `extensions: Record<string, unknown>` access discipline (typed guards per `entry-activation.ts`, no `any`), computed purity, lint |
| **P5 — E2E + fixture** (qa-auditor) | `e2e/linter.spec.ts`, `example_card/linter-demo.lorebook.json` | §3.4 E2E incl. desktop + one mobile-chrome sheet run |

P1→P2 sequential; P3a can start once P2's interface (§3.2) is frozen — parallelize P3a with P2's tail if desired; **P3b starts only after P3a's design is user-approved**. Suggested phase commits: `feat(core): add ST regex and key-matching semantics modules`, `feat(linter): add lorebook health linter core`, `docs(next_tasks): record approved linter UI design` (P3a close — the approved spec is appended to this file, the Task 02 amendment precedent, so it survives the session), `feat(linter): add health-check modal and topbar entry point`, `test(e2e): cover lorebook linter flows`; close-out `docs(next_tasks): mark task 03 completed`.

## 5. Orchestration

1. **`core-engine`** (skills: `typescript-advanced-types`, `angular-developer`) — P1+P2. Hard constraints: pure functions, no UI imports in `core/`, never drop/mutate vendor fields, `world-info.js` is the semantic oracle (cite line refs in comments). *Gate: `npm test` green; spec suite covers every rule + suppression + the immutability guard.*
2. **`ui-specialist`** (skills: `frontend-design`, `material-3`, `angular-developer`) — P3a, then P3b. **P3a**: capture the §3.5 baseline, author the design spec, post it to the user, stop. *Gate: explicit user approval of the design — the pipeline does not advance on an unreviewed visual design.* **P3b**: build the approved design — standalone OnPush, signals/computed only, M3 tokens, dual container strictly via `openResponsive`, 44px touch floors, frontend-design copy rules; close with the after-set and before/after comparison. *Gate: `npm test` + `npm run build` + comparison delivered.*
3. **`ts-reviewer`** (skills: `typescript-advanced-types`) — P4. *Gate: `npm run lint`, zero new `any`/non-null assertions.*
4. **`qa-auditor`** (skills: `playwright-cli`) — P5. Three-tier matrix, coverage thresholds, E2E on desktop + mobile projects; its pre-handoff checklist is the final gate. *Gate: `npx playwright test linter`, `ng test --coverage`.*

The orchestrator freezes the §3.2 public interface before dispatching P3 (it is the contract between core-engine and ui-specialist); if P2 ships a deviation, reconcile the plan and P3 prompt before dispatch. Before dispatching any phase, re-verify the phase's file list at current HEAD (Re-grounding rule) and confirm `AngularMCP` availability before citing it to subagents.

## 6. Verification Gates

`npm run build` · `npm test` · `ng test --coverage` (st-regex, st-key-match, linter, linter-state, linter-dialog, topbar additions all covered) · `npx playwright test linter round-trip` (round-trip must stay green — proof the feature didn't touch serialization) · `npm run lint` · §3.5 before/after screenshot comparison delivered at P3b close.

## 7. Risks & Open Questions

1. **ST fidelity drift**: our port could diverge from future ST versions. Mitigation: cite `world-info.js` line references in code comments and keep the parser a single small module; the vendored doc is the test oracle.
2. **Recursion false positives**: full-content matching ignores `scan_depth` and message-window semantics → cycles ST would never hit at runtime. Accepted: diagnostic copy says "may", severity is warning (not error); per-entry `extensions.scan_depth` bounding decided at P2 kickoff — default: ignore, document.
3. **Duplicate-key vs group nuance**: ST group semantics make same-group key duplication legitimate. If the downgrade-to-info heuristic proves noisy, invert to suppress entirely (tune in P5 with the real fixture).
4. **Perf on large books**: graph rules are O(V·E) key-tests worst case; the 1,500-entry threshold skip + 5,000-char match cap bound it. Badge recompute runs per project mutation — same cadence as the existing `TokenMeter` full-book pass, and a single memoized computed shared by badge + dialog avoids double work. Catastrophic user regexes remain the residual risk (same caveat as Task 04's ReDoS note) — acceptable at offline-lint scale.
5. ~~**`entryIds` stability**~~ **Resolved at re-grounding**: `normalizeImportedBook` (lorebook.model.ts:793) assigns ids to every imported entry and `WorkspaceService` assigns ids on creation; the `id ?? index` fallback stays purely as type defense.
6. **Malformed-wrapper double surfacing**: the entry editor badge (Task 05) and the linter both report it — by design (inline vs book-wide). Both call `detectMalformedWrapper` with the identical hint chain, so they can never disagree; the linter adds no repair path (cleanup stays in the delimiter flow).
7. **Manual visual regression**: the §3.5 protocol is human-reviewed evidence, not an enforced gate — no automated image diff exists in the repo. If the project later adopts Playwright `toHaveScreenshot`, the `__screenshots__/` baseline can graduate into real snapshot tests.
