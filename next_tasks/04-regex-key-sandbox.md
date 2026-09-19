# Task 04 — Regex Key Testing Sandbox

> **Source**: `ROADMAP.md` → MEDIUM PRIORITY → *"Regex Key Testing Sandbox"*
> **Type**: Feature extension of an existing editor section
> **Suggested agents**: `core-engine` → `ui-specialist` (lead) → `ts-reviewer` → `qa-auditor`
> **Depends on**: Task 03 Phase 1 (`core/models/st-regex.ts` + `st-key-match.ts`). If this task runs first, absorb Task 03's Phase 1 as Phase 0 here and flag it in Task 03.

---

## 1. Objective

Let authors verify activation keys — especially regex keys like `/(?:saber|artoria)/i` — **without spinning up SillyTavern**: every key chip gets live validity feedback (invalid regexes are flagged, because ST silently ignores them), and an inline "Test Input String" playground highlights which keys would match a sample text in real time, honoring the entry's case-sensitivity and whole-word settings exactly as ST would.

## 2. Current State (code audit, `develop` @ `4120bb9`)

- **`src/app/features/entry-editor/entry-keys/`** (`entry-keys.ts/.html/.scss/.spec.ts`): standalone signals component, `input.required<CharacterBookEntry>()`, renders a "Selective" `mat-chip-option`, a Primary Keys `mat-chip-grid` with `matChipInput` (Enter/comma separators), a Secondary Keys grid (when `selective`), and a Secondary Logic `mat-select` bound to `extensions['selectiveLogic']`. In-place chip editing via double-click (`editingKey` signal + `editValue`, `afterRenderEffect` focus).
- **Key writes** funnel through `EntryUpdatesService.addKey()` (`entry-updates.service.ts:143-155`): trims, rejects blank and **exact-case duplicates within the same list** — no cross-entry awareness, no regex awareness, no case-insensitive duplicate check.
- **No `/pattern/flags` handling exists anywhere** (see Task 03 §2). The only regex UX precedent is `search-replace-dialog.ts`'s `patternError` computed ("Invalid regular expression").
- **ST semantics** (vendored `sillytaver-world-info-doc/worldinfo.js` + `worldinfo.md`): a key is a regex iff `/^\/([\w\W]+?)\/([gimsuy]*)$/`-shaped with no unescaped inner slash; regex keys **override** `caseSensitive` and `matchWholeWords` options; invalid regexes are silently ignored; commas inside a `/…/` regex do not split (custom tokenizer).
- **Test conventions**: as listed in Task 03 §2 (Vitest globals, TestBed standalone imports, protected-member access).

## 3. Design

### 3.1 Key classification (chips become self-diagnosing)

- New pure helper next to the component or in `st-regex.ts` (if not already there): `classifyKey(key): 'regex' | 'invalid-regex' | 'text'`.
- `entry-keys` gains `keyStates = computed(...)` classifying every primary/secondary key:
  - **`invalid-regex`** → chip gets error styling (`--mat-sys-error-*` tokens), an `error` icon, and an accessible description: "SillyTavern will silently ignore this key — invalid regular expression" (wired as `aria-describedby` / mat-tooltip).
  - **`regex`** → subtle visual accent + tooltip showing the parsed `source` + `flags`, and the hint that case/whole-word options don't apply to it.
  - **`text`** → unchanged.
- `EntryUpdatesService.addKey()` stays as-is (no behavioral change to editing); classification is presentation-only in this task. Case-insensitive duplicate detection is a possible follow-up fed by Task 03's duplicate rule — out of scope here.

### 3.2 Inline test playground (`regex-test-panel`)

New child component **`src/app/features/entry-editor/entry-keys/regex-test-panel.ts/.html/.scss/.spec.ts`**, rendered inside `entry-keys` below the key grids:

- Collapsible "Test keys" section (M3 expansion, `@if` on an `expanded` signal) with:
  - A sample-text `<textarea>` (signal-backed; placeholder shows a dialogue-flavored example, e.g. `Artoria raised Excalibur as Saber…`).
  - **Live per-key match rows** for primary and secondary keys: state icon (matched/not/invalid), the key, and — when matched — the match excerpt. Matching runs in a `computed`, so typing in either the chips or the textarea updates instantly.
  - **Sample-text highlighting**: a read-only preview under the textarea renders the sample with every matched range wrapped in `<mark>`-style highlights (M3 tertiary-container tokens), color-coding primary vs secondary key hits. Implementation: pure function `highlightSegments(text, ranges): TextSegment[]` → `@for` render (no DOM parsing, no innerHTML).
- **Semantics = ST's**, via Task 03's modules: `matchStKey(key, sample, { caseSensitive: entry.case_sensitive, matchWholeWords: entry.extensions.match_whole_words })` — regex keys bypass those options (mirroring ST and stated in a helper hint line). Secondary rows display their `selectiveLogic` context label (reuse `ST_LOGIC_OPTIONS`).
- **Scope note**: the sandbox tests a static string, not ST's chat-message assembly (per-message `name:` prefixes, `\x01` separators, `scan_depth` windows). A hint documents this ("matches against the raw text you provide").

### 3.3 Interactions & a11y

- Panel is keyboard-reachable; Escape inside textarea does not close the section (only the global collapse toggle does); match rows are textual (not focusable controls) — the textarea and collapse button carry the ARIA.
- 44px touch floors for the collapse toggle; textarea rows comfortable on mobile (entry editor is the primary mobile editing surface).
- Perf guard: highlight computed is O(keys × text); clamp rendered segments (e.g. first 200 highlights) and note truncation if hit.

## 4. Implementation Plan

| Phase | Files | Work |
|-------|-------|------|
| **P0 — Shared modules check** (core-engine) | `core/models/st-regex.ts`, `st-key-match.ts` | Consume from Task 03; if absent, implement them here (exact spec in Task 03 §3.1) + their specs |
| **P1 — Classification UX** (ui-specialist) | `entry-keys.ts/.html/.scss/.spec.ts` | §3.1 chip states + a11y descriptions |
| **P2 — Playground** (ui-specialist) | `entry-keys/regex-test-panel.*` (new), `entry-keys.ts/.html` (mount), shared `highlightSegments` + spec | §3.2 panel + highlighting |
| **P3 — Review** (ts-reviewer) | all touched | Typing of `extensions` reads, computed purity, lint |
| **P4 — Tests & E2E** (qa-auditor) | `regex-test-panel.spec.ts`, `entry-keys.spec.ts` additions, `e2e/regex-sandbox.spec.ts` | §5 below |

P1 and P2 are sequential (P2 mounts inside the P1-touched template); P0 before both.

## 5. Test Plan

- **Unit (core, if P0 lands here)**: the `st-regex`/`st-key-match` suites from Task 03 §3.4.
- **`entry-keys.spec.ts` additions**: invalid regex chip gets error class + description; valid regex chip gets accent; plain text unchanged; classification recomputes on chip edit/add.
- **`regex-test-panel.spec.ts`**: real-time matching on textarea input (primary hit, secondary hit, case-insensitive default flip via `case_sensitive`, whole-word single vs multi-word behavior, regex key ignoring options); invalid regex row state; highlight segments correctness (overlapping ranges → outermost wins, clamp at cap); empty sample ⇒ all rows "not matched"; logic label rendering.
- **`e2e/regex-sandbox.spec.ts`**: open an entry, add key `/(?:saber|artoria)/i` and a plaintext `excalibur`, expand the panel, paste sample text, assert highlighted preview + match rows appear; add a malformed key `/(saber/` and assert the inline error state appears. One mobile-viewport pass (entry editor is a mobile surface).

## 6. Orchestration

1. **`core-engine`** (skills: `typescript-advanced-types`) — P0 only (small): confirm/land the shared semantics modules with specs. *Gate: `npm test`.*
2. **`ui-specialist`** (skills: `angular-developer`, `material-3`, `frontend-design`) — P1+P2 (lead). Standalone OnPush, signals only, M3 tokens, chip/tree a11y, specs ship with components; match-result and empty-state copy follows the frontend-design writing rules. *Gate: `npm test` + `npm run build`.*
3. **`ts-reviewer`** (skills: `typescript-advanced-types`) — P3: no `any` on `extensions` reads (use `EntryExtensions` guards as done in `entry-activation.ts`), no non-null assertions, `npm run lint`.
4. **`qa-auditor`** (skills: `playwright-cli`) — P4: component coverage + new E2E spec; verify no regressions in `entry-editor` suites; coverage thresholds. *Gate: `npx playwright test regex-sandbox`, `ng test --coverage`.*

Small task — a single ui-specialist run can cover P1+P2 in one dispatch; ts-reviewer and qa-auditor runs are correspondingly short.

## 7. Verification Gates

`npm run build` · `npm test` · `ng test --coverage` (entry-keys + regex-test-panel covered) · `npx playwright test regex-sandbox` (+ full suite on touched areas) · `npm run lint`.

## 8. Risks & Open Questions

1. **ReDoS on user patterns**: catastrophic regexes against a long sample could jank the UI. Mitigation: sample length is naturally short; cap evaluated text (e.g. 5,000 chars) with a visible truncation note; matching runs in a `computed` (synchronous) — acceptable at this scale, note for future worker offload.
2. **ST tokenizer edge cases** (commas inside `/…/`, `/-` prefixed keys, `\x01` markers): chip input splits on commas today; decide whether `addKey` should keep a trailing comma inside an unterminated regex open-pair (ST's tokenizer does). Recommended: keep current input behavior, document the difference in the panel hint (v2 follow-up).
3. **Highlight collisions**: overlapping matches from multiple keys — deterministic resolution rule (first-key-wins, outermost-range-wins) pinned by unit tests.
4. **Chip visual density**: error/accent affordances must not break the existing chip-grid layout on mobile — covered by the mobile E2E pass.
