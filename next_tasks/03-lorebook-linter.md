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
- **E2E layout**: specs live in `e2e/*.spec.ts`; fixtures live in `example_card/` (the Fate/Stay Night lorebook is the precedent, read at module load and uploaded through the real import picker). Playwright projects: `desktop-chrome`, `mobile-chrome` (Pixel 7), `mobile-safari` (iPhone 14); phone-pinned tests skip on the desktop project by design. Icons are Material Symbols Outlined (app.config.ts) — `health_and_safety` is available at the font-family level, but NOT in the app's self-hosted subset (the woff2 is pre-built by `scripts/refresh-icons.mjs` scanning `src/`); the UI phase must run `npm run icons:refresh` after adding new icon markup (see §3.6.7).

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
- **`e2e/linter.spec.ts`** (Tier 3, qa-auditor): **authors a new fixture** `example_card/linter-demo.lorebook.json` — `example_card/` does not contain it at planning time; ST-native format so it exercises the real import path — containing all five defect classes; import → open linter from topbar → assert counts/messages → click-through selects the entry in the editor → fix one invalid regex via the entry editor → badge count drops on recompute. One `mobile-chrome` run asserting the bottom-sheet variant via the More menu.

### 3.5 Visual baseline & comparison protocol (P3a → P3b)

No automated visual-diff exists in this repo, so the UI phase carries a manual one:

- **Before (P3a, prior to any UI code)**: full-page screenshots of every surface P3b touches — topbar with a project open at desktop (≥1280), tablet (768–1279), and mobile (390×844) widths; More menu open; one existing dual-container pane (About: dialog on desktop, sheet on mobile) as the pattern reference; the entry editor. Stored under `__screenshots__/linter/before/` (already gitignored — the pattern is `__screenshots__/` with a trailing double underscore, `.gitignore:40`).
- **After (P3b close)**: the same set — unchanged surfaces must be pixel-comparable, proving the change is additive (only the new linter affordance appears) — plus the new surfaces: badge states (0, n), linter dialog with seeded defects, sheet on mobile, empty state. Stored under `__screenshots__/linter/after/`.
- **Comparison**: side-by-side before/after posted to the user in the P3b phase report. The baseline doubles as design-input: P3a's spec is drawn against the real current chrome, not memory.
- **Pinned capture conditions — identical for both sets**: same browser (Playwright chromium), fixed viewports (1280×800 desktop, 1024×768 tablet, 390×844 mobile), one explicit theme (`theme.setMode('light')`, never system), the same seeded project state for every shot (deterministic fixture loaded through the real import path), settled rendering (network idle, animations/transitions finished) before each capture. Without pinned conditions the diff shows theme/timing noise, not the feature.
- This is the task's instance of the repo-wide rule: **any task that adds or reshapes a visual feature captures before/after screenshots this way** (`AGENTS.md` → Visual Feature Baseline; `next_tasks/README.md` → Shared Conventions).

### 3.6 Approved UI design + linter-preferences addendum (P3a — user-approved 2026-09-19)

> Recorded verbatim-in-substance from the P3a spec (`__screenshots__/linter/design-spec.md`, gitignored working copy).
> **P3b implements THIS section; where it extends §3.3's skeleton, §3.6 wins.** Baseline evidence:
> `__screenshots__/linter/before/` — 8 PNGs captured 2026-09-19 against `feature/03-lorebook-linter` @ `8d31859`
> under the §3.6.6 pinned conditions (light theme, Fate fixture, 1280×800 / 1024×768 / 390×844).

#### 3.6.1 Entry points

- **Topbar** (`topbar.html`, project-gated row, immediately after Search & replace, before the ≥1280px focus toggle): `matIconButton` `desktop-only`, icon `health_and_safety`. Badge sits on the `<mat-icon>` — the history-button shape (`topbar.html:331-335`) — with the **numeric** count: `[matBadge]="linter.issueCount() || null"` `matBadgeColor="warn"` `[matBadgeHidden]="!linter.issueCount()"` (count, not `'!'`: the number says how much work is waiting; hidden at 0 so a clean book adds no chrome). Tooltip + aria-label: `Health check`.
- **More menu**: item `Health check…` with `health_and_safety` icon, directly **after "Search & replace…"** (the two authoring-quality tools sit together). Universal — on phones this is the only reach into the linter; the mobile bottom bar is **not** extended (5 items is its cap).
- **Opener** — the `openAbout()` shape, lazy-loaded at the call site:
  `openResponsive(LinterDialog, { dialog: { width: '100%', maxWidth: 'min(94vw, 720px)', panelClass: 'app-linter-dialog', ariaLabel: 'Lorebook health check' }, sheetPanelClass: 'app-linter-sheet', sheetConfig: { ariaLabel: 'Lorebook health check' } })`.

#### 3.6.2 Pane layout (one component, About exemplar — self-painted header, no `mat-dialog-title/content` wrappers)

- **Header** (sticky, never scrolls): `health_and_safety` icon in `--mat-sys-on-surface-variant`, title `Health check` (`--mat-sys-title-large`), 48px close button. Below: the summary line `role="status"` — `N errors · N warnings · N notes`, pluralized, all three counts always shown (`0 errors · 0 warnings · 2 notes`). The dialog reads `LinterState.diagnostics` live (recompute cadence = TokenMeter precedent); **no refresh button** — re-run is automatic.
- **Body**: single scroll container. Sections in fixed order **Errors → Warnings → Notes** (matches `lintBook`'s severity sort; empty sections don't render); `h3` headings (`--mat-sys-label-large`, `--mat-sys-on-surface-variant`, count `(n)`); hairline `--mat-sys-outline-variant` dividers between sections. The `info` noun is **Notes** everywhere (summary, headings).
- **Desktop dialog**: `min(94vw, 720px)` wide, definite height `min(78dvh, 640px)` on the surface (`.app-linter-dialog .mat-mdc-dialog-surface`, global overlay stylesheet; `.app-about-dialog` precedent `styles.scss:195`) so the header stays sticky over a deterministic scroll.
- **Mobile sheet** (<768px, via More menu): `.app-linter-sheet .mat-bottom-sheet-container` — 88dvh, 28px top radius, padding 0 (`.app-batch-sheet` precedent `styles.scss:217`). Same component/DOM; the Go-to action reflows onto its own line under the details; chips wrap; summary drops to `--mat-sys-body-medium` defensively.
- **Touch floors**: 44px minimum everywhere (the global ≤767px rule already raises buttons to 48px on phones); jump chips get `min-height: var(--touch-target-min)` explicitly (they are not standard chips).

#### 3.6.3 Severity icon + color mapping (`--mat-sys-*` only — M3 web ships no warning role)

| Severity | Icon | Color | Tonal use |
|---|---|---|---|
| error | `error` | `--mat-sys-error` | chips: `error-container` / `on-error-container` |
| warning | `warning` | `--ls-warning` (new derived token — approved R2) | chips: `--ls-warning-container` + `--mat-sys-on-surface` |
| info | `info` | `--mat-sys-on-surface-variant` | none — deliberately the quietest role; emphasis is spent on errors |

`--ls-warning` / `--ls-warning-container` are defined once in `styles.scss` `:root` via `color-mix` (the `--ls-diff-*` precedent, `styles.scss:118-131`), so they track both themes; no raw hex in component styles. Badge `matBadgeColor="warn"` maps to the theme's warn hue — the same association the history badge uses.

#### 3.6.4 Row anatomy + copy

- 40px icon slot (24px icon, top-aligned, `aria-hidden` — the section grouping already announces severity); message = `lintBook`'s `message` **verbatim** (the core already emits complete entry-named sentences); `details` = body-small muted (`--mat-sys-on-surface-variant`) monospace line for keys/cycle paths, `overflow-wrap: anywhere`; entry chips = tonal `secondary-container`, 28px, decorative, one per `entryIds` member showing `entryTitle()`.
- **Actions**: single-entry rows → trailing text button `Go to entry` (aria `Go to entry: {title}`) → `workspace.openEntry(entryId)` + close the live ref. Multi-entry rows (duplicates, cycles) → **the chips themselves are the jump buttons** (approved R1): one named target per entry, `aria-label="Go to entry {title}"`, instead of N identical buttons that would all jump to one member. Zero-entry rows (the perf-guard note) → icon + message only, no affordance to click into nothing.
- **Empty state**: `verified` icon (32px, `--mat-sys-on-surface-variant`) + `No issues found — lorebook looks healthy.` (plan copy kept). Rows never offer "Fix" — the linter only diagnoses; repair stays in the delimiter/entry-editor flows.
- Copy: title/tooltip/menu item all say `Health check` (one name for the whole flow); row messages quoted verbatim from `linter.ts` @ `8d31859` (full table in the design-spec working copy §5).

#### 3.6.5 User amendment (2026-09-19): per-issue ignore + rule mute, persisted in the `.stproj` archive

Approved verbatim rationale: *"make sure that it's possible to mark an issue as 'ignored' or 'Not an issue' and some mat chips to configure which kind of warning / error to warn about, because the user may know what they're doing."* Persistence decision (user): **the `.stproj` archive — explicitly chosen to avoid the ST JSON contract.**

1. **Core identity + options (P2b, `core/services/linter.ts`)**:
   - `lintDiagnosticSignature(d: LintDiagnostic): string` — deterministic across runs/restarts, derived from `rule` + `entryIds` + `details`; the persistence key for ignores.
   - `lintBook(book, options?: LintOptions)` with `LintOptions { ignored?: ReadonlySet<string>; mutedRules?: ReadonlySet<LintRuleId> }`. `ignored` drops exactly those signatures (near-misses stay); `mutedRules` skips those rules at emission (muting `recursion-cycle` also silences the book-level skip note — coherent, pinned by test). **`lintBook(book)` with no options stays byte-identical** — the existing suite passes unchanged.
2. **Persistence (P2b, model + archive)**: `ProjectWorkspace.lintPrefs?: { ignoredSignatures: string[]; mutedRules: LintRuleId[] }` (lorebook.model.ts). Rides IndexedDB persistence and `exportProject` wholesale; `isProjectWorkspace` validates/sanitizes (invalid rule ids dropped, absent field loads unchanged); **no archive version bump** — optional both ways, old/new archives interoperate. ST-facing exports (`exportCharacterBook`, `exportStNative`, split exports) and entry `content` stay byte-identical; `ProjectCommit.snapshot` untouched (prefs are workspace metadata, not book state — rollbacks don't touch them). Old-vs-new contract (user-signed 2026-09-19): a `.stproj` of a linter-using project gains `workspace.lintPrefs`; ST JSON exports never change.
3. **UI additions**: a chip row in the dialog for rule mute — one chip per rule id **present in the unfiltered pass** (muted rules stay visible as muted chips so they can be re-enabled), labels humanized: Invalid regex · Duplicate keys · Ignored secondary keys · Selective without secondary · Never activatable · Recursion cycles · Self-triggers · Malformed wrappers. Every row gains a `Not an issue` affordance (icon button `do_not_disturb_on`, tooltip `Not an issue`) that adds the row's signature to `ignoredSignatures`. When `ignoredSignatures` is non-empty, a footer line renders: `N issues marked not-an-issue` + text button `Undo all` (per-issue undo is out of scope this task).
4. **LinterState owns the sets**: reads/writes `project.lintPrefs` through `WorkspaceService.mutateProject`, passes both sets into `lintBook`, and derives `issueCount` from the **filtered** result (muted/ignored issues never light the badge).

#### 3.6.6 Capture protocol (P3b reproduces the before-set byte-identically)

Script `__screenshots__/linter/capture.mjs <before|after>`; dev server `npm start -- --port 4301`; Playwright chromium only, fresh context per viewport, `deviceScaleFactor: 1`, `locale: 'en-US'`, `timezoneId: 'UTC'`; viewports 1280×800 / 1024×768 / 390×844 set explicitly (never project device defaults); theme LIGHT pinned twice (`context.addInitScript` seeds `localStorage['lorestitch-theme'] = 'light'` pre-boot + context `colorScheme: 'light'`); fixture `example_card/Fate Stay Night - Fuyuki Lorebook(1).json` (70 entries) through the real import path (welcome → Import → filechooser → wait More-menu visible + `.entries-sidenav`); settle = landmark wait + `document.fonts.ready` + double rAF + import snackbar dismissed + 400–600ms. Accepted variance: History panel relative timestamps/SHAs. **After-set**: all 8 before shots re-taken (unchanged surfaces must be pixel-comparable) + badge 0/n states, linter dialog desktop with seeded defects, linter sheet mobile, empty state, mute-chips row, ignored-footer state.

#### 3.6.7 Corrections to earlier sections (drift found at P3a)

- §3.5 path spelling fixed (gitignored pattern is `__screenshots__/`, double underscore).
- §2 icon claim annotated: `health_and_safety` needs `npm run icons:refresh` (same for `verified`, `do_not_disturb_on`) before it renders.
- The history-badge precedent sits on the `<mat-icon>`, not the `<button>` — §3.6.1 restores that placement.

## 4. Implementation Plan

| Phase | Files | Work |
|-------|-------|------|
| **P1 — Shared semantics modules** (core-engine) | `core/models/st-regex.ts` + spec, `core/models/st-key-match.ts` + spec | §3.1, fidelity-tested against `sillytaver-world-info-doc/world-info.js` |
| **P2 — Linter core** (core-engine) | `core/services/linter.ts` + spec | §3.2 rules (incl. `malformed-wrapper` via `core/models/delimiters.ts`), recursion graph, perf guard, immutability test |
| **P3a — UI design proposal + baseline** (ui-specialist) | no `src/` changes; design spec + `__screenshots__/linter/before/` | ✅ Done — approved 2026-09-19 with the §3.6.5 amendment; recorded as §3.6 |
| **P2b — Ignore/mute addendum** (core-engine) | `core/services/linter.ts` + spec (signature + `LintOptions`), `core/models/lorebook.model.ts` + spec (`ProjectWorkspace.lintPrefs`, `isProjectWorkspace` sanitize), `core/services/import-export.service.ts` + spec (archive round-trip) | §3.6.5 user amendment; two atomic commits: `feat(linter): support ignored issues and muted rules in lintBook`, `feat(core): persist lint preferences in the project workspace archive`; ST-facing exports stay byte-identical |
| **P3b — Diagnostic UI** (ui-specialist) | `features/linter/linter-state.ts` + spec, `features/linter/linter-dialog.ts/.html/.scss/.spec.ts` (new), `features/shell/topbar/topbar.ts/.html/.scss/.spec.ts`, global overlay stylesheet (`app-linter-dialog` / `app-linter-sheet`) | §3.6 implementation of the approved design only — incl. the §3.6.5 mute chips, `Not an issue` affordance and `lintPrefs` wiring; closes with the §3.6.6 after-set + comparison |
| **P4 — Review** (ts-reviewer) | all touched | `extensions: Record<string, unknown>` access discipline (typed guards per `entry-activation.ts`, no `any`), computed purity, lint |
| **P5 — E2E + fixture** (qa-auditor) | `e2e/linter.spec.ts`, `example_card/linter-demo.lorebook.json` (new file) | Author the §3.4 fixture (five defect classes), then E2E incl. desktop + one mobile-chrome sheet run |

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
