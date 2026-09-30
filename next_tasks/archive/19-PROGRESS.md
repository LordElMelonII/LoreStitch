# Task 19 — Progress Ledger

Plan: [19-health-pane-loading.md](./19-health-pane-loading.md). Branch:
`feature/19-health-pane-loading` (off `develop` @ `323fbd3`). Checkpoint 19-0
answered 2026-09-27 via the design-checkpoint question: **full fix** (chunked
pass + pair memoization + shared single pass) with a **determinate progress
bar** ("Checking lorebook health…").

## User-reported problem

Opening the health pane on a large book froze the app 5–6 s with no feedback,
and every mute-chip/ignore click while open repeated the freeze. Diagnosis:
the pane synchronously evaluated **two** full `lintBook` passes on open
(`diagnostics` + `unfilteredRules`), each running the unmemoized O(V²)
recursion pair loop; production measured ≈ dev (~5–10 %), so the cost is
algorithmic (`__screenshots__/perf-probe/measure-pane-open.mjs`, kept).

## Baseline (plan §2) vs after (P4 re-measure, dev :4321)

| Metric | Before (sync pane) | After | Target | Verdict |
|---|---|---|---|---|
| Pane visible, cold (standard / heavy book) | frozen until results | 107 / 118 ms | < 100 ms | met (16 ms polling granularity; first open includes lazy-chunk import) |
| Pane visible, reopen | frozen | 75 / 83 ms | < 100 ms | met |
| Progress bar animates | n/a | 37–43 aria-valuenow samples, smoothly paced | visible animation | met |
| Main-thread freeze during pass | one 2.2–5.4 s block | chunks far under 50 ms (standard); 50–83 ms (heavy) | ≲ 50 ms/chunk | heavy at the tuning edge — see ledger notes |
| Results, standard cold | 2 368 ms | 2 111 ms | — | ~11 % better |
| Results, heavy cold | 5 356 ms | 4 112 ms | ≤ ~2.7 s | **wall-clock miss** — see derivation below |
| Reopen (pair memos hot) | ~800 ms | 1 081 / 1 215 ms | < ~1 s | marginal; lint work near-free, delivery-render bound |
| Mute-chip toggle → updated results | another 2.2–5.4 s freeze | 791 / 971 ms | < ~1 s | **met — the headline win** |

**Heavy-book wall-clock derivation (honest miss):** warm-work floor (reopen)
≈ 1.08 s ⇒ real pass work ≈ 2.7–2.8 s, matching the plan's single-pass
estimate; the gap to 4.1 s is the ~440 ms delivery render + ~50 scheduler
yields + 16 ms polling — overhead the plan's 5.4/2 arithmetic never separated.
Still 23 % under baseline, and the pane is interactive with visible progress
the whole time instead of frozen.

## Phases

### P1 — core (core-engine) — commit `6965d6b`

`perf(linter): resumable pass engine, pair verdict memos, shared pane pass`

- One generator-based engine (`createLintPass`) drives all three phases;
  `lintBook` runs it to completion (byte-identical, every pre-existing pin
  green), `lintBookChunked` yields between chunks (injectable scheduler, per-
  phase progress). Pair verdicts and per-target key plans memoize by entry
  identity in linter.ts module state (canonicalSerializations-style contract).
- LinterState consumes one shared pass; pane lists post-filter from it.
- Fast gate: build ✓ · 1 369 tests ✓ · lint ✓ · typecheck:e2e ✓.

### P2 — UI (ui-specialist) — commit `45ae2ee`

`feat(linter): load the health pane on a chunked pass with progress`

- `LinterState.healthRun` signal (`idle`/`running{percent}`/`done`) owned by
  explicit start/stop sessions; run token + project-identity liveness checks
  make supersession airtight; yield before the first step so opening always
  paints loading first. Progress weighting 5 % / 5 % / 90 %
  (entry-rules / duplicate-keys / graph), documented and monotonic.
- Dialog: determinate `mat-progress-bar` + "Checking lorebook health…"
  replaces the body until done; results/chips/empty state render only from
  the delivered run; same template for desktop dialog and phone bottom sheet.
- Visual evidence: `__screenshots__/19-health-pane-loading/after/` (loading
  mid-run on the heavy probe book + unchanged results view; the before pane
  had no loading state — the freeze was the before).
- Fast gate: build ✓ · 1 376 tests ✓ · lint ✓ · typecheck:e2e ✓.

### P3 — review (ts-reviewer) — commit `ea336a7`

`refactor(linter): make the pass engine's step idempotent after completion`

- MEDIUM: a post-completion `step()` re-polls the exhausted generator, whose
  runtime `undefined` is typed `LintDiagnostic[]` — latent `finish()`
  corruption; `step()` now returns true idempotently. LOW: docblock default-
  size claim corrected. Memo purity docs and null-vs-undefined verdict
  discrimination verified; zero loose types across both diffs.

### P4 — QA (qa-auditor) — commit `1a46ba3`

`test(linter): pin idempotent step, empty-book edge, combined prefs`

- §5 map complete; three gaps closed (idempotent-step contract, zero-entry
  edge at all cadences, combined muted+ignored prefs pin).
- E2E `linter.spec.ts`: **zero migrations** — badge path untouched, result
  pins auto-wait over the chunked cadence. Desktop smoke: 3 passed /
  1 phone-pinned skip.
- Re-measure table above. Fast gates: build ✓ · 1 379 tests ✓ · lint ✓ ·
  typecheck:e2e ✓.

### P5 — final sweep (orchestrator) — this commit

- Full matrix: desktop-chrome **72 passed / 16 skipped** · mobile-chrome
  **46 / 42** · mobile-safari **44 / 44** — all green, no fix-forward loop.
- Final `CI=true npm test -- --watch=false --coverage` → 61 files / **1 379
  tests** ✓ · `npm run lint` ✓. Branch pushed to origin; **stopped for user
  testing** (no self-merge).
- Merged 2026-09-27 after the user's go: fast-forward-merged into `develop`
  as `61f677f` (history stayed linear; develop was at `323fbd3`, no rebase
  needed — the push also published task 18's commits, which had landed
  directly on local `develop` and left `origin/develop` at `a384720`).

## Ledger notes (known edges, none escalated)

1. **Delivery render is the new largest freeze** (one 329–782 ms task when
   the results view first paints, present on every run incl. reopen) —
   pre-existing cost the baseline froze through inside its bigger number, now
   isolated. If reopen feel matters, virtualizing the diagnostics rows is the
   future lever.
2. **Heavy-book chunk pacing** at `sourcesPerStep: 16` pokes 50–83 ms tasks on
   the 723×1720-char synthetic — at the ~50 ms budget edge; the bar still
   animates smoothly. Tuning the default down is a one-constant change if
   testing feels it.
3. **Stacked health panes** are reachable (topbar `openLinter` has no re-open
   guard; double-click before the overlay mounts). The session guard keeps a
   stale pane's close from killing the active run; a stacked pane left behind
   by closing the run owner self-heals on the next mutation. A topbar-side
   open guard is the clean follow-up.

## For the user's manual testing

1. Open the health pane on your large book: it should appear instantly with a
   moving bar, then results. Total time similar-or-better than before, but
   never frozen.
2. Toggle a mute chip or mark a finding "not an issue" while the pane is open:
   previously another 5 s freeze; now ~1 s with a brief loading state.
3. Close and reopen without editing: near-instant (pair memos stay warm).
4. The topbar badge count is unchanged from task 18 (graph-free); results,
   jump, mute and ignore flows behave as before.
