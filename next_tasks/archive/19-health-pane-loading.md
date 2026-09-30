# Task 19 — Health-Pane Loading Progress + Recursion-Graph Memoization

## 1. Objective

Opening the lorebook health pane on a large book freezes the app for
2.2–5.4 s with no feedback (user report 2026-09-27, measured — see §2), and
every mute-chip / ignore click while the pane is open repeats the freeze. The
user-approved fix (checkpoint 19-0, 2026-09-27): the pane opens instantly into
a loading state with a **determinate progress bar** ("Checking lorebook
health…"), the check runs **chunked** so the bar genuinely animates, recursion
match verdicts are **memoized per entry pair** so repeat passes stop paying
O(V²), and the pane's two full passes collapse into **one shared pass**.

This is the task-18 §8 documented follow-up ("incremental adjacency caching is
the documented future follow-up") plus the loading UX the 18 handoff surfaced.

Success targets (same methodology as the §2 baseline): time-to-pane-visible
< 100 ms on the probe books (pane renders with the loading state immediately);
progress visibly animates during the pass (no main-thread freeze longer than
~50 ms per chunk); time-to-results on the heavy probe book ≤ the single-pass
baseline (~2.7 s, halved from the 5.4 s double pass); chip toggle / reopen
after a first pass near-instant (< 200 ms); `lintBook` sync output byte-
identical for every existing call shape (existing pins unchanged).

## 2. Grounding (feature branch @ `323fbd3`, measured 2026-09-27)

Health-pane open → results visible, 723-entry synthetic books, click-to-`.summary`
wall time (`__screenshots__/perf-probe/measure-pane-open.mjs`, kept as the
re-measure tool; dev = 4321 ng serve, prod = 4400 static `dist/`):

| Book | dev cold | prod cold | cached reopen |
|---|---|---|---|
| 723 × ~430-char contents | 2 368 ms | 2 167 ms | ~800 ms |
| 723 × ~1 720-char contents | 5 356 ms | 5 336 ms | ~780 ms |

- **Production ≈ dev** (~5–10 %): raw algorithmic cost, not dev-mode overhead.
- Mechanism: the pane template reads `LinterState.diagnostics()` (full pass,
  `linter-state.ts:56`) AND `unfilteredRules()` (second full pass,
  `linter-state.ts:114`) — **two** O(V²) graph passes per open, and both
  re-run after every project mutation while the pane is open (mute chip,
  ignore, prefs write). The task-18 entry memo covers the entry-scoped rules
  only; the recursion graph's pair loop (`linter.ts` `lintRecursion`) and the
  per-target key plans (`prepareTargetKeys`) are recomputed every time.
- The user's book profile ≈ the heavy row (≤ 1500 entries — above
  `LARGE_BOOK_THRESHOLD` the graph pass skips and open is fast).
- `lintBook` is pure/deterministic; the graph pass is a per-source loop over
  prebuilt targets (`lintRecursion`), a clean resumable boundary.
- In-app progress idiom: the About dialog's `MatProgressSpinner`
  (`about-dialog.ts:15`) — the only progress UI in the app today.

## 3. Design decisions (locked with the user, checkpoint 19-0, 2026-09-27)

### D1 — One resumable pass engine; `lintBook` unchanged on top

Refactor `linter.ts` internals so the three phases (entry-scoped rules,
duplicate-key buckets, recursion graph) drive from one shared engine with a
resumable graph loop. `lintBook(book, options?)` stays the exact synchronous
API — run the engine to completion — so its pinned output contract cannot
drift. New async chunked variant (e.g. `lintBookChunked(book, options?, signals)`)
walks the same engine, yielding to a scheduler every N sources / entries so
the main thread breathes; it collects with the same emission order and applies
the same final sort, so its result is byte-identical to `lintBook`'s for the
same input. Chunk cadence is an implementation detail of the driver — small
chunk sizes in tests must not change output.

### D2 — Pair-level verdict memoization (identity-keyed, the task-18 pattern)

Module-level WeakMaps in `linter.ts` (the `canonicalSerializations` precedent —
linter keeps its own memo state; `entry-memo.ts` stays per-entry only):

- per-target key plan (`prepareTargetKeys`) keyed by target entry identity;
- per-pair match verdict `WeakMap<source, WeakMap<target, string | null>>`
  (the matched spelling or null) keyed by both entries' identities.

Correctness rests on the app-wide immutable-update invariant: a changed entry
is a new object, so every pair involving it recomputes; untouched pairs hit.
The folded source content (`content.slice(0, MATCH_CONTENT_CAP).toLowerCase()`)
is derived per source as today (cheap, O(V)). Muted-graph semantics are
unaffected (muting still skips the graph outright in the sync path).

### D3 — One shared pass in `LinterState`

`unfilteredDiagnostics = lintBook(book)` (full, unfiltered) becomes the single
computed the pane consumes; `diagnostics` (the pane's filtered list) and
`unfilteredRules` (chip membership) derive from it by pure post-filtering —
byte-identical output, since muting/ignoring are emission-level skips and
post-filtering by rule id / signature selects exactly the same diagnostics.
Cost note: a muted graph rule no longer short-circuits the shared pass, but
D2 makes the graph near-free after the first computation, which is the
dominant case (pane open repeatedly). The topbar badge keeps the task-18
graph-free sync pass (`entryDiagnostics`) and is untouched.

### D4 — Pane loading state (checkpoint-approved visual)

- The pane opens instantly (no blocking computed in its render path) and shows
  a **determinate `mat-progress-bar`** + "Checking lorebook health…" while the
  chunked check runs; results replace the loading state when done. Exemplar:
  the app's progress idiom (About dialog's progress module); no `::ng-deep`,
  no new control shapes; identical state in the desktop dialog and the phone
  bottom sheet (same component, `ResponsiveOverlayService` containers).
- Progress source: the chunked driver reports phase + fraction (entry-scoped →
  duplicate-key → graph); the bar maps it honestly (the graph phase dominates
  wall time on large books).
- Cadence: opening the pane (and each project mutation while it is open)
  starts a fresh chunked run; a newer run supersedes a stale one (mutation mid-
  run restarts the check — consistent with the pane's live-recompute contract).

## 4. What does NOT change

- `lintBook(book)` / `lintBook(book, {})` byte-identical output (existing pins).
- The topbar badge (graph-free pass), `LARGE_BOOK_THRESHOLD` skip behavior,
  diagnostic copy/severity/ordering, jump/mute/ignore flows' semantics.
- Exported bytes, commit hashes, `dirtyEntryIds`, the mutateProject chokepoint.
- The task-18 idle-commit and memo modules (except where the shared pass
  replaces `LinterState` internals).

## 5. Test matrix

- `linter.spec.ts`: chunked variant ≡ `lintBook` output on the existing
  fixtures (same options, several chunk sizes incl. pathological 1-source
  chunks); verdict-memo equivalence (edit one entry → identical diagnostics,
  untouched pairs memo-hit — assert via re-run equality, not internals);
  deep-frozen immutability still holds; >1500-entry skip unchanged.
- `linter-state.spec.ts`: shared-pass derivation — `diagnostics` ≡ the old
  prefs-filtered pass (incl. muted graph rule cases), `unfilteredRules`
  membership unchanged; badge path untouched.
- `linter-dialog.spec.ts`: loading state renders before results; progress
  advances; results replace it; mute-chip/ignore/jump flows work off the async
  results; stale run superseded by a newer mutation.
- E2E (`linter.spec.ts`): pane still reaches results (auto-waiting absorbs the
  async load); migrate any timing-exact pins; desktop-chrome smoke in-task.
- Perf evidence: re-run `measure-pane-open.mjs` before/after; post tables in
  `19-PROGRESS.md`.

## 6. Verification gates

- Per-phase fast gate (orchestrator): build, unit+coverage, lint,
  `typecheck:e2e`, desktop-chrome smoke of touched specs.
- Checkpoint 19-0 (pre-approved 2026-09-27 via the design-checkpoint question):
  full fix scope + determinate progress bar with the copy above. Any further
  visual deviation stops at the gate.
- Screenshots: the loading state and the unchanged results view captured under
  `__screenshots__/19-health-pane-loading/{before,after}/` (pinned conditions
  per AGENTS.md; the loading state only exists on the after side — the before
  pane renders results directly).
- Final sweep: full three-project matrix per project, coverage + lint, then
  push the branch and stop for user testing (no self-merge).

## 7. Phases

| Phase | Owner | Deliverable |
|---|---|---|
| P1 | `core-engine` | D1 resumable engine + chunked variant; D2 verdict/plan memos; D3 `LinterState` shared pass; §5 core specs |
| P2 | `ui-specialist` | D4 pane loading state + async driver wiring; §5 dialog specs; screenshots |
| P3 | `ts-reviewer` | Typing/lint review of P1+P2 diffs |
| P4 | `qa-auditor` | §5 end-to-end, gates, desktop smoke, e2e pins, pane-open re-measure |
| P5 | orchestrator | Full matrix, coverage + lint, `19-PROGRESS.md`, push branch |

## 8. Risks

- **Chunked/sync divergence**: mitigated by one shared engine (D1) — the async
  variant is the sync path with yields; boundary-straddling tests pin equality.
- **Memo staleness on vendor-shaped entries**: hand-built books without ids are
  index-keyed in the task-18 lint memo — the pair memo keys on object identity
  only, so id-less books are safe (no index in the key); reorders reuse verdicts
  correctly because verdicts depend on the pair's objects, not positions.
- **Progress honesty**: the graph phase dominates; a bar that jumps is worse
  than a smooth one — weight phases by measured share, not guesswork.
- **Muted-graph cost regression** (D3): bounded by D2; noted for the ledger.
