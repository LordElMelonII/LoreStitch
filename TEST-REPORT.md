# Test Suite Report

Audit of every unit (`**/*.spec.ts`, Vitest) and e2e (`e2e/*.spec.ts`, Playwright) spec file for redundant tests and real usefulness. Updated as each batch was analyzed; all findings below cite test names as evidence.

**Method** — for each spec file: read the spec and the code under test, count cases, map what each case pins, flag (a) exact or near-duplicate cases within/across files, (b) weak assertions (tautologies, framework re-tests, assertions that can't fail), (c) cases whose behavior is already pinned by another tier with no added value, and (d) skipped/dead tests. Verdicts: **Essential** (pins a real contract nothing else covers), **Useful** (earns its keep, minor trims possible), **Trim** (contains clearly redundant cases worth deleting), **Redundant** (adds no protection beyond the rest of the suite — no file earned this verdict).

**Scope** — 49 unit spec files + 8 e2e spec files (~1,050 unit cases + ~86 e2e declarations / ~155 executions). Zero `xit`/`.skip`-forever, zero never-run e2e tests, zero assertion-free tests across the whole suite.

**Headline conclusions**

1. No file is wholesale redundant. The suite is healthy: duplication is concentrated in ~15 specific, named spots.
2. The strongest duplication pattern is **dialog specs re-pinning their `.model.spec` logic** (`batch-operations-dialog` ↔ `batch-operations.model`, `linter-dialog` ↔ `linter-state`) and **component specs re-pinning service/model logic** (`entry-updates.service` ↔ `lorebook.model`, `entry-activation`/`entry-recursion-timing` chip tests).
3. `e2e/ui-responsiveness.spec.ts` replays whole describe blocks per viewport width (1920/1280 and 390/412 pairs) — it alone accounts for ~59% of all e2e executions; one width per device class would halve it.
4. Two genuine quality defects: a can't-fail self-comparison in `sha256.spec.ts`, and an under-powered fixture in `token-estimator.spec.ts`'s content-exclusion test.
5. Systemic (non-correctness) issues: copy-pasted test helpers (`importLorebook` ×6 e2e files, `installMatchMediaStub` ×2, `severityFixture` ×2, `createPane` ×7 subpanel specs) and heavy private-member access (`component['x']`) coupling many specs to internals.

---

## Unit — `src/app/core/models/` + app shell (batch 1)

### `src/app/app.spec.ts` — 14 tests — **Essential**
Pins the shell's viewport-driven drawer state machine (per-class defaults, sticky toggles, focus/scroll reclaim, bottom-bar mounting, focus-mode teardown) with e2e-provenance comments.
- Near-dup: `'routes the bottom bar history action to the history drawer'` re-asserts the opening step of `'focuses the history drawer opened from the bottom bar…'` (merge candidates); the tablet tail of `'keeps user drawer toggles sticky…'` re-pins `'docks the entries drawer and overlays history on tablet'`.
- Minor: `void app;` dead statement; heavy `app['private']()` access.

### `core/models/delimiters.spec.ts` — ~131 effective cases (116 literal + table loops) — **Essential**
The app's densest byte-fidelity contract (wrap/unwrap/rewrap decisions D1–D5, malformed detection, name derivation). Exact-string assertions throughout. Trimmable duplicated expects:
- The input `<N>\nprose\n\n---\n</N>` → `'prose\n\n---'` is asserted **three times** under three names (`'strips only the outermost wrapper in a single pass'`, `'strips only the outer tag in a single pass'`, `'preserves a trailing --- inside a tag payload'`).
- `'does not strip a non-matching wrapper for none (D4)'` vs `'does not strip wrapper-syntax prose unless the name matches'`: `rewrapContent('<note>x</note>', 'none', …)` duplicated verbatim.
- `'never emits phantom wrappers for blank payloads'` cannot fail independently of `'keeps blank payloads unchanged for every style (D5)'`; `'round-trips blank payloads as-is'` is compositionally implied by wrap+unwrap blank tests.
- `'keeps a padded payload byte-for-byte'` duplicates wrapContent's `'embeds the payload verbatim (no trim)'`; `'matches wrapper names after sanitization'` repeats a `delimiterNameMatches('a=b', ['a[b'])` expect pinned one test earlier.
- Cross-file: its `converter round trip` describe (parking `color: '#ff00ff'`) overlaps `lorebook.roundtrip.spec.ts`'s deeper `'parks unknown entry attributes…'` — trim the delimiters-side copy.

### `core/models/lorebook.model.spec.ts` — 48 tests — **Essential**
Native↔CharacterBook conversion fidelity (field mapping, extensions parking, position 99, addMemo capture, import guards, lintPrefs sanitizing, extractSubBook, trigger tri-state).
- Overlap with roundtrip spec (see below): addMemo pinned twice, plain position-99 chain pinned twice (keep the V2-export variant — it's distinct).

### `core/models/lorebook.roundtrip.spec.ts` — 18 tests — **Essential**
Real-oracle-file lossless round trip over the two production lorebooks — the strongest preservation guarantee in the repo.
- `'preserves the stlo book metadata through import and export'` is subsumed by `'preserves stlo and randomExtension outside entries'`; `'imports every entry'` (count-only) is subsumed by `'exports every original attribute of every entry unchanged'`.
- **Trim candidates vs model spec**: the roundtrip addMemo describe (`'addMemo:false with a non-empty comment stays false'` / `'addMemo:true with an empty comment stays true'` ≡ model.spec's export twins) and `'keeps 99 across import, native export, and re-import'` (≡ model.spec's `'round-trips an out-of-enum numeric position (99) untouched'`).

### `core/models/st-key-match.spec.ts` — ~60 effective cases (21 literal + tables) — **Essential**
Faithful `matchKeys` port pinning with oracle line citations. Duplicate truth-table rows: `{caseSensitive:false}` rows duplicating `{}` default rows (`['rose', 'the ROSE grew', …]`); `'an empty plaintext key matches everything…'` duplicates two defaults rows; `'tests regex keys before any case folding…'` re-asserts an exact regex-override table row; one expect of `'null options behave exactly like unset options'` duplicates the `worldinfo.md:450` example test.

### `core/models/st-regex.spec.ts` — ~74 effective cases (15 literal + tables) — **Useful**
Parse-table fidelity is excellent. The whole `isValidStRegex` describe is **delegation re-testing** — the function is literally `parseStRegex(key) !== null` (st-regex.ts:91), and every row's second expect re-runs parse outcomes already pinned in the parseStRegex tables; only the public name contract is new. `'/a/d'`/`'/a/v'` are pinned not-shaped twice (UNACCEPTED_FLAG loop + NOT_SHAPED table). Cross-file: raw-regex case rows (`['/rose/', 'ROSE', false]`) pinned in both this file and st-key-match — defensible (different entry points) but one layer could go.

---

## Unit — `src/app/core/services/` (batch 2)

### `import-export.service.spec.ts` — 31 tests — **Essential**
The never-drop-vendor-keys contract: format auto-detection, malformed rejection, byte-exact exports, re-import losslessness. Correct mock use (stubbed download plumbing, real Blob bytes asserted).
- Merge candidates: `'rejects .stproj archives from a future version'` ≈ `'rejects a .stproj archive whose version is not the archive number'` (same guard branch); Fuyuki half of `'accepts both bundled real-world fixtures'` re-asserts `'detects and parses the Fuyuki card…'`; `'parses a .stproj archive and unwraps its workspace'` ≈ the re-import half of the archive-envelope test.

### `linter.spec.ts` — 96 tests — **Essential**
Exact diagnostic sets per rule, sorting, determinism, immutability (deepFreeze), ignore/mute filtering. Zero mocks. Trims: determinism pinned three times (`'is deterministic across runs and app restarts'` is subsumed by `'never mutates a deep-frozen book…'` variants); `'keeps the warning when only some members are grouped'` ≈ `'…in different groups'`; `'mutes every rule into an empty report'` ≈ `'skips a muted rule while the rest still run'` + `'mutes self-trigger without losing it…'`.

### `sha256.spec.ts` — 8 tests — **Essential** (one defect)
FIPS vectors + WebCrypto agreement + UUID tiers. **Defect**: `'handles inputs spanning multiple 64-byte blocks'` contains `expect(sha256Hex(long)).toBe(sha256Hex(long))` (sha256.spec.ts:31) — a pure function compared with itself; the multi-block digest is never checked against a known vector. Also the two WebCrypto-agreement tests silently vac-pass if `crypto.subtle` is absent in the env.

### `storage.service.spec.ts` — 13 tests — **Essential**
Debounce collapsing, stale-put ticket retirement, pending-over-persisted reads, no-IDB degradation — each test isolates one timing window with purpose-built deferred puts. Only nit: `'lists persisted projects newest-first'` proves `.reverse()` against the fake's own sort, not real IndexedDB ordering.

### `theme.service.spec.ts` — 7 tests — **Essential**
Seven lean, distinct mode transitions (system/light/dark, persistence, corrupt storage, failing writes). No fat.

### `token-estimator.spec.ts` — 12 tests — **Essential** (one defect)
Every branch of the formula. **Defect**: `'estimates only the content (keys and memos are never injected)'` uses a `createEmptyEntry` fixture that has no keys and no comment — the exclusion it names is never exercised; it would pass even if keys were summed. Note the coupling: import-export.service.spec builds digest expectations from live `estimateTokens` output.

### `vcs.service.spec.ts` — 10 tests — **Essential**
Content-addressed commit ids, canonical serialization, rollback-as-revert-commit, dirty tracking. Key-order invariance pinned three times through three surfaces (`'serializes structurally identical books identically…'`, `'hashes key-order variants…'`, `'treats key-order-only differences as clean'`) — one of the three could go. `'stores a full snapshot, timestamp and moves HEAD'` never asserts the timestamp it names.

### `workspace.service.spec.ts` — 8 tests — **Useful**
Integration wiring (create → initial commit → lazy tabs, mutators, save banner). **Cleanest single trim in the unit suite**: `'maps a storage failure to the banner message and clears on recovery'` — its banner-string pin is held by `'reports a save failure when browser storage rejects writes'` and its clear-on-recovery pin is held by storage.service.spec's `'publishes a persistence failure and clears it after a successful put'`. `'commit clears dirty state; rollback restores deleted entries'` re-pins vcs.service's revert mechanics (its unique value is signal-state integration). Two tests under-deliver on their names (tabs / timestamp). Coverage is a slice of the 457-line service (`moveEntry`, `updateManyEntries`, `deleteProject` untested here — feature specs cover some).

---

## Unit — `src/app/features/entry-editor/` (batch 3) — 108 tests

The feared parent↔subpanel duplication turned out **not to exist** — `entry-editor.spec.ts` only smoke-mounts subpanels. The real overlap runs component↔service and service↔model.

### `entry-editor.spec.ts` — 25 tests — **Essential**
Sole coverage of tab management, strip wheel/drag helpers, EntryName, accordion behavior. Triple coverage of the constant/vectorized exclusivity invariant across three layers (this, entry-updates.service, lorebook.model) — each layer adds its own wiring, keep but be aware. **Gap**: the section-mount loop omits `app-entry-inclusion-group`.

### `entry-updates.service.spec.ts` — 20 tests — **Useful**
The field-mutation funnel (isUserInput gating, transient-entry guard, canonical order, delay levels, character filter). The 4-test trigger-strategy block re-tests `triggerStatePatch` already pinned in lorebook.model.spec — 1 integration test would suffice. `'normalizes the legacy verbatim native filter shape'` duplicates lorebook.model.spec's legacy-shape test. `addKey`/`removeKey`/`setPosition`/`setKeys` have no coverage here (addKey is only incidentally covered inside entry-keys.spec — misplaced, not duplicated).

### `entry-activation/entry-activation.spec.ts` — 10 tests — **Useful**
Form mapping/validation/defaulting pinned nowhere else. Three chip-write tests re-pin service-spec logic through the template (`'builds the generation-type filter…'`, `'toggles Ignore Budget…'`, `'flips the exclude chip…'`); positional boolean arrays are reorder-brittle.

### `entry-content-field/entry-content-field.spec.ts` — 7 tests — **Useful**
Stats (CJK tokenization), badge, dialog wiring are unique. The three malformed-wrapper tests re-pin `delimiters.spec.ts`'s classifier (same `<test>\nlore\n</universe>` fixture) — collapsible to one "renders the classifier's verdict" test. Contains one tautological assert: selecting `.malformed-hint` then asserting `classList.contains('malformed-hint')`.

### `entry-inclusion-group/entry-inclusion-group.spec.ts` — 8 tests — **Essential**
Sole coverage of the panel (the parent's mount loop skips it). ST-fidelity quirks (numeric score as truthy) included.

### `entry-keys/entry-keys.spec.ts` — 17 tests — **Essential**
The in-place editing state machine + focus guard, covered nowhere else. `'focuses the secondary key box…'` ≈ `'never steals focus for the chip box…'` (same mechanism, primary vs secondary) — one would do.

### `entry-matching-sources/entry-matching-sources.spec.ts` — 2 tests — **Useful**
Thin but honest set/unset pair; the only coverage. Index-based chip addressing is reorder-brittle.

### `entry-options-accordion/entry-options-accordion.spec.ts` — 2 tests — **Trim**
Keep `'binds the host mobile class to LayoutService.isMobile'` (unique viewport wiring). `'renders the always-visible trigger strip'` is a smoke test subsumed by the parent's composition tests; meanwhile the accordion's own strip behavior is tested only in the parent — coverage misplaced, not duplicated.

### `entry-placement/entry-placement.spec.ts` — 9 tests — **Essential**
Position↔numeric-mirror UI contract is export-critical and pinned nowhere else.

### `entry-recursion-timing/entry-recursion-timing.spec.ts` — 8 tests — **Useful**
The `true`↔null-level normalization is component-local and unique. The two guard-chip toggle tests re-cover `setDelayUntilRecursion` semantics the service spec pins — mergeable into one.

**Batch note**: all seven subpanel specs copy an identical ~25-line `createPane` helper — a shared test utility would remove real maintenance cost.

---

## Unit — remaining features + about/commit-history (batch 4) — 200 tests

### `about/about-dialog.spec.ts` — 8 — **Essential**. Fetch fallback, empty state, dual-container close are unique; changelog-parsing asserts overlap changelog.spec (defensible layering; the `CHANGELOG` fixture is copy-pasted into both files).
### `about/changelog.spec.ts` — 8 — **Essential**. Pure parser, every test a distinct edge.
### `commit-history/commit-history.spec.ts` — 16 — **Essential**. `'commits on Enter…'` re-pins the commit pipeline of `'creates a commit…'` (only the keydown trigger is new); `ago()` regex could flake on >60s-slow CI.
### `delimiters/delimiter-dialog.spec.ts` — 28 — **Trim** (biggest unit trim target). Dialog-unique wiring (scope select, banner, token deltas, sanitized-name hint, preview==apply) is worth keeping; `'strips a matching wrapper when None is picked'` is a strict subset of `'strips a foreign-named wrapper…'`; `'replaces a mismatched <foo>x</bar>…'` overlaps `'flags malformed rows…'`; two more tests re-pin core `delimiters.spec` semantics end-to-end.
### `entry-list/batch-operations-dialog.spec.ts` — 12 — **Useful**. Five extension-mirror assertions are verbatim-duplicated from `batch-operations.model.spec` (`'positions at chat depth carry the depth and role mirrors'` ↔ `'writes depth and role…'`, `'names an outlet position…'` ↔ `'writes the outlet name…'`, case-clear, constant-strategy, order-shift pairs) — the dialog versions add only status/snackbar plumbing.
### `entry-list/batch-operations.model.spec.ts` — 17 — **Essential**. Canonical home of the patch semantics.
### `entry-list/entry-list.spec.ts` — 26 — **Essential**. Selection/filter/drag semantics pinned nowhere else; no real overlap with the batch dialog (different code path: `setSelectionEnabled` → `updateManyEntries`). `'marks rows dirty against HEAD'` is a single weak assertion.
### `linter/linter-dialog.spec.ts` — 16 — **Essential**. Affordance rendering + the all-muted recovery regression only here. Prefs writes are double-pinned with linter-state.spec (mute chip ↔ `setRuleMuted`, not-an-issue/Undo ↔ `ignoreDiagnostic`/`undoAllIgnored`, same signatures) and `severityFixture()` is copy-pasted in both files.
### `linter/linter-state.spec.ts` — 13 — **Essential**. Memoization (same-reference asserts), badge-excludes-info, no-write guards — unique.
### `merge-resolver/export-selected-dialog.spec.ts` — 9 — **Essential**. Picker UI/guards/payload only here; dependency-warning asserts re-derive `checkExportDependencies` through the rendered alert (acceptable layering).
### `merge-resolver/export-selected.model.spec.ts` — 6 — **Essential**. Clean.
### `merge-resolver/merge-resolver-dialog.spec.ts` — 14 — **Essential**. Apply-outcome semantics (display_index preservation, vanished-local→skip) unique; no verbatim duplication with its model spec.
### `merge-resolver/merge-resolver.model.spec.ts` — 7 — **Essential**. Clean.
### `search-replace/search-replace-dialog.spec.ts` — 20 — **Essential** (structural note). De-facto also the model spec — `compileSearchPattern`/`escapeRegExp` have no `.model.spec` unlike every sibling folder; two internal near-dups (`'invalid regex'` leg of the guidance test re-asserts `'reports an invalid regex…'`; case-default re-asserts a hit count).

---

## Unit — shell + shared (batch 5) — 117 tests

### `shell/mobile-bottom-bar/mobile-bottom-bar.spec.ts` — 8 — **Essential**. Pins the exactly-one-`Toggle history drawer` control contract the e2e suite relies on; badge/export-menu asserts intentionally mirror topbar's.
### `shell/new-project-dialog.spec.ts` — 5 — **Essential**. Every validation branch.
### `shell/project-actions.service.spec.ts` — 24 — **Essential**. Highest-value file in the batch; mock-heavy by design but asserts real effects. Two thin pass-throughs (`'deletes the active project…'`, `'reopens a saved project by id'`) re-test WorkspaceService.
### `shell/topbar/token-inspector-dialog.spec.ts` — 7 — **Useful**. Rendering/edit contract real; arithmetic re-derives `computeTokenFootprint` (already covered in token-estimator.spec) and over-budget overlaps TokenMeter's test.
### `shell/topbar/topbar.spec.ts` — 22 (17 Topbar + 5 TokenMeter) — **Essential overall, Trim inside**. Overlay-routing invariants (`openResponsive` never bypassed) and badge semantics are excellent; the embedded TokenMeter describe near-duplicates token-inspector + token-estimator coverage (shrink to no-project + click-opens-inspector); three tests pin More-menu contents (one would do); `installMatchMediaStub` copy-pasted from mobile-bottom-bar.spec.
### `shell/welcome-screen/welcome-screen.spec.ts` — 6 — **Useful**. Click/Enter open pair are near-duplicates (same handler).
### `shared/components/confirm-dialog/confirm-dialog.spec.ts` — 7 — **Useful**. Default/custom label pair mergeable; otherwise clean and proportionally heavy for a 30-line template.
### `shared/components/diff-viewer/diff-viewer.spec.ts` — 15 — **Essential**. The split-row pairing algorithm and hunk navigation, every test a distinct branch, no mocks.
### `shared/directives/touch-safe-nested-menu-trigger.spec.ts` — 7 — **Essential**. Real shipped-bug regression spec through real Material menus; final teardown test is borderline can't-fail (acknowledged in comments).
### `shared/services/layout.service.spec.ts` — 4 — **Essential**. Single source of viewport truth; every test distinct.
### `shared/services/responsive-overlay.service.spec.ts` — 12 — **Essential**. The AGENTS.md-mandated chokepoint invariant, incl. the "omit `data` key" byte-contract; `'starts with no overlay open'` is a borderline tautological initial-state pin.

---

## E2E — `e2e/` (batch 6) — 86 declarations, ~155 executions

Config: 3 projects (desktop-chrome, mobile-chrome/Pixel 7, mobile-safari/iPhone 14). Every conditional skip has a complementary project that runs its describe — the "large skipped count" is purely breakpoint/project gating; **no test is skipped everywhere**.

### `about-dialog.spec.ts` — 7 tests — **Useful**. Mirrored desktop/sheet containers, not duplicates; only staging overlap with mobile-bottom-bar (which borrows the About sheet).
### `batch-and-tokens.spec.ts` — 5 tests — **Essential**. Deliberately ungated (all 3 projects × 5); sole coverage of token meter/inspector, batch, split export + download verification. Staging prefix near-duplicated between its two meter tests; shares select-2-rows staging with ui-responsiveness (copy-pasted helper).
### `delimiters.spec.ts` — 12 tests — **Essential**. Regression-dense (Task 05 U1, D4 guard). Overlaps: the two malformed-repair tests share ~60% of their contract (different fixtures, single- vs multi-line); the phone malformed test re-asserts identical strings as the desktop one in a different container; phone fullscreen asserts overlap ui-responsiveness' fullscreen-dialog test (split acknowledged in comments: layout there, transformation here). `exportWorldInfo`/`importLorebook` helpers duplicated verbatim with round-trip.spec.
### `linter.spec.ts` — 4 tests — **Essential**. No overlap with ui-responsiveness (the linter sheet is asserted only here — actually a small **gap**: `expectMobileSheetErgonomics` never runs against it). Test 1 is a mega-journey with coarse failure localization.
### `mobile-bottom-bar.spec.ts` — 7 tests — **Useful**. **True duplicate**: `'bar items meet the 48px mobile touch target'` is fully re-implemented by ui-responsiveness' touch-floor test (both assert exactly 5 `.bar-item`s at ≥48×48). Unique keeps: upward-menu geometry, hide-while-covered contract.
### `nested-menu-touch.spec.ts` — 2 tests — **Useful**. The suite's only literal sleeps (2 × `waitForTimeout(600)`), justified — the bug is an open-then-dismiss flash inside that window; a plain visibility waiter would pass pre-dismiss.
### `round-trip.spec.ts` — 5 tests — **Essential**. The per-attribute fidelity pin (never-drop-vendor-keys invariant). Cohesion nit: the theme-menu and tooltip-pointer tests are off-topic for the file name.
### `ui-responsiveness.spec.ts` — 42 tests, ~90 executions (~59% of the suite) — **Trim**. Whole-describe replay per width: desktop-1920 vs desktop-1280 duplicate all 6 tests (only the focus-mode pane-width assert differs ≥1920); mobile-390 vs mobile-412 duplicate all 12 — and the 412 leg on desktop-chrome is engine+size+touch-identical to mobile-chrome's descriptor. `'top bar never causes horizontal overflow'` is subsumed by the whole-DOM scan of `'no element overflows the viewport width'` (only the topbar-specific clip check is unique). Also owns the bar-item duplicate above and re-stages batch/export-selected with the same headings as batch-and-tokens. Unique contracts worth keeping once: tablet history-collapse, virtual-list fill poll, whole-DOM overflow scan, sheet ergonomics. No sleeps (`expect.poll` + `document.fonts.ready`).

---

## Cross-cutting synthesis

**Verdict distribution** — Essential: 39 files · Useful: 13 · Trim: 3 (`delimiter-dialog.spec.ts`, `entry-options-accordion.spec.ts`, `e2e/ui-responsiveness.spec.ts`) · Redundant: 0.

**True duplicates (delete one side, ~25 cases)**
1. e2e bar-item 48px check — mobile-bottom-bar vs ui-responsiveness (verified: both `.bar-item` ×5 at ≥48).
2. `isValidStRegex` describe — delegation re-test of the parse tables (st-regex.ts:91 is `parseStRegex(key) !== null`).
3. roundtrip addMemo describe / position-99 plain chain — duplicated vs lorebook.model.spec.
4. batch-operations-dialog's five extension-mirror asserts — verbatim from batch-operations.model.spec.
5. linter-dialog's mute/ignore prefs asserts — duplicated from linter-state.spec.
6. entry-updates.service trigger-strategy block (4 tests re-pinning `triggerStatePatch`).
7. delimiters.spec triple-asserted `<N>…\n---\n</N>` unwrap expect and its D4/blank-payload implied-composition tests.
8. vcs key-order invariance (3 surfaces), linter determinism (3 tests), st-key-match duplicate table rows.
9. ui-responsiveness per-width describe replay (1920/1280, 390/412) — the single largest runtime win.
10. Misc pairs: confirm-dialog label pair, welcome click/Enter pair, entry-keys focus pair, TokenMeter describe vs token-inspector/estimator, topbar's third More-menu test.

**Quality defects (fix, don't delete)**
1. `sha256.spec.ts:31` — `expect(sha256Hex(long)).toBe(sha256Hex(long))` can't fail; assert a known multi-block vector instead. (Verified.)
2. `token-estimator.spec.ts` `'estimates only the content…'` — fixture has no keys/comment, so the named exclusion is never exercised.
3. `workspace.service.spec.ts` / `vcs.service.spec.ts` — two tests whose names promise more than they assert (tabs, timestamp).
4. ui-responsiveness `expectMobileSheetErgonomics` only asserts scrolling when content overflows — a non-scrolling regression passes silently.

**Gaps found while auditing (not redundancy, noted for completeness)**
- `search-replace.model.ts` (`compileSearchPattern`/`escapeRegExp`) has no model spec — the dialog spec is its only pin; a `.model.spec` would match every sibling folder's pattern.
- `entry-updates.service` mutators `addKey`/`removeKey`/`setPosition`/`setKeys` untested in their own spec (addKey only incidentally, inside entry-keys.spec).
- Parent editor's section-mount loop omits `app-entry-inclusion-group` (the panel's own spec covers it).
- e2e `expectMobileSheetErgonomics` never applied to the linter bottom sheet.

**Infrastructure (no behavior change)**
- `importLorebook` copy-pasted in 6 of 8 e2e files; `exportWorldInfo` ×2; select-2-rows ×2 — a shared `e2e/helpers.ts` would remove ~150 lines.
- `installMatchMediaStub` ×2, `severityFixture` ×2, `createPane` ×7, `projectOf`/`constantEntry` builders ×3 in unit specs.
- Heavy `component['private']()` access across many component specs couples tests to internals (brittle, accepted style in this repo).

**Suite health** — `CI=true npm test -- --watch=false` re-run during this audit: exit 0 (all unit tests pass, coverage thresholds ≥80/75/80/80 enforced and met; per-file coverage table produced). No skipped, focused, or never-run tests anywhere. E2E not executed during this audit (static analysis only); no code was changed.

---

*Report generated 2026-09-19 by a read-only audit pass (six parallel analyses over 57 spec files, key findings spot-verified against source).*
