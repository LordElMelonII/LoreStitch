# Task 18 — Progress Ledger

Plan: [18-editor-keystroke-performance.md](./18-editor-keystroke-performance.md).
Executed **directly on `develop`** (user waiver 2026-09-27 — no `feature/` branch;
phase commits land as atomic Conventional Commits). Grounded at `a384720`.
Preempts pending tasks 10–12 (user decision 2026-09-27). Human-signoff items
pre-approved in-session 2026-09-27, recorded in plan §6: (1) the topbar badge no
longer counts recursion-cycle/self-trigger findings live; (2) text-field
workspace writes commit on a 300 ms idle debounce with the D1 merge rule,
including its spec migrations.

## Phase 0 — baseline (orchestrator)

**Status**: ✅ complete

- Tree clean at `a384720`; dev server on 4321; probe
  (`__screenshots__/perf-probe/profile-keystrokes.mjs`) already banked against
  exactly that tree (profiles timestamped after the HEAD commit). Baselines
  preserved as `variant{A,B}-*-profile-before.json` before the post-run
  overwrote the working copies.
- Method: synthetic 723-entry book imported into the probe's own browser
  profile; 12 spaced keystrokes typed into the content textarea; CDP Profiler
  at 200 µs sampling; derived per-keystroke work = profiled total − (idle) −
  (program) − (garbage collector), ÷ 12.

| Baseline (before) | A — mostly disabled + constant | B — mostly enabled + normal |
|---|---|---|
| profiled total | 10 110.3 ms | 18 181.9 ms |
| (idle) share | 8 274.2 ms | 6 918.1 ms |
| **work per keystroke** | **81.6 ms** | **864.3 ms** |
| dominant cost | `estimateTokens` 125.8 ms, IndexedDB 155.7 ms | `collectSubstringRanges` 8 912.2 ms (the O(V²) recursion pair loop), `firstMatchingKey` 189.6 ms, `lintRecursion` 138.7 ms |

## Phase 1 — core (core-engine)

**Status**: ✅ complete — commit `989da9e`
`perf(core): memoize per-entry derivations, split lint and dirty checks`

- D2: new bare module `core/services/entry-memo.ts` — identity-keyed WeakMap
  memos `memoEntryTokens` / `memoEntryHaystack` / `memoEntryLint` (lint memo
  caches id-carrying entries only; id-less entries are index-keyed and would
  stale on reorder). The five entry-scoped linter rules and the search-haystack
  fold moved INTO the module (they are per-entry derivations), giving a
  one-directional import graph (linter → entry-memo → models); `LintDiagnostic`
  crosses type-only. `entry-list.model.ts` re-exports `entrySearchHaystack` so
  every import site kept working. `token-estimator.ts ↔ entry-memo.ts` is the
  one documented benign function-level cycle (no `import/no-cycle` rule in this
  repo; no evaluation-time cross-calls).
- D3: `lintBook` sources entry-scoped diagnostics from the memo and applies
  `mutedRules`/`ignored` at aggregation — `lintBook(book)` / `lintBook(book, {})`
  byte-identical (pinned). New `LintOptions.includeGraphRules` (default `true`)
  skips the graph pass and its large-book skip note; duplicate-key buckets stay
  in both modes.
- D4: `LinterState.entryDiagnostics` (graph-free pass) drives `issueCount`;
  `diagnostics` stays the pane-only full pass (computed laziness gates the
  O(V²) work to the open health pane).
- D5: `VcsService.isDirty` = memoized shell serialization (book-keyed WeakMap)
  + entry-count equality + positional `serialize(work[i]) !== serialize(head[i])`
  (already identity-memoized). `hashBook`, `serializeBook`, `dirtyEntryIds`
  untouched.
- Orchestrator fast gate: build ✓ · unit+coverage 1 339 tests ✓ · lint ✓ ·
  `typecheck:e2e` ✓.

## Phase 2 — UI (ui-specialist)

**Status**: ✅ complete — commit `90f838e`
`perf(entry-editor): commit text edits on idle and track virtual rows`

- D1: `entrySliceSignal` arms a 300 ms trailing debounce
  (`EDIT_COMMIT_DEBOUNCE_MS`) instead of writing per keystroke. Flushes on
  timer elapse, injection-context `DestroyRef`, and external entry replacement
  under the merge rule; timer-path writes self-identify via pick-equality
  (`echoing` stays synchronous-path-only); no-op edits never arm.
- D6: `*cdkVirtualFor` rows track by entry id (microsyntax `trackBy:` binds
  `cdkVirtualForTrackBy` — verified against installed CDK 22.1.6);
  `templateCacheSize: 0` unchanged. `EntryList.items` adopts
  `memoEntryTokens`/`memoEntryHaystack` (output-identical).
- New `entry-edit-form.spec.ts` (house fake-timer idiom) + migrations: the
  plan-named pins (entry-editor comment/strip, content-field) plus four
  per-section specs the plan did not anticipate (activation, inclusion-group,
  placement, recursion-timing — pins that asserted workspace state after
  `whenStable`). Content stats verified form-model-driven (per-keystroke).
- Fast gate: build ✓ · 1 349 tests ✓ · lint ✓ · `typecheck:e2e` ✓.

## Phase 3 — review (ts-reviewer)

**Status**: ✅ complete — commit `7c1a830`
`refactor(entry-editor): type the merge-rule key compare safely`

- MEDIUM: the merge rule's per-key compare used an `as unknown as` double cast
  (`CharacterBookEntry` has no index signature) — replaced with a checked
  `entryFieldValue(entry: object, key: string): unknown` helper (single
  compiler-checked assertion, values compared by identity as `unknown`).
- LOW: the lint-memo id-carrying restriction added to `entry-memo.ts`'s
  module-head purity contract (plan P3 requirement).
- Verified: no `any`/`@ts-ignore`/non-null assertions across both diffs; purity
  doc present and accurate; import-direction claims hold. Lint ✓ · 1 349 tests ✓.

## Phase 4 — QA (qa-auditor)

**Status**: ✅ complete — commits `bb7c80f`
`test(unit): close the task 18 section-5 pin gaps` and `818ab82`
`test(e2e): migrate linter badge counts and idle-commit timing pins`

- §5 map complete; three gaps closed with unit cases: D6 trackBy pin (resolved
  `CdkVirtualForOf` from the debug-node tree), the dialog-still-lists-graph-
  findings half of D4, and a stats-move-before-commit pin discriminating the
  form model from the workspace under D1.
- E2E greps: `e2e/linter.spec.ts` badge counts migrated 6→5 / 6→5→4 (the
  fixture's one recursion-cycle warning left the live count, D4);
  `e2e/round-trip.spec.ts` first test failed the smoke deterministically —
  mirror-typed group fields were still an uncommitted draft at export while
  discrete chip/select edits land immediately (the unambiguous D1 signature) —
  migrated with an explicit 400 ms flush wait (plan §6 pre-approved). Near-miss
  flagged: other type→export flows pass only because export-menu choreography
  exceeds 300 ms — a slow-CI flake candidate (see Phase 5: it did fire).
- Desktop-chrome smoke: linter 3 · round-trip 4 · character-card 5 ·
  delimiters 16 · batch-and-tokens + search-responsiveness 7 — all green.
- Fast gates: build ✓ · 1 352 tests ✓ (touched-file coverage table clean) ·
  lint ✓ · `typecheck:e2e` ✓.

## Perf after (probe re-run, same script, same derivation)

| After P1–P4 | A — mostly disabled + constant | B — mostly enabled + normal |
|---|---|---|
| profiled total | 9 131.4 ms | 9 085.0 ms |
| (idle) share | 8 211.6 ms | 8 065.1 ms |
| **work per keystroke** | **24.0 ms** (was 81.6) | **35.0 ms** (was 864.3) |
| collapsed costs | `estimateTokens`, `entrySearchHaystack`, `canonicalJson`/`serialize` all below the 2 ms table cutoff | `collectSubstringRanges` **8 912.2 → absent** (graph pass no longer live), `firstMatchingKey`, `lintRecursion`, `estimateTokens` absent |
| remaining deliberate costs | IndexedDB save ~167 ms/session (unchanged by design) | duplicate-key buckets ~8.5 ms/keystroke (kept per D3), IndexedDB ~13.5 ms/settle |
| session wall, same 12-keystroke run | 10.1 s → 9.1 s | 18.2 s → **8.7 s** (settle passes no longer starve the timers) |

**Targets (plan §1: keystroke wall < 50 ms, settle pass < 100 ms, both
variants)**: met — A 24.0 ms / B 35.0 ms combined per-keystroke work; the probe
samples one stream over 12 spaced keystrokes and cannot split the synchronous
keystroke from the async settle pass, so these are combined figures (the true
keystroke wall is strictly smaller; every settle component is far below 100 ms).
Stated as combined-work evidence, not a direct wall/settle split.

## Phase 5 — final sweep + docs (orchestrator)

**Status**: ✅ complete — fix-forward commit `c17c8dc`
`fix(entry-editor): keep extension-backed text drafts past sibling writes`

- Sweep round 1: desktop-chrome **71 passed / 1 failed** — `round-trip.spec.ts`
  "import, edit, export": the exact near-miss P4 flagged. Root cause (app bug,
  not a spec pin): the D1 merge rule compared the entry's TOP-LEVEL keys, so
  the `extensions` bag read as one field — the test's Prioritize Inclusion
  click (a discrete `extensions.group_override` write replacing the bag) while
  the group/group_weight draft pended took the external-wins branch and
  silently dropped the typed text (export missing the edits). The P4 smoke had
  passed only because automation latency let the timer fire first.
- Fix-forward (looped back to the authoring phase): the merge now resolves
  field effects one level into plain-object values —
  `extensions.group_override` vs `extensions.group` are disjoint fields, so
  sibling discrete writes re-apply the draft while a genuine same-field
  external write still wins; deeper nesting compares by reference; an
  unattributable side can never read as disjoint (whole-key-covers fallback).
  Two new `entry-edit-form.spec.ts` cases pin both branches; this refines the
  plan's D1 letter (top-level keys) to its stated intent ("fields the external
  patch shares") — flagged here for the user's manual-testing attention.
- Sweep round 2 (full repeat per the loop rule): desktop-chrome **72 passed /
  16 skipped** · mobile-chrome **46 / 42** · mobile-safari **44 / 44** — all
  green. Final `CI=true npm test -- --watch=false --coverage` → 61 files /
  **1 354 tests** ✓ (global 96.18/91.12/91.42/97.39) · `npm run lint` ✓.

## Final state

- Commits on `develop` (in order): `989da9e` (P1 core) → `90f838e` (P2 UI) →
  `7c1a830` (P3 review) → `bb7c80f` (P4 unit tests) → `818ab82` (P4 e2e tests)
  → `c17c8dc` (P5 fix-forward) → docs commit (this ledger + TEST-REPORT
  addendum + the plan file).
- Baseline/after probe profiles under `__screenshots__/perf-probe/`
  (`*-profile-before.json` = pre-P1 banked baseline; gitignored working
  artifacts).
- Accepted trade-offs (all pre-approved in plan §6): badge no longer counts
  graph findings live (health pane shows them); ≤300 ms commit lag for text
  slices (dirty stars, row token counts, save debounce trail typing); the
  ~770 ms graph pass now runs only while the health pane is open.

## For the user's manual testing

1. Type continuously in an entry of a large book (723-entry probe book class):
   keystrokes should feel instant; dirty stars/token counts trail ~300 ms.
2. Type into Group/Group Weight, then immediately click a chip (Prioritize
   Inclusion) or the Use Group Scoring select within 300 ms: the typed text
   must survive (the Phase-5 fix; regression-verified by e2e round-trip).
3. The topbar linter badge on a book with recursion cycles now shows a smaller
   count than before; opening the health pane lists the cycle/self-trigger
   findings as before.
