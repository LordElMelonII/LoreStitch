# Task 04 — Regex Key Testing Sandbox

> **Source**: `ROADMAP.md` → MEDIUM PRIORITY → *"Regex Key Testing Sandbox"*
> **Type**: Feature extension of an existing editor section (entry keys) + two small core additions
> **Suggested agents**: `core-engine` (small) → `ui-specialist` (lead, design-gated) → `ts-reviewer` → `qa-auditor`
> **Depends on**: Task 03 ✅ (landed 2026-09-19 — `core/models/st-regex.ts` + `st-key-match.ts` exist at HEAD with fidelity specs; the dependency is satisfied, so this task no longer carries an absorb-Phase-1 clause).
> **Re-grounded**: `develop` @ `af244ba` (2026-09-20). This audit supersedes the original `4120bb9` snapshot; every drifted section (§2, §3, §4) was rewritten against HEAD.

---

## 1. Objective

Let authors verify activation keys — especially regex keys like `/(?:saber|artoria)/i` — **without spinning up SillyTavern**: every key chip gets live validity feedback (invalid regexes are flagged, because ST never warns about them), and an inline "Test keys" playground highlights which keys would match a sample text in real time, honoring the entry's case-sensitivity and whole-word settings exactly as ST would. The sandbox is the inline, per-entry complement to Task 03's book-wide health check; the linter finds the dead key, this task shows it dying in context.

## 2. Current State (code audit, `develop` @ `af244ba`)

- **Task 03's shared modules are at HEAD and are this task's foundation**:
  - `core/models/st-regex.ts` exports `parseStRegex(key): StRegex | null` (fresh `RegExp` per parse — stateful `g`/`y` flags can never leak between calls), `isRegexShapedKey`, `isValidStRegex`, `matchStRegex`; `StRegex = { source, flags, regex }`.
  - `core/models/st-key-match.ts` exports `matchStKey(key, text, options)` + `StMatchOptions { caseSensitive?, matchWholeWords? }` — nullish options resolve to ST's defaults (`false`).
  - Both are pure, framework-free, and fidelity-tested against the vendored oracle (`sillytaver-world-info-doc/world-info.js`).
- **Oracle ground truth for invalid regex keys** (world-info.js:337-366, re-verified for this audit): a `/…/`-shaped key that fails `parseRegexFromString` is **not dropped** — `matchKeys` falls through to plaintext matching of the raw key string (slashes included), honoring case/whole-word options. In prose the literal `/(saber/` essentially never occurs, so the key is effectively dead — but the accurate copy is *"treated as plain text"*, not "silently ignored". (The landed linter's `invalid-regex` copy says "silently drops the key" — see §8.6.)
- **Task 03's linter already flags invalid regex keys book-wide** (`invalid-regex` rule, error severity, health-check pane + badge). This task adds the inline per-chip signal; the detection predicate (`isRegexShapedKey && !isValidStRegex`) must stay identical on both surfaces — which is why classification moves into `st-regex.ts` (§3.1) instead of living beside the component.
- **`features/entry-editor/entry-keys/`** (`entry-keys.ts/.html/.scss/.spec.ts`): standalone signals component, `input.required<CharacterBookEntry>()`, a "Selective" `mat-chip-option`, Primary/Secondary `mat-chip-grid`s with `matChipInput` (Enter/comma separators), in-place double-click editing (`editingKey` signal, `afterRenderEffect` focus), a Secondary Logic `mat-select` bound to `extensions['selectiveLogic']`, and an `isConstant` computed that disables the Selective chip. Hosted by `EntryOptionsAccordion` between Placement and Activation; the options panel is **collapsed by default** (`EntryOptionsPanelState.expanded = signal(false)`, a studio-wide preference persisted across tabs).
- **Key writes** funnel through `EntryUpdatesService.addKey()` (`entry-updates.service.ts:143-155`): trims, rejects blank and exact-case duplicates within the same list; in-place edits go through `setKeys`. No regex awareness — and this task must not change that behavior (§3.2).
- **The activation options the sandbox honors live in sibling sections of the same accordion panel**: the `case_sensitive` chip in `entry-activation` (top-level entry field) and the `match_whole_words` **tri-state** select in `entry-matching-sources` (`extensions['match_whole_words']`; `null` = "Default (book setting)" → ST global default `false`). Both write the same workspace entry signal, so a panel `computed` recomputes live when either flips — no event plumbing needed.
- **No `MatExpansionModule` exists anywhere in `src/`** — the app's collapse idiom is `EntryOptionsAccordion`'s custom pattern: expand-toggle icon button (`expand_more`/`expand_less`), `[attr.aria-expanded]` + `[attr.aria-controls]` on a `panelId`, `.panel-anchor`/`.panel-clip` with `[inert]` when closed. The test panel reuses that idiom rather than importing a new Material module.
- **Regex-error UX precedent**: `search-replace-dialog.ts`'s `patternError` computed. **Tonal precedents**: linter rows/chips (`--mat-sys-error`, `error-container`/`on-error-container`); derived `--ls-warning`/`--ls-warning-container` tokens exist in `styles.scss` if a softer heads-up tone is wanted.
- **Icons are a pre-subsetted self-hosted woff2** (`public/fonts/material-symbols-outlined.woff2`, built by `scripts/refresh-icons.mjs` scanning `src/`). Every new ligature requires `npm run icons:refresh` **and staging the regenerated font with the feature commit** (Task 03 hit this: `health_and_safety` rendered as raw text until refreshed). New icons this task expects: `science` (panel header), `check_circle` (matched), `remove` (not-matched dash) — `error`, `cancel`, `expand_more`/`expand_less` are already in use.
- **Test conventions**: unit specs seed with `projectOf` (`src/testing/project-fixtures`) + `createEmptyEntry` and re-bind via `fixture.componentRef.setInput` (the `bindEntry` pattern, `entry-keys.spec.ts:19-27`); e2e specs import through the real picker via `e2e/helpers.ts` (`importLorebook`, `FATE_PATH`); `.entry-item` first click opens the editor (`e2e/delimiters.spec.ts:115`); **entry editor assertions must scope to `.mat-mdc-tab-body-active`** (inactive mat-tabs keep their DOM); `example_card/linter-demo.lorebook.json` carries a deterministic invalid-regex entry (uid 6, `/dragons[fire/`) if a pre-seeded variant is wanted. Coverage thresholds (80/75/80/80) are enforced inside `npm test`; pruning tests is branch-coverage-sensitive (diff per-file coverage before finishing).
- **Visual protocol**: pinned-conditions before/after screenshots under gitignored `__screenshots/<task>/{before,after}/` are mandatory for UI-reshaping tasks (AGENTS.md; archived Task 03 §3.5/§3.6.6 is the template — chromium, `deviceScaleFactor: 1`, `en-US`/`UTC`, light theme pinned twice, FATE fixture via the real import path, settle sequence; `__screenshots__/linter/capture.mjs` is the script precedent).

## 3. Design

### 3.1 Core additions (small, `core-engine`)

**`st-regex.ts`** — one classification function, shared by the chips, the panel, and (conceptually) the linter's predicate so all three surfaces can never disagree:

```ts
export type StKeyClass = 'regex' | 'invalid-regex' | 'text';
/** 'text' when not /…/shaped; 'regex' when shaped and compiling; 'invalid-regex' when shaped but dead
 *  (uncompilable body or unescaped inner slash — world-info.js:2821-2846). */
export function classifyStKey(key: string): StKeyClass;
```

**`st-key-match.ts`** — the range-returning counterpart of `matchStKey`, feeding excerpts and highlighted previews:

```ts
/** Half-open [start, end) span into the evaluated text. */
export interface StKeyMatchRange { start: number; end: number; }
/** All ranges where `key` matches `text` under ST rules (see below). */
export function findStKeyMatches(key: string, text: string, options: StMatchOptions): readonly StKeyMatchRange[];
```

Semantics mirror `matchKeys` exactly (world-info.js:337-366):

1. Valid regex key → its matches, options ignored: flags containing `g` yield **every** occurrence; without `g`, the **first** match only (pin both). Zero-length matches are skipped and `lastIndex` advances (no infinite loop on `/(?:)/g`). `exec` runs inside try/catch → `[]` on throw. The regex is parsed fresh per call (the `parseStRegex` contract), so stateful flags reset every evaluation.
2. Plain keys **and** invalid-regex-shaped keys → the plaintext path with `matchStKey`'s exact rules: case-folded unless `caseSensitive`; whole-word single-word keys return the **key's span, not the boundary characters**; multi-word and default paths return every occurrence (`indexOf` loop). Implement by sharing `matchStKey`'s private helpers — do not re-derive the case-fold/boundary logic.
3. **Caps**: evaluated text is capped at 5,000 chars (the same bound the linter's recursion matcher sets) and per-key ranges at 500 — generous headroom over the UI's 200-highlight clamp (§3.3), bounding catastrophic-pattern cost.
4. `matchStKey` stays byte-identical — the linter depends on it; only additive exports here.

Both additions are pure, framework-free (core invariant), and Tier-1-spec'd against the vendored oracle.

### 3.2 Chip classification UX (`entry-keys`)

- `keyStates = computed(...)` classifies every primary/secondary key via `classifyStKey` (recomputes on add/remove/in-place edit through the entry input signal).
- **`invalid-regex`** → chip gets error styling (`--mat-sys-error` outline/fill, `error-container`/`on-error-container` tones — the linter row idiom), a small trailing `error` icon (`aria-hidden`), and a `matTooltip` + textual description: **"Invalid regular expression — SillyTavern treats this key as plain text"** (accurate per §2; the raw `/(saber/` string will never appear in chat prose, so the key is dead — the tooltip may add "so it will never match"). The remove button stays the only interactive affordance (affordance separation: status marks are decorative).
- **`regex`** → a quiet accent (final treatment is P2a's call within M3 tokens — e.g. a `secondary-container` tone or a small `functions` glyph) + tooltip showing the parsed `source` + `flags` and the hint that case/whole-word options don't apply to it.
- **`text`** → unchanged.
- **Presentation-only**: `addKey`/`setKeys` behavior (trimming, exact-case dedupe, separators) is untouched — no contract change, no exported-byte change, no migration of existing specs beyond additive assertions. Case-insensitive duplicate detection stays a possible follow-up (fed by Task 03's duplicate rule); out of scope.

### 3.3 Inline test playground (`regex-test-panel`)

New child component **`src/app/features/entry-editor/entry-keys/regex-test-panel.ts/.html/.scss/.spec.ts`**, mounted by `entry-keys` below the Secondary Logic row:

- **Mount gating**: renders only `@if (hasKeys() && !isConstant())` — constant entries ignore all keys (the same messaging the Selective chip's tooltip uses), and a keyless entry has nothing to test. `hasKeys` = any primary or (when selective) secondary key.
- **Collapsible "Test keys" section** (collapsed by default): the accordion collapse idiom — icon-button toggle with `aria-expanded`/`aria-controls`, content wrapped `[inert]` when closed, `expand_more`/`expand_less` glyph, 44px touch floor. **No `MatExpansionModule`** (not an app dependency; §2).
- **Sample textarea**: signal-backed component-local state, `maxlength="5000"` (the §3.1 cap, enforced at input), label "Sample text", dialogue-flavored placeholder (`Artoria raised Excalibur as Saber…`). Never workspace state — nothing persists.
- **Live per-key match rows** (primary then secondary, list order): state icon + the key + excerpt when matched.
  - matched → `check_circle`, colored by key class (primary vs secondary color-coding shared with the preview, § below)
  - not matched → a quiet `remove` dash
  - invalid regex → `error` icon + **"Invalid regex — treated as plain text"**; the row still shows the faithful plaintext fall-back result (it will read "No match" for any sane sample)
  - secondary rows carry their `selectiveLogic` context label (reuse `ST_LOGIC_OPTIONS`).
  All matching runs in `computed`s over `findStKeyMatches`, so typing in the textarea, editing chips, or flipping the sibling sections' case/whole-word controls updates everything instantly.
- **Sample-text highlighting**: a read-only preview under the textarea renders the sample with matched ranges highlighted — **primary hits in `tertiary-container`, secondary hits in `secondary-container`** (distinct tonal pairs, both themes tracked; final tones confirmed at P2a). Implementation: pure function `highlightSegments(text, perKeyRanges): readonly TextSegment[]` where `TextSegment = { text: string; tone: 'none' | 'primary' | 'secondary' }`, rendered with `@for` — no DOM parsing, no `innerHTML`. **Overlap resolution is deterministic and unit-pinned**: outermost range wins; ties → earlier start; equal spans → primary before secondary, then key list order. Rendered highlights clamp at **200** with a "Showing first 200 matches" note.
- **Semantics = ST's**, resolved from the entry: `matchOptions = computed(() => ({ caseSensitive: entry().case_sensitive ?? false, matchWholeWords: <typed boolean read of extensions['match_whole_words']> ?? false }))`. The `null` ("Default (book setting)") tri-state resolves to `false` — ST's global default — and the helper hint says so explicitly, because LoreStitch cannot know the user's ST book setting.
- **Scope note** (hint line): "Matches against the raw text you provide — not SillyTavern's assembled chat history (message names, scan depth, recursion)."
- **a11y**: the textarea and the collapse toggle carry the ARIA; match rows are textual (not focusable controls) with state words beside `aria-hidden` icons; Escape inside the textarea does **not** collapse the section (only the toggle does); 44px touch floors; rows comfortable on mobile — the entry editor is the app's primary mobile editing surface.

### 3.4 Copy table (frontend-design rules: sentence case, plain verbs, errors say what happened)

| Surface | Copy |
|---|---|
| Section title / toggle tooltip | `Test keys` / `Test keys against a sample text` |
| Textarea label · placeholder | `Sample text` · `Artoria raised Excalibur as Saber…` |
| Row states | `Matches` · `No match` · `Invalid regex — treated as plain text` |
| Regex chip tooltip | `Regex key: /source/flags — case and whole-word options don't apply` |
| Invalid chip tooltip | `Invalid regular expression — SillyTavern treats this key as plain text` |
| Truncation note | `Showing first 200 matches` |
| Scope hint | §3.3 scope note + default-resolution note |
| Secondary row context | logic label from `ST_LOGIC_OPTIONS` (e.g. `AND Any`) |

### 3.5 Design checkpoint + visual baseline (P2a → user approval gate)

Per AGENTS.md (*Design Checkpoint Evidence* — every new interactive control cites its in-app exemplar or attaches a rendered mock; prose-only specs rejected) and the Task 02/03 lessons:

- **Before-set**: `__screenshots/04-regex-sandbox/before/` — the entry editor with the options panel expanded, Keys section with the FATE fixture's chips, at 1280×800 / 1024×768 / 390×844, under the archived-03 §3.6.6 pinned conditions (reproduce the `capture.mjs` script pattern: chromium, `deviceScaleFactor: 1`, `en-US`/`UTC`, light theme pinned twice, FATE fixture via the real import path, settle sequence).
- **Spec**: annotated design (rendered mock or precise ASCII) for the chip treatments (§3.2) and the panel (§3.3), each control citing its exemplar: collapse = `EntryOptionsAccordion` toggle; error tone = linter rows; quiet regex accent = existing chip idioms; textarea = the app's filled form fields; match rows = linter row anatomy minus actions.
- **Gate**: the orchestrator posts the spec + baseline to the user and **stops** — P2b/P3 implement only the approved design. The approved spec is appended to this file as §3.6 (the Task 02/03 amendment precedent) so it survives the session.
- **After-set** at P3 close: the same before-shots re-taken (unchanged surfaces must be pixel-comparable — the change is additive) plus the new states (regex chip, invalid chip, panel open with matches/highlights, truncation note), and the side-by-side comparison is posted with the phase report.

## 4. Implementation Plan

| Phase | Files | Work |
|-------|-------|------|
| **P1 — Core semantics additions** (`core-engine`) | `core/models/st-regex.ts` + spec, `core/models/st-key-match.ts` + spec | §3.1 — `classifyStKey` + `findStKeyMatches`, Tier-1 specs, `matchStKey` untouched |
| **P2a — Design checkpoint** (`ui-specialist`) | none in `src/`; design spec + `__screenshots/04-regex-sandbox/before/` | §3.5 — baseline + evidence-backed spec; **gate: user approval** |
| **P2b — Chip classification** (`ui-specialist`) | `entry-keys.ts/.html/.scss/.spec.ts` | §3.2 per the approved design |
| **P3 — Test playground** (`ui-specialist`) | `entry-keys/regex-test-panel.*` (new), `entry-keys.html/.ts` (mount), `entry-keys/highlight-segments.ts` + spec (pure), `public/fonts/*.woff2` (icons:refresh) | §3.3 per the approved design; closes with the after-set + comparison |
| **P4 — Review** (`ts-reviewer`) | all touched | typed `extensions` reads (boolean guard on `match_whole_words`, the `entry-activation` exemplar), no `any`/non-null assertions, computed purity, `npm run lint` |
| **P5 — E2E + coverage** (`qa-auditor`) | `e2e/regex-sandbox.spec.ts` | §5 Tier 3 + coverage verification + the pre-handoff checklist (final gate) |

Strictly sequential (single working tree; P2b/P3 share `entry-keys` files). **Branch**: `feature/04-regex-sandbox` off `develop`; push and stop at close — ff-merge only after the user tests (house rule).

Suggested phase commits: `feat(core): classify ST keys and return match ranges` · `feat(entry-editor): flag regex and invalid keys on chips` · `feat(entry-editor): add the regex key test playground` · `refactor(entry-editor): …` (P4, only if it changes code) · `test(e2e): cover the regex key sandbox` · close-out `docs(next_tasks): mark task 04 completed` (+ archive move).

## 5. Test Plan (three-tier matrix)

- **Tier 1 (P1)** — `st-regex.spec.ts` additions: `classifyStKey` truth table (plain text; valid `/…/i`; uncompilable `/(saber/`; unescaped-inner-slash `/a/b/`; non-ST flags like `/x/d` → `'text'` because the shape gate rejects them). `st-key-match.spec.ts` additions: `findStKeyMatches` — all occurrences with `g` vs first-only without; zero-length-match skip (no hang); whole-word spans exclude the boundary characters; multi-word `includes` ranges; case folding both directions; invalid-regex fall-back to plaintext ranges; 5,000-char and 500-range caps.
- **Tier 2** — `entry-keys.spec.ts` additions: invalid chip gets the error class + description; valid regex chip gets the accent + tooltip; plain chips unchanged; classification recomputes on add/remove/in-place edit. `highlight-segments.spec.ts`: pure segment math — disjoint, adjacent, nested, overlapping ranges (outermost wins), equal-span precedence (primary → earlier list position), the 200 clamp. `regex-test-panel.spec.ts`: mount gating (no keys / constant / normal); collapse ARIA + `[inert]`; live matching on textarea input (primary hit, secondary hit, case flip via `case_sensitive`, whole-word single vs multi-word, regex key ignoring options); invalid row state + label; empty sample ⇒ all rows "No match"; logic labels; Escape in the textarea does not collapse.
- **Tier 3** — `e2e/regex-sandbox.spec.ts` (desktop + one `mobile-chrome` 390×844 pass; entry editor is the primary mobile surface): import the FATE fixture → open the first entry (`.entry-item` click) → expand the options panel ("Toggle entry options") → **scope all editor assertions to `.mat-mdc-tab-body-active`** → add `/(?:saber|artoria)/i` and `excalibur` through the real chip inputs → expand "Test keys" → fill the sample text → assert match rows and the highlighted preview → add malformed `/(saber/` → assert the chip error state and the invalid row → flip "Match Whole Words" (Matching Sources section, same panel) → assert row states change without reload. `example_card/linter-demo.lorebook.json` (pre-seeded invalid key) is available if a deterministic-import variant is preferred; the live-typing flow is the default because it exercises the real user path.

## 6. Orchestration (subagent dispatch — Agent tool, serialized)

1. **Pre-flight (orchestrator)**: re-verify each phase's file list at current HEAD (re-grounding rule — this plan is grounded at `af244ba`; a read-only `Explore` agent may do the sweep); confirm the `angular-cli` MCP is actually connected before citing it to any subagent (fallback: `angular-developer` skill + installed typings); create `feature/04-regex-sandbox` off `develop`; check `git status --short` for unrelated local edits before each phase commit.
2. **`core-engine`** (skills: `typescript-advanced-types`, `angular-developer`) — **P1**. Pure functions, no UI imports in `core/`, `world-info.js` is the oracle (cite line refs in comments). *Gate: `CI=true npm test -- --watch=false` green including the new Tier-1 suites.* Commit: `feat(core): …`.
3. **`ui-specialist`** (skills: `angular-developer`, `material-3`, `frontend-design`) — **P2a**: capture the §3.5 baseline, author the evidence-backed design spec, hand it to the orchestrator. The orchestrator posts it to the user and **stops for explicit approval** — the pipeline never advances on an unreviewed visual design. On approval, record the spec as §3.6 here (`docs(next_tasks): record approved sandbox UI design`).
4. **`ui-specialist`** — **P2b then P3** (one dispatch may cover both; commit per phase regardless). Standalone OnPush, signals only, M3 tokens (`--mat-sys-*`; no raw hex, no `::ng-deep`), specs ship with the components, `npm run icons:refresh` + stage the font, frontend-design copy per §3.4. *Gates: `npm test` + `npm run build`; P3 closes with the after-set and the before/after comparison delivered to the user.*
5. **`ts-reviewer`** (skills: `typescript-advanced-types`) — **P4**, before qa (review-before-QA convention). *Gate: `npm run lint` clean, zero new `any`/non-null assertions, computeds pure.* Any refactor lands as its own commit.
6. **`qa-auditor`** (skills: `playwright-cli`, `angular-developer`) — **P5**, the final gate. Three-tier matrix per §5, coverage thresholds, E2E across desktop + mobile projects, `npm run typecheck:e2e`, then the full pre-handoff checklist (build → unit → coverage → playwright → lint → no compiler warnings).
7. **Close-out (orchestrator)**: push `feature/04-regex-sandbox` to origin and stop; `docs(next_tasks): mark task 04 completed` + archive the plan; **never merge back automatically**.

**Gate-failure protocol** (AGENTS.md): a red gate means the responsible subagent fixes forward and re-runs its own phase; the pipeline never advances on a red gate; after two consecutive failed fix attempts, stop and escalate to the user with the failing output. **Contract rule**: this task intentionally changes no exported bytes and no pinned behavior — if any phase discovers it must (e.g. linter copy alignment, §8.6), it stops and posts the old-vs-new contract for a user checkpoint instead of proceeding.

## 7. Verification Gates

`npm run build` · `npm test` (thresholds enforced inside the run) · `ng test --coverage` (st-regex, st-key-match, entry-keys, regex-test-panel, highlight-segments all covered; no touched-file coverage drop) · `npx playwright test regex-sandbox` + the touched regression suites (`entry-editor`, `delimiters`, `linter`) · `npm run typecheck:e2e` · `npm run lint` · §3.5 before/after comparison delivered at P3 close.

## 8. Risks & Open Questions

1. **ReDoS on user patterns**: a catastrophic regex against a long sample could jank the UI. Mitigations: the 5,000-char textarea cap, 500-range cap, fresh-parse-per-computed (state flags reset), try/catch → `[]`. Synchronous `computed` evaluation is acceptable at this scale; worker offload is a noted future option, not this task.
2. **ST tokenizer edge cases**: the chip input splits on commas, so an unterminated `/a,b` splits into two keys — ST's custom tokenizer would not. Decision (v1): keep the current input behavior, document the difference in the panel hint; a faithful tokenizer is a v2 follow-up fed by `st-regex.ts`.
3. **Highlight collisions**: overlapping matches from multiple keys — the deterministic resolution rule (§3.3) is pinned by `highlight-segments.spec.ts`, so the preview can never flicker between orderings.
4. **Chip visual density**: error/accent affordances must not break the existing chip-grid layout on mobile — covered by the mobile E2E pass and the §3.5 comparison.
5. **Branch coverage**: the new pure modules lift coverage, but any spec pruning during P4/P5 must diff per-file coverage against the phase-start baseline (AGENTS.md: global thresholds stay green while a touched file drops).
6. **Linter copy divergence**: the landed linter says invalid regex keys are "silently dropped"; this task's accurate copy is "treated as plain text" (world-info.js falls through to plaintext). Two phrasings for one defect class is a smell, but the linter's messages are pinned by `linter.spec.ts` + `e2e/linter.spec.ts` — aligning them is a contract change requiring a user checkpoint. Default: leave the landed copy untouched and note the follow-up; ask the user at P2a approval (one line, they're already reviewing copy then).
   **Resolved at P2a (2026-09-20)**: the premise is stale — the landed copy at `linter.ts:361` already reads *"…not a valid regex — SillyTavern will not treat it as a regex."* (accurate; pinned by e2e `hasText: 'not a valid regex'`). No contract change needed; the sandbox's "treated as plain text" phrasing complements it by design (see §3.6 §8).

---

### 3.6 Approved design (P2a spec — recorded 2026-09-20)

> **Status**: recorded as the design P2b/P3 implement. The design-gate question was posted to the user with the baseline and this full spec; it closed on the **recommended default** (this text, with §7's decided tone mapping) after no response in session. Every decision below sits within the latitude §3.2/§3.3 grant P2a ("final treatment is P2a's call within M3 tokens"); the P3 after-set comparison is the re-review point for any of these visual calls.
> Baseline evidence: `__screenshots__/04-regex-sandbox/before/` (gitignored; double-underscore dir follows the `__screenshots__/linter/` capture precedent) — 6 PNGs captured 2026-09-20 against `feature/04-regex-sandbox` @ `4bb1d5b` (P1 landed) under the Task 03 §3.6.6 pinned conditions (light theme, FATE fixture via the real import path, 1280×800 / 1024×768 / 390×844, chromium, deviceScaleFactor 1, en-US / UTC). Capture script: `__screenshots__/04-regex-sandbox/capture.mjs` (adapted from `__screenshots__/linter/capture.mjs`; `<before|after>` argument preserved so P3 re-runs it unchanged for the after-set).

#### 1. Overview

The entry editor's Keys section gains two additive layers, one per §3.2/§3.3 of plan 04: every key chip classifies itself live via P1's `classifyStKey` (`src/app/core/models/st-regex.ts`) — valid regex keys get a quiet accent + tooltip, invalid ones get the linter's error vocabulary + tooltip, plain keys are pixel-untouched — and a collapsible **Test keys** playground mounts below the Secondary Logic row, where a sample text (≤5,000 chars, component-local, never workspace state) drives per-key match rows and a read-only highlighted preview, honoring the sibling sections' `case_sensitive` chip and `match_whole_words` tri-state through a panel `computed` over `findStKeyMatches` (`src/app/core/models/st-key-match.ts`). No writes: chip add/remove/edit still funnel through `EntryUpdatesService.addKey`/`setKeys` untouched; the sandbox is presentation-only.

#### 2. Exemplar map (every new control → the surface it reuses)

| New control | In-app exemplar (concrete) | What carries over |
|---|---|---|
| Collapse toggle | `EntryOptionsAccordion` expand toggle (`src/app/features/entry-editor/entry-options-accordion/entry-options-accordion.html:66-81`) | `matIconButton` + `[attr.aria-expanded]` + `[attr.aria-controls]` on a stable id + `[inert]` content wrapper when closed + `expand_more`/`expand_less` glyph + `matTooltip`. **No `MatExpansionModule`** (verified absent from `src/`). |
| Section header (science icon + "Test keys") | The panel sections' `.section-title` row (`_shared.scss`) + the linter header's icon idiom (`linter-dialog.html:3` — `aria-hidden` icon in `--mat-sys-on-surface-variant`) | Icon is decorative; the text carries the name. |
| Regex chip accent | The chip **leading-icon slot** the selected filter chips already render (`entry-activation.html` Case Sensitive / `linter-dialog.html` mute chips — selected = filled + leading check). Counter-evidence that the accent must NOT be a tonal fill: `entry-list.scss:133` (`.active` row) and the selected filter chips themselves use `secondary-container` for *selection* | Small `functions` glyph (Σ), `aria-hidden`, `--mat-sys-secondary`; chip outline/fill/ink otherwise untouched. |
| Invalid chip | Linter error idiom: `--mat-sys-error` accent (`linter-dialog.scss:88-90`), `error-container`/`on-error-container` tones (plan 03 §3.6.3 approved mapping) | Error-toned outline + fill, trailing `error` glyph (`aria-hidden`), tooltip. `error` ligature already in the font subset (`topbar.html:43`). |
| Sample-text textarea | The entry editor's own Content field (`entry-content-field.html:1-10`: `appearance="fill"` + `matInput` textarea + `subscriptSizing="dynamic"`) at sample scale; hints as `.chip-hint` captions (`entry-keys.html:110`) | Filled form-field, floating label, caption-under-field. |
| Match rows | Linter `.diagnostic-row` grid (`linter-dialog.html:54-62`, `linter-dialog.scss:115-131`): 40px `aria-hidden` icon slot + message column — **minus `.row-actions`** (rows are textual, not focusable) | Same grid, same `.details` mono idiom (`linter-dialog.scss:145-153`) for excerpts, same `.entry-chip` decorative chip (`linter-dialog.scss:169-182`) for secondary rows' logic label. |
| Highlighted preview | Bespoke — no in-app surface renders highlighted user text. Justification (the persona's bespoke-control clause): nearest idioms are the delimiter dialog's read-only preview (`delimiter-dialog.scss:191` already paints preview spans with `secondary-container`) and the linter's tonal vocabulary; the segment render itself is `@for` over plain spans, no `innerHTML` | Tones borrow the established container roles; nothing else on the surface is new. |
| Icons | `science` (header), `check_circle` (matched), `remove` (not-matched) are **NEW ligatures** — not in the current woff2 subset; `error`, `cancel`, `expand_more`/`expand_less` already in use (plan §2 verified). P3: write row icons as literal `<mat-icon>` ligatures inside `@switch` branches so `scripts/refresh-icons.mjs`'s scan picks them up (bound `{{ }}` names only land via `DYNAMIC_ICONS`), then `npm run icons:refresh` + stage the regenerated woff2 with the P3 commit. |

#### 3. Chip treatments (plan §3.2)

`keyStates = computed(...)` in `entry-keys.ts` maps every primary/secondary key to `{ key, cls: StKeyClass, tooltip }` via `classifyStKey` + `parseStRegex` (both from `core/models/st-regex.ts`); the template binds one host class per chip (`key-regex` / `key-invalid`) and the tooltip string. Recomputes live on add/remove/in-place edit through the `entry` input signal. Writes are untouched: `addKey` trimming/dedupe and `setKeys` behavior stay byte-identical (no contract change, no exported-byte change).

**`invalid-regex` — the loud state (defect)**

- Chip host class sets: outline `--mat-chip-outline-color: var(--mat-sys-error)`, label ink `--mat-chip-label-text-color: var(--mat-sys-on-error-container)`, fill `background: var(--mat-sys-error-container)` on the host class (the chip host is our template element — no Material internals, no `::ng-deep`, no `!important`; exact token set verified against `node_modules/@angular/material` chips tokens: `--mat-chip-*` family).
- Trailing `error` glyph between the label and the remove button, `aria-hidden` (the tooltip carries the words).
- `matTooltip`: **"Invalid regular expression — SillyTavern treats this key as plain text"** (§3.4 verbatim).
- The remove button stays the **only** interactive affordance — the error mark is decoration (affordance separation).

**`regex` — the quiet state (classification) — DECIDED: `functions` glyph, not a tonal fill**

- Leading `functions` glyph (M3's Σ), `aria-hidden`, `color: var(--mat-sys-secondary)`, before the key text. Chip outline, fill and ink otherwise **default**.
- Why not `secondary-container` fill: in this app that tone already means *selection* — the selected filter chips above the very same section (`Selective`, `Case Sensitive`) render filled-secondary-container + check, and `entry-list` paints the active row and batch bar with it. A filled key chip would read as "selected". A glyph borrows the chip's existing leading-icon slot (the selected-filter-chip anatomy) without touching the fill/outline semantics, and keeps emphasis proportional to consequence: the section's loud voice stays reserved for the error state.
- `matTooltip`: **"Regex key: /source/flags — case and whole-word options don't apply"** with `/source/flags` filled from `parseStRegex(key)` (§3.4 verbatim shape).

**`text` — unchanged**

No class, no glyph, no tooltip. The other 367 fixture chips (and every plaintext chip in the app) render exactly as today — verified by the unchanged-surface re-shots in the state matrix (§6).

**Chip row mock (all three states)**

```
… Primary Keys (filled field) ………………………………………
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
│  Σ /(?:saber|artoria)/i  ⊗     ╷  /(saber/  ⚠  ⊗     ╷  Greater Grail  ⊗
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
   │ 'regex'                          │ 'invalid-regex'      │ 'text'
   │ default ink + quiet              │ error-container fill │ unchanged
   │ leading Σ (--mat-sys-secondary)  │ error outline + ⚠    │
   │ tooltip: parsed /source/flags    │ tooltip: treated as  │
   │ + options-don't-apply hint       │ plain text           │
   ▼                                  ▼                      ▼
   remove ⊗ stays the ONLY interactive affordance on every chip
```

(`⚠` stands in for the `error` Material glyph; `⊗` for the existing `cancel` remove button, untouched.)

#### 4. Test keys panel (plan §3.3)

New child component `src/app/features/entry-editor/entry-keys/regex-test-panel.ts/.html/.scss/.spec.ts`, mounted by `entry-keys.html` below the Secondary Logic row, with `highlight-segments.ts` + spec (pure segment math) beside it per the plan's P3 file list.

**Mount gating**: `@if (hasKeys() && !isConstant())` — constant entries ignore all keys (the Selective chip's tooltip already says so) and a keyless entry has nothing to test; `hasKeys` = any primary key, or any secondary key when selective. When gated off, nothing renders — no disabled shell, no ghost row.

**Collapse idiom** (exact `EntryOptionsAccordion` reuse): a hairline-separated row (`--mat-sys-outline-variant` top border, the accordion's `.panel > * + *` divider idiom) = `science` icon (`aria-hidden`, `--mat-sys-on-surface-variant`, the linter header icon idiom) + `Test keys` in the `.section-title` style + trailing `matIconButton` (`.expand-toggle` anatomy, `--mat-icon-button-state-layer-size: var(--touch-target-min)` — the linter close-button precedent, `linter-dialog.scss:55`), carrying `[attr.aria-expanded]`, `[attr.aria-controls]="'regex-test-panel-' + entry().id"`, tooltip **"Test keys against a sample text"**. Content stays mounted in a `[inert]="!open()"` wrapper with the accordion's grid `0fr → 1fr` collapse animation — so the sample text survives toggling, and closed content is invisible and inert. **Chevron mapping is the conventional one, NOT the accordion's inverted mapping** (the accordion's panel opens upward; this one expands downward): collapsed = `expand_more`, expanded = `expand_less`.

```
Collapsed                                                              Expanded
────────────────────────────────────────┆ ────────────────────────────────────────
🔬 Test keys                     [⌄]   ┆ 🔬 Test keys                     [⌃]
────────────────────────────────────────┆ ┌ Sample text ──────────────────────────┐
   (content mounted, [inert], 0fr)      ┆ │ Artoria raised Excalibur as Saber…    │
                                        ┆ └───────────────────────────────────────┘
                                        ┆ Matches against the raw text you provide —
                                        ┆ not SillyTavern's assembled chat history
                                        ┆ (message names, scan depth, recursion).
                                        ┆ Unset options use SillyTavern's defaults:
                                        ┆ case-insensitive, substring matching.
                                        ┆ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
                                        ┆ ✓ Matches  /(?:saber|artoria)/i
                                        ┆     …raised Excalibur as Saber awakened…
                                        ┆ ✕ No match  excalibur        [AND Any]
                                        ┆ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
                                        ┆ Sample (highlights) ────────────────────
                                        ┆ Artoria raised [Excalibur] as [Saber]…
                                        ┆ Showing first 200 matches   (only when clamped)
```

(`🔬` = `science`, `✓` = `check_circle`, `✕` = `remove`, `⌄/⌃` = `expand_more`/`expand_less`.)

**Textarea**: `appearance="fill"` `mat-form-field` (the Content-field idiom), `mat-label` **"Sample text"**, placeholder **"Artoria raised Excalibur as Saber…"**, `maxlength="5000"` (enforced at input), `matInput textarea` bound to a component-local `sample = signal('')` — **never workspace state**, nothing persists. Scope + default-resolution hints sit under it as `.chip-hint` captions (§5 wording).

**Match rows** (`<ul>`/`<li>`, linter `.diagnostic-row` grid minus `.row-actions`; primary keys first then secondary, list order):

- 40px `aria-hidden` icon slot: matched → `check_circle` colored by key class — `--mat-sys-tertiary` for primary-key rows, `--mat-sys-secondary` for secondary-key rows (the full-strength roles pairing with the preview's container tones); not matched → quiet `remove` dash in `--mat-sys-on-surface-variant` (the linter info role — deliberately the quietest); invalid regex → `error` in `--mat-sys-error` (the linter error role).
- State word beside the icon, textual and always announced: **`Matches`** · **`No match`** · **`Invalid regex — treated as plain text`** (§3.4 verbatim; an invalid row still shows the faithful plaintext fall-back result, which reads "No match" for any sane sample).
- Key text (body-medium, `overflow-wrap: anywhere` — long regex keys wrap, the global `keys-field` chip-wrap philosophy).
- Excerpt when matched: up to ~60 chars centered on the first match, `…`-trimmed both sides, in the linter `.details` mono muted idiom. Locating only — highlighting is the preview's job.
- Secondary rows carry their `selectiveLogic` label as a decorative `.entry-chip`-style tonal span (linter idiom, 28px `secondary-container`): **`AND Any`** / `NOT All` / `NOT Any` / `AND All` from `ST_LOGIC_OPTIONS`.
- All matching runs in `computed`s over `findStKeyMatches` with `matchOptions = computed(() => ({ caseSensitive: entry().case_sensitive ?? false, matchWholeWords: <typed boolean read of extensions['match_whole_words']> ?? false }))` (the `entry-activation` typed `extensions` read exemplar; `null` "Default (book setting)" resolves to `false` — ST's global default — and the hint says so). Typing in the textarea, editing chips, or flipping the sibling sections' controls updates everything instantly; no reload, no events.
- Rows are **not** focusable controls — the facts are textual, announced in reading order; nothing in a row is clickable.

**Highlighted preview** (read-only, under the rows):

- Pure `highlightSegments(text, perKeyRanges): readonly TextSegment[]` with `TextSegment = { text: string; tone: 'none' | 'primary' | 'secondary' }`, rendered `@for` over spans — no DOM parsing, no `innerHTML`. Overlap resolution deterministic and unit-pinned by `highlight-segments.spec.ts`: outermost range wins; ties → earlier start; equal spans → primary before secondary, then key list order.
- **Tone mapping — DECIDED**: primary hits `--mat-sys-tertiary-container` with `--mat-sys-on-tertiary-container` ink; secondary hits `--mat-sys-secondary-container` with `--mat-sys-on-secondary-container` ink. Justification: (a) M3 container/on-container pairs are the theme's contrast-engineered unit, so both tracks stay readable in light **and** dark (light: `#e0e0ff`/`#0000ef` and `#dae2f9`/`#3e4759` per the azure-blue prebuilt values this app's theme generates from; dark cyan/orange scheme separates the families even further); (b) `secondary-container` is the app's established "lesser metadata" tone (linter entry chips), matching secondary keys' weight, while `tertiary-container` is unused by any editor chrome — primary hits get a role that can never collide with existing emphasis; (c) all-blue-family light scheme is inherent to azure+blue — the rows (state word + grouping + logic label) carry the primary disambiguation, the preview tones are the second encoding.
- Rendered highlights clamp at **200**; when clamped, a `.chip-hint` caption **"Showing first 200 matches"** renders directly under the preview (§3.4 verbatim).
- `aria-hidden="true"`: the textarea holds the accessible sample text and the rows hold the match facts — the preview must not make screen readers re-read up to 5,000 characters of duplicate content.

**a11y + ergonomics**: toggle 44px floor via `--mat-icon-button-state-layer-size` (desktop) and the global ≤767px 48px bump (phones); textarea min-height ~3 rows with comfortable touch scrolling; rows textual (no tabindex); **no Escape handler anywhere in the panel** — Escape inside the textarea must not collapse the section (collapse is the toggle's job only); the whole panel lives inside the existing options-panel scrollport (`max-height: min(62vh, 640px)`), so no new mobile surface, drawer, or overlay is introduced — the entry editor's existing mobile ergonomics carry it.

#### 5. Copy (plan §3.4 — verbatim, do not paraphrase)

| Surface | Copy |
|---|---|
| Section title / toggle tooltip | `Test keys` / `Test keys against a sample text` |
| Textarea label · placeholder | `Sample text` · `Artoria raised Excalibur as Saber…` |
| Row states | `Matches` · `No match` · `Invalid regex — treated as plain text` |
| Regex chip tooltip | `Regex key: /source/flags — case and whole-word options don't apply` |
| Invalid chip tooltip | `Invalid regular expression — SillyTavern treats this key as plain text` |
| Truncation note | `Showing first 200 matches` |
| Scope hint | §3.3 scope note + default-resolution note |
| Secondary row context | logic label from `ST_LOGIC_OPTIONS` (e.g. `AND Any`) |

Scope hint, full sentence (per §3.3: the scope note plus the explicit default-resolution note):

> Matches against the raw text you provide — not SillyTavern's assembled chat history (message names, scan depth, recursion). Unset options use SillyTavern's defaults: case-insensitive, substring matching.

#### 6. State matrix (what the P3 after-set must capture)

Re-run `node __screenshots__/04-regex-sandbox/capture.mjs after` — the script re-takes all six `before` shots under identical pinned conditions (unchanged surfaces must be pixel-comparable; the change is additive), then adds:

| Shot | State | Fixture / setup |
|---|---|---|
| `after-1280/1024/390.png` | Unchanged-surface re-shots | identical flow to before-set |
| `after-keys-1280.png`, `after-keys-secondary-1280.png`, `after-keys-regex-1280.png` | Unchanged crops | identical flow |
| `after-chip-regex-1280.png` | Valid regex chip: Σ glyph + default ink | uid 65 "Distance nodes" (fixture-provided `/(?:…)/i`) |
| `after-chip-invalid-1280.png` | Invalid chip: error tones + `error` glyph | type `/(saber/` through the real chip input (plan §5 Tier 3 flow) |
| `after-panel-matches-1280.png` (+ `390` variant) | Panel open: match rows + highlighted preview | add `/(?:saber|artoria)/i` + `excalibur`, fill sample, expand Test keys |
| `after-panel-truncated-1280.png` | 200-clamp note | sample = repeated `saber ` to exceed 200 matches |
| `after-panel-mobile-390.png` | Panel on the phone viewport | entry editor is the primary mobile surface |

Comparison: side-by-side before/after posted with the P3 phase report (the AGENTS.md Visual Feature Baseline rule).

#### 7. Open questions for the approver

1. **Highlight tone pair (only if you want a second opinion)** — primary hits in `tertiary-container`, secondary in `secondary-container` is the decided mapping (rationale in §4). In the LIGHT theme both tones sit in the scheme's blue family (azure + blue palettes — every container role does), so the two are neighbors by hue though distinct in value/ink. The alternative would be a derived `--ls-*` pair, which is not recommended: it would add a second source of tonal truth next to the linter's `--ls-warning`. Default: ship the decided mapping.

No other open questions: the linter-copy alignment question plan §8.6 asked to raise at this gate is moot — the landed linter copy is already accurate (§8 below).

#### 8. Copy-alignment note (plan §8.6 premise is stale)

Plan §8.6 expected the landed linter to say invalid regex keys are "silently dropped", making the sandbox's "treated as plain text" a divergence needing a user checkpoint. The landed copy at `src/app/core/services/linter.ts:361` reads: *"…has a regex-shaped key that is not a valid regex — SillyTavern will not treat it as a regex."* — accurate, and pinned by e2e (`hasText: 'not a valid regex'`). No contract change is needed. The sandbox's tooltip ("…treats this key as plain text", per ST's actual fall-through at `world-info.js:337-366`) complements the linter's phrasing: the linter says what the key is not, the sandbox says what it then is. The two surfaces agree on the predicate (`isRegexShapedKey && !isValidStRegex`) because both call `classifyStKey`'s exact underlying exports; only the phrasing differs, by design.

#### P2a audit addendum (fixture fact P3/P5 should use)

The FATE fixture already contains one valid regex key — uid 65 "Distance nodes", a 612-char `/(?:…)/i` key (367 plaintext keys, 0 invalid). Consequence: the after-set's regex-chip state is fixture-provided; only the invalid-chip state needs live typing. Operational note: with two editor tabs open, panel locators must scope to `.mat-mdc-tab-body-active` (strict-mode violation otherwise) — the capture script already does this.
