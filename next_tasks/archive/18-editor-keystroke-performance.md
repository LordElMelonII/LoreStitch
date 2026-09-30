# Task 18 — Entry-Editor Keystroke Performance on Large Lorebooks

## 1. Objective

Editing an entry in a 723-entry lorebook costs ~500 ms per keystroke (user
report 2026-09-27, measured). Root cause, confirmed by CDP CPU profiles
captured against the running dev server (probe artifacts under gitignored
`__screenshots__/perf-probe/`): every keystroke replaces the whole
`activeProject` signal, and every full-book derived computation re-runs
synchronously in that change-detection cycle:

| Consumer | Cost per keystroke (measured, 723 entries) |
|---|---|
| `LinterState.diagnostics` → `lintBook` recursion pair loop (`collectSubstringRanges`, O(V²), runs below the 1500-entry threshold) | **~770 ms** when entries are enabled + non-constant |
| `EntryList.items` (tokens + search haystack over every entry) | ~15 ms |
| `tokenFootprint` (topbar) | ~13 ms |
| `VcsService.isDirty` whole-book canonical serialization | ~7 ms |
| IndexedDB put (per 400 ms save debounce) + CDK virtual row churn (`*cdkVirtualFor` untracked, `templateCacheSize: 0`) | ~20–40 ms |

Fix, in one pass (user decision 2026-09-27: "everything in one pass"),
layered so each layer is independently sound:

1. **Cadence** — continuous text edits commit to the workspace on idle
   (trailing debounce in `entrySliceSignal`), so a keystroke costs one form
   write + one textarea render, O(1) in book size.
2. **Cost** — identity-keyed memoization of the pure per-entry derivations
   (tokens, search haystack, entry-scoped lint), so the once-per-settle
   book-wide pass is O(changed) + O(V) cheap walks.
3. **Graph rules** (option (b), user-approved 2026-09-27) — the linter's
   `recursion-cycle`/`self-trigger` pass stops feeding the live topbar badge;
   it computes only while the health pane is open (computed laziness does the
   gating). Consistent with the product's existing stance: those rules are
   already skipped outright above 1500 entries.
4. **Riders** — `trackBy` on the entries virtual scroll; `isDirty` positional
   comparison instead of whole-book canonicalization.

Success targets (re-measured with the same probe methodology): keystroke wall
time < 50 ms on the 723-entry probe book; settle-window pass < 100 ms; full
three-project Playwright matrix green; no exported-byte or lint-output changes
beyond the documented badge-semantics change (§6).

**User-directed exception**: this task executes directly on `develop` — no
`feature/` branch (user instruction 2026-09-27, overriding the default task
branch rule). Phase commits still land as atomic Conventional Commits.

## 2. Grounding (develop @ `a384720`, surveyed 2026-09-27)

- `entry-content-field/entry-content-field.ts:58` — the content textarea is a
  Signal Form over `entrySliceSignal`; every keystroke funnels through the
  write effect → `WorkspaceService.updateEntry` → `mutateProject`
  (`workspace.service.ts:508`) → new project object → debounced IndexedDB save.
- `entry-edit-form.ts:59` `entrySliceSignal` — the ONE shared workspace↔form
  mirror; consumed by the content field, entry name, and any other text slice.
  Two effects: workspace→form reseed (gated by `echoing`), form→workspace
  write (guarded by `jsonEqual(pick(entry), slice)`).
- `linter-state.ts:41` — `LinterState.diagnostics` is a `computed()` read by
  the always-rendered topbar badge (`topbar.html:89`) → full `lintBook` per
  project mutation. `unfilteredRules` is read only while the pane is open
  (laziness already exploited there).
- `linter.ts:321` `lintBook` — entry-scoped rules, duplicate-key buckets
  (cheap, ~5 ms), and the recursion graph (O(V²) pair loop,
  `linter.ts:747-781`); `LARGE_BOOK_THRESHOLD = 1500` guards the graph only.
- `vcs.service.ts:58` — `canonicalSerializations` WeakMap precedent:
  memoization by object identity is valid under the app-wide
  immutable-update invariant (untouched entries keep identity across
  mutations). `isDirty` serializes the whole book (fresh identity per
  keystroke → memo never helps); `dirtyEntryIds` is already per-entry.
- `entry-list.ts:206` `items` — rebuilds all row view models per mutation;
  `entry-list.model.ts:44` documents the per-entry memoization fallback as
  "deliberately not built now" (next_tasks/07 §7.2) — this task builds it.
- `entry-list.html:162` — `*cdkVirtualFor` without a track function;
  `templateCacheSize: 0`.
- Fake-timer house pattern for debounces: `vi.useFakeTimers({ toFake:
  ['setTimeout', 'clearTimeout'] })`, settle with `detectChanges()` +
  `advanceTimersByTimeAsync` (AGENTS.md, topbar.spec precedent). Existing
  debounce precedents: search filter (`debouncedSignal`,
  `SEARCH_DEBOUNCE_MS`), storage save (`SAVE_DEBOUNCE_MS = 400`).

## 3. Design decisions (locked with the user, 2026-09-27)

### D1 — Idle-commit in `entrySliceSignal` (`entry-edit-form.ts`)

- Write effect no longer writes immediately; it arms a **300 ms trailing
  debounce** (new exported constant `EDIT_COMMIT_DEBOUNCE_MS = 300` in
  `entry-editor.constants.ts`). The `jsonEqual(pick(entry), slice)` no-op
  guard still applies before arming — no-op edits never arm the timer.
- A pending draft is flushed by: (a) timer elapse; (b) **injection-context
  `DestroyRef`** (field/section torn down — tab close, pane switch);
  (c) **external entry replacement** (see merge rule below).
- Timer-path writes self-identify through pick-equality: after our own write
  lands, `pick(entry) === slice`, so the reseed effect's `model.set` is
  dropped by the signal's `equal` fn — no echo loop, no `echoing` flag needed
  for the async path. `echoing` remains only for synchronous in-effect
  writes (the merge write below).
- **Merge rule on external replacement while a draft is pending** (the one
  subtle case — external here means any entry replacement the mirror didn't
  write: batch dialog, delimiter apply, options toggle, another editor
  tab…). Track the last-seen entry reference in the reseed effect. On
  external change:
  - Compute the externally-changed fields = keys where
    `incoming[k] !== lastSeen[k]`.
  - Fields outside the slice: irrelevant to the mirror; **re-apply the
    draft** (`updateEntry(id, toPatch(incoming, slice))`) so a content draft
    survives an `enabled` toggle, position change, etc.
  - Fields the external patch shares with the slice's `toPatch` output:
    **external wins** — the newer explicit user action (e.g. a delimiter
    re-wrap applied while typing) must not be clobbered by a stale ≤300 ms
    draft. The model re-seeds from `pick(incoming)` and the pending draft is
    dropped (timer cleared).
- Known narrow race, documented not defended: a timer-path flush immediately
  followed by an external same-field write inside the same change-detection
  cycle could swallow the reseed. Two user actions cannot land in one tick;
  the merge rule covers every user-reachable ordering.
- Scope: all `entrySliceSignal` consumers uniformly (content, name, any
  future slice). Discrete controls (chips, toggles, selects) do not route
  through the mirror — they keep immediate writes via `EntryUpdatesService`.
- Observable timing changes (accepted): tab dirty stars, sidebar row token
  counts, and the save debounce now trail typing by ≤300 ms. The textarea
  itself keeps per-keystroke rendering from the local Signal Form.

### D2 — Identity-keyed per-entry memoization (`core/services/entry-memo.ts`)

New bare module (no decorator — the `sha256.ts`/`token-estimator.ts`
convention for pure code in services/), internal WeakMaps, correctness
resting on the same immutable-update invariant as
`canonicalSerializations`:

- `memoEntryTokens(entry: CharacterBookEntry): number` — wraps
  `estimateTokens(entry.content ?? '')`. Adopted by `EntryList.items` and
  `computeTokenFootprint` (token-estimator.ts stays primitive-pure; the
  entry-keyed wrapper lives in the new module so core stays free of memo
  state).
- `memoEntryHaystack(entry: CharacterBookEntry): string` — wraps
  `entrySearchHaystack(entryTitle(entry), entry.keys, entryTags(entry),
  entry.content ?? '')`. Adopted by `EntryList.items`.
  (`entry-list.model.ts` keeps exporting the primitive function — the memo
  composes it; the §7.2 "fallback now built" note gets a one-line update.)
- `memoEntryLint(entry: CharacterBookEntry): readonly LintDiagnostic[]` — all
  five entry-scoped rules for the entry. **Only memoizes id-carrying
  entries**; id-less entries (hand-built test books) fall through uncached,
  because `entryRefId` is index-based there and a reorder would stale the
  cache. Workspace books always carry ids. Returns the unfiltered per-rule
  diagnostics (emission order preserved); `mutedRules`/`ignored` filtering
  stays with `lintBook` so the pinned options semantics are untouched.
- No clear/invalidate API: WeakMap + GC (same as the VCS memo). Spec note for
  reviewers: memoized functions are observably pure — same entry → same
  output.

### D3 — `lintBook` split (linter.ts)

- `lintBook(book, options?)` **output is byte-identical** for every existing
  call shape (pinned by linter.spec.ts) — internally it now sources
  entry-scoped diagnostics from `memoEntryLint` and applies
  `mutedRules`/`ignored` filtering at aggregation.
- New `LintOptions.includeGraphRules?: boolean` (default `true` — preserving
  the no-options contract). `false` skips the recursion graph AND its
  large-book skip note; duplicate-key buckets stay in both modes (~5 ms,
  keeps the badge meaningfully complete).
- `LARGE_BOOK_THRESHOLD` logic unchanged for the graph pass.

### D4 — `LinterState` split (linter-state.ts)

- `diagnostics` (existing name, full pass incl. graph rules) — read only by
  the health pane. Angular computeds are lazy: the graph pass runs only
  while the pane is open, and the pane overlays the editor, so there is no
  simultaneous-typing worst case in practice.
- New `entryDiagnostics` — `lintBook(book, { …prefs,
  includeGraphRules: false })`; `issueCount` (the topbar badge) reads it.
  Badge semantics change (approved): recursion-cycle and self-trigger
  findings no longer count live; they appear when the health pane opens.
- `unfilteredRules` unchanged (pane-only reader, full pass).

### D5 — `VcsService.isDirty` positional comparison

- Replace whole-book `serializeBook` with: memoized shell serialization
  (`{...book, entries: []}` vs head's — book-level fields only) + entry
  count equality + per-position `serialize(work[i]) !== serialize(head[i])`
  (both sides identity-memoized after first sight). Decomposition is exact:
  canonical whole-book equality ⇔ shell equal ∧ same length ∧ positional
  entry equality. Catches reorder (positional, where `dirtyEntryIds` is
  id-matched and silent), book-field patches, adds, deletes — each pinned by
  a new unit case.
- `WorkspaceService.hasUnsavedChanges` delegates to it as today (semantics
  unchanged, cost now O(V) memo hits).
- `dirtyEntryIds` already per-entry-memoized — untouched.

### D6 — Virtual scroll trackBy (entry-list.html)

- `trackById` on the `*cdkVirtualFor` rows (verify the installed CDK's
  binding spelling — microsyntax `trackBy:` vs explicit
  `[cdkVirtualForTrackBy]` on the host element — and use what compiles).
  `templateCacheSize: 0` stays (deliberate, unchanged).

## 4. What does NOT change

- Exported bytes, `validateBook` flows, VCS commit hashes
  (`hashBook` keeps whole-book canonicalization — content-addressing must
  not change), `dirtyEntryIds` semantics, delimiter content contract,
  `mutateProject` chokepoint and the debounced save, dual-container rules.
- `lintBook(book)` / `lintBook(book, {})` exact output (pinned).
- Search filter debounce behavior.

## 5. Test matrix

New/changed unit specs (migrate pins in the same phase as the change):

- **New `entry-edit-form.spec.ts`** (TestBed, fake timers per house pattern):
  debounce commits once after idle (not per keystroke); flush on DestroyRef;
  no-op edit never arms; external non-slice patch re-applies the draft;
  external slice-field patch wins and reseeds; reseed of our own committed
  write is a no-op (no echo).
- `entry-content-field.spec.ts` / entry name spec: stats update per
  keystroke from the form model (unchanged); workspace write timing pins →
  migrate to timer-advanced assertions.
- `workspace.service.spec.ts`: `hasUnsavedChanges` cases — reorder,
  book-field-only patch (`updateBook`), add, delete, shell-only change.
- `linter.spec.ts`: `includeGraphRules: false` skips graph + skip-note;
  memoized path ≡ non-memoized output on a rotated (identity-varying) book;
  id-less entries bypass the memo correctly.
- `linter-state` / `topbar.spec.ts`: badge counts entry-scoped rules only;
  dialog still lists graph findings.
- `entry-list.spec.ts`: `items` outputs unchanged; token/haystack values
  identical after memo adoption (id-based trackBy if pinned).
- E2E greps (`e2e/`): specs typing into the editor then asserting dirty
  stars / export / delimiter apply — Playwright auto-waiting absorbs the
  300 ms commit; verify, migrate only if a pin is genuinely timing-exact.
  Linter badge count pins: migrate to entry-scoped counts.

## 6. Verification gates

- Per-phase fast gate (orchestrator runs between dispatches): `npm run build`,
  `CI=true npm test -- --watch=false --coverage` (thresholds enforced),
  `npm run lint`, `npm run typecheck:e2e`, plus `desktop-chrome` smoke of
  the specs the phase touched.
- Human-signoff items — **pre-approved 2026-09-27 in-session** (recorded
  here as the checkpoint evidence): (1) badge excludes graph findings live
  (option (b)); (2) ≤300 ms commit lag for text-field workspace writes and
  its spec migrations. No visual design spec → no screenshot baseline (no
  UI reshape; badge semantics only).
- Final sweep (no branch → before handing back): full three-project matrix
  (`npx playwright test --project=desktop-chrome` / `mobile-chrome` /
  `mobile-safari`, each its own command), final `npm test --coverage` +
  `npm run lint`.
- Perf evidence: re-run the CDP keystroke probe
  (`__screenshots__/perf-probe/profile-keystrokes.mjs`, both variants)
  before the first commit and after the last; post old-vs-new tables in the
  phase report. Red spec loops back fix-forward; two failed attempts → stop
  and escalate.

## 7. Implementation plan (phases)

| Phase | Owner | Deliverable (atomic commit on `develop`) |
|---|---|---|
| P1 | `core-engine` | D2 `entry-memo.ts` + adoption in `computeTokenFootprint`; D3 lint split; D4 LinterState split; D5 isDirty positional. Spec updates of §5 touching core. |
| P2 | `ui-specialist` | D1 idle-commit in `entrySliceSignal` (+ constant, DestroyRef, merge rule); D6 trackBy; `EntryList.items` memo adoption. New + migrated specs of §5. |
| P3 | `ts-reviewer` | Strict-typing/lint review of P1+P2; no loose types, memo purity documented at the module head. |
| P4 | `qa-auditor` | Full §5 verification, fast-gate suite, desktop-chrome smoke of touched specs, perf probe re-run + report. |
| P5 | orchestrator | Final three-project matrix + coverage + lint; TEST-REPORT/PROGRESS notes; stop for user testing. |

## 8. Risks & trade-offs

- **Draft/external merge (D1)** is the one genuinely new semantic — covered
  by the dedicated spec file; delimiter-apply-while-typing is the guarded
  e2e-visible case.
- **Health pane open + graph pass**: worst case (~770 ms) now only while the
  pane is open; accepted (modal overlay, no typing surface behind it).
  Incremental adjacency caching is the documented future follow-up if live
  cycle counts are ever wanted at this scale.
- **Memo memory**: haystack strings ≈ one content-sized string per entry
  (already the case pre-memo — the memo reuses, not duplicates); diagnostics
  arrays are small.
- **No branch**: a bad phase commit on `develop` is reverted with
  `git revert` (history stays linear; no force-push).
