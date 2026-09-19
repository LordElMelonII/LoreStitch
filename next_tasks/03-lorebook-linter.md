# Task 03 — Lorebook Health Linter & Validator

> **Source**: `ROADMAP.md` → MEDIUM PRIORITY → *"Lorebook Health Linter & Validator"*
> **Type**: New feature (pure diagnostic core + diagnostic modal)
> **Suggested agents**: `core-engine` (lead) → `ui-specialist` → `ts-reviewer` → `qa-auditor`
> **Depends on**: Task 02's `openResponsive`/bottom-sheet pattern for the modal (or implement the dual-ref shape directly if 02 hasn't landed).
> **Produces**: shared ST-regex + key-matching core modules that Task 04 reuses.

---

## 1. Objective

Give authors a one-click health check that surfaces the four silent failure classes SillyTavern never reports: duplicate/colliding primary keys, orphaned secondary keys, circular recursion loops, and invalid regex syntax in trigger keys. The scanner is a **pure, read-only** core function (it must never mutate the book — lossless invariant); the UI is a severity-grouped diagnostic modal that jumps to the offending entry.

## 2. Current State (code audit, `develop` @ `4120bb9`)

- **Greenfield**: no `linter.service.ts`, no diagnostics anywhere. `src/app/core/services/` contains only import-export, sha256, storage, theme, token-estimator, vcs, workspace.
- **Model** (`src/app/core/models/lorebook.model.ts`): editing shape `CharacterBookEntry` (`keys`, `secondary_keys?`, `selective?`, `constant?`, `enabled`, `case_sensitive?`, `extensions: Record<string, unknown>`) and typed `EntryExtensions` (lines ~1206–1241) with `exclude_recursion`, `prevent_recursion`, `delay_until_recursion`, `probability`, `vectorized`, `automation_id`, `triggers`, `group`, `match_*` flags. Helpers exist: `entryTriggerState()`, `entryTriggers()`, `entryTitle()`, `ST_LOGIC`/`ST_LOGIC_OPTIONS`.
- **Only regex code in the app**: `features/search-replace/search-replace.model.ts` → `escapeRegExp()` + `compileSearchPattern()` (try/catch → `null`, surfaced as `patternError` computed) — the UX precedent for inline regex errors, but **no `/pattern/flags` ST-key parsing exists anywhere**.
- **Authoritative ST semantics are vendored in-repo**: `sillytaver-world-info-doc/world-info.js` + `worldinfo.md`:
  - `parseRegexFromString` (world-info.js ~2821–2846): key is a regex iff it matches `/^\/([\w\W]+?)\/([gimsuy]*)$/` with no unescaped inner `/`; `\\/` unescapes; compiled in try/catch, `null` on failure (**ST silently ignores invalid regexes**).
  - `matchKeys` (~337–366): regex keys are tested first and **override case-sensitivity/whole-word options**; plaintext matching is case-insensitive unless `caseSensitive` (global default false); whole-word single-word keys use `(?:^|\W)(word)(?:$|\W)`; multi-word keys use `includes`.
  - Recursion (worldinfo.md ~395–404): entries activate others **when their `content` mentions the other's keywords**; `excludeRecursion` = cannot be activated by other entries; `preventRecursion` = once activated, triggers nothing further; `delayUntilRecursion` = only reachable in recursive passes.
- **Dialog exemplars**: `search-replace-dialog.ts` (live computed rows over `workspace.entries()`), `delimiter-dialog.ts` (Signal Forms + preview), `about-dialog.ts` (dual dialog/bottom-sheet refs).
- **Test conventions**: Vitest globals, TestBed with standalone imports, `workspace.activeProject.set({...})` seeding + `await fixture.whenStable()`, protected-member access via `component['member']()`, pure-model specs beside the model.

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

(Single-word whole-word keys → `(?:^|\W)escaped(?:$|\W)`; multi-word → `includes`; case-folded unless `caseSensitive`.)

### 3.2 `src/app/core/services/linter.service.ts` — pure, deterministic, read-only

```ts
export type LintSeverity = 'error' | 'warning' | 'info';
export type LintRuleId =
  | 'invalid-regex' | 'duplicate-key' | 'secondary-keys-ignored'
  | 'selective-without-secondary' | 'never-activatable'
  | 'recursion-cycle' | 'self-trigger';
export interface LintDiagnostic {
  rule: LintRuleId;
  severity: LintSeverity;
  entryIds: number[];        // CharacterBookEntry.id (workspace guarantees ids; fall back to array index)
  message: string;           // human sentence, entryTitle()-based
  details?: string;          // e.g. the duplicated key string, or the cycle path "A → B → A"
}
export function lintBook(book: CharacterBook): LintDiagnostic[];   // sorted: severity → entry order
```

Follows the `token-estimator.ts` precedent (pure functions in a `@Service()`-decorated class file; no Angular Material imports — core invariant).

**Rules:**

| Rule | Severity | Condition | Suppressions / nuances |
|------|----------|-----------|--------------------------|
| `invalid-regex` | error | `isRegexShapedKey(key) && !isValidStRegex(key)` on any primary/secondary key | none — ST silently drops the key |
| `duplicate-key` | warning | same primary key on 2+ *enabled* entries, compared case-insensitively when neither entry sets `case_sensitive` (ST default) | entries sharing a non-empty `extensions.group` → downgrade to info (group scoring is *supposed* to compete); exact-case duplicates when both `case_sensitive` stay warning |
| `secondary-keys-ignored` | warning | `secondary_keys?.length && (constant \|\| !selective)` | constant entries ignore *all* keys; non-selective entries ignore secondary keys |
| `selective-without-secondary` | info | `selective && !secondary_keys?.length` | harmless but usually unintended |
| `never-activatable` | warning | `!constant && keys` empty/blank | suppressed when an alternate activation source exists: `extensions.vectorized`, `extensions.automation_id`, `entryTriggers()` non-empty, any `match_*` flag true |
| `recursion-cycle` | warning | directed cycle (SCC size > 1) in the recursion graph | see below |
| `self-trigger` | info | entry's own content matches its own keys | self-edge of the graph, reported separately (common intentional pattern) |

**Recursion graph** (edges = "A's content could recursively activate B"):

- Edge A→B exists iff: A `.enabled` && !A`.prevent_recursion` (source can propagate) && B `.enabled` && !B `.constant` && !B `.exclude_recursion` (target is recursion-activatable) && B has usable keys && `B.keys.some(k => matchStKey(k, A.content, { caseSensitive: B.case_sensitive, matchWholeWords: B.extensions.match_whole_words }))`.
- Whole-entry content is scanned (conservative **superset** of ST's `scan_depth` message window — document this in the diagnostic copy: "may activate during recursion").
- Cycle detection: Tarjan SCC over the adjacency map; emit each SCC ≥2 once with the entry-title path in `details`. Complexity O(V·E) key-tests worst case — acceptable offline (hundreds of entries); memoize per `(keySet, contentHash)` within a run if profiling demands.

### 3.3 Diagnostic UI — `src/app/features/linter/`

- `linter-dialog.ts/.html/.scss/.spec.ts` — dual-container component (dialog ≥768px via Task 02's `openResponsive`; bottom sheet on mobile, sheet height ~88dvh). No `mat-dialog-*` sections if that conflicts with sheet mode; self-painted header like `about-dialog.ts`.
- Content: summary header (`2 errors · 5 warnings · 3 notes` + re-run is automatic via `computed(lintBook)` over `workspace.entries()` — no manual refresh); sections by severity; each row = severity icon (`error`/`warning`/`info`), rule message, entry chips; **"Go to entry"** action → `workspace` selects the entry (same mechanism the entry list uses) and the dialog closes.
- Empty state: "No issues found — lorebook looks healthy."
- Entry point: topbar icon button (`health_and_safety`) with a **count badge** (`computed` over the same lint result; suppress badge when 0 errors+warnings) — desktop-visible icon, mobile via More-vert menu (matches topbar's existing responsive conventions).
- Optional nicety (only if cheap): warning dot on entry-list rows that appear in any error/warning diagnostic.

### 3.4 Test plan

- **`st-regex.spec.ts` / `st-key-match.spec.ts`** (core-engine): table-driven against the vendored ST source behavior — valid/invalid flags, unescaped inner slash, `\\/` unescaping, `\x01` markers allowed, case folding, whole-word single vs multi-word.
- **`linter.service.spec.ts`**: one fixture book per rule + suppressions (group downgrade, vectorized suppression, `case_sensitive` duplicates); cycle fixtures (A→B→A, 3-cycle, self-loop, `prevent_recursion` breaking a would-be cycle, `exclude_recursion` target).
- **`linter-dialog.spec.ts`**: seeding per test conventions, severity grouping render, jump-to-entry wiring, sheet-mode instantiation.
- **`e2e/linter.spec.ts`**: craft `e2e/fixtures/linter-demo.lorebook.json` (or place alongside existing reference files in `example_card/`) containing all four defect classes; import → open linter → assert counts/messages → click-through selects the entry → fix one invalid regex via entry editor → badge count drops on recompute.
- **Round-trip guard**: test that `lintBook` never mutates its input (deep-freeze fixture, post-run structural equality) — protects the lossless invariant.

## 4. Implementation Plan

| Phase | Files | Work |
|-------|-------|------|
| **P1 — Shared semantics modules** (core-engine) | `core/models/st-regex.ts` + spec, `core/models/st-key-match.ts` + spec | §3.1, fidelity-tested against `sillytaver-world-info-doc/world-info.js` |
| **P2 — Linter core** (core-engine) | `core/services/linter.service.ts` + spec | §3.2 rules, graph, immutability test |
| **P3 — Diagnostic UI** (ui-specialist) | `features/linter/*` (new), `topbar.ts/.html/.scss`, `topbar.spec.ts` | §3.3 modal + entry point + badge |
| **P4 — Review** (ts-reviewer) | all touched | `extensions: Record<string, unknown>` access discipline (typed guards, no `any`), signal purity, lint |
| **P5 — E2E + fixture** (qa-auditor) | `e2e/linter.spec.ts`, fixture JSON | §3.4 E2E incl. desktop + one mobile sheet run |

P1→P2 sequential; P3 can start once P2's interface (§3.2) is frozen — parallelize P3 with P2's tail if desired.

## 5. Orchestration

1. **`core-engine`** (skills: `typescript-advanced-types`, `angular-developer`) — P1+P2. Hard constraints: pure functions, no UI imports in `core/`, never drop/mutate vendor fields, `world-info.js` is the semantic oracle. *Gate: `npm test` green; spec suite covers every rule + suppression.*
2. **`ui-specialist`** (skills: `angular-developer`, `material-3`, `frontend-design`) — P3. Standalone OnPush, signals/computed only (lint result as `computed(() => lintBook(book))` — pure, memoized), M3 tokens, dual container per Task 02 pattern, 44px touch floors; lint-rule wording and severity surfaces follow the frontend-design copy rules. *Gate: `npm test` + `npm run build`.*
3. **`ts-reviewer`** (skills: `typescript-advanced-types`) — P4. *Gate: `npm run lint`, zero new `any`/non-null assertions.*
4. **`qa-auditor`** (skills: `playwright-cli`) — P5. Coverage thresholds, E2E on desktop + mobile projects. *Gate: `npx playwright test linter`, `ng test --coverage`.*

Orchestrator freezes the §3.2 public interface before dispatching P3 (it's the contract between core-engine and ui-specialist).

## 6. Verification Gates

`npm run build` · `npm test` · `ng test --coverage` (st-regex, st-key-match, linter.service, linter-dialog all covered) · `npx playwright test linter round-trip` (round-trip must stay green — proof the feature didn't touch serialization) · `npm run lint`.

## 7. Risks & Open Questions

1. **ST fidelity drift**: our port could diverge from future ST versions. Mitigation: cite `world-info.js` line references in code comments and keep the parser a single small module; the vendored doc is the test oracle.
2. **Recursion false positives**: full-content matching ignores `scan_depth` and message-window semantics → cycles that ST would never hit at runtime. Accepted: diagnostic copy says "may", severity is warning (not error), and `scan_depth` is honored per-entry when set (`extensions.scan_depth` can bound content scanning if we choose — decide at P2 kickoff, default: ignore, document).
3. **Duplicate-key vs group nuance**: ST group semantics make same-group key duplication legitimate. If the downgrade-to-info heuristic proves noisy, invert to suppress entirely (tune in P5 with the real fixture).
4. **Perf on large books**: O(V²·k) worst case at import-scale (thousands of entries) — acceptable for on-demand linting + `computed` memoization; add a simple guard (skip rule with an inline note) above a threshold (e.g. >2,000 entries) if profiling demands.
5. **`entryIds` stability**: workspace assigns `id`; imported books without ids are normalized on import — confirm `normalizeImportedBook` guarantees ids before relying on them (P2 kickoff check; fallback = index-based identity within a lint run).
