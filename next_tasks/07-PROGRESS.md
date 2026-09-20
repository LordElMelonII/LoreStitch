# Task 07 — Progress Ledger

Plan: [07-search-responsiveness.md](./07-search-responsiveness.md)
Branch: `feature/07-search-responsiveness` (off `develop` @ `ba67c85`)

## Phase 0 — Prep & re-ground (2026-09-20)

- Re-grounded the plan against `develop` @ `c05592a`: verified
  `entry-list.ts:158-159` (filterForm) / `:179-192` (items) / `:205-230`
  (filtered, per-keystroke `toLowerCase()` folds), `search-replace-dialog.ts`
  (`:80-88` patternError, `:90-101` rows, `:112-163` matchEntry double pass),
  `storage.service.ts:19` (`SAVE_DEBOUNCE_MS = 400` precedent),
  `entry-list.spec.ts:113-130` (sync filter pins to migrate). **No drift** —
  Task 06's gate-blocked phases (P2–P4) never touched these files; P1 of 06
  touched only shell/bar files. Note: the S&R dialog lives at
  `src/app/features/search-replace/` (plan cites the file by name).
  `src/app/shared/util/` does not exist yet — P1 creates it.
- Branch `feature/07-search-responsiveness` created; develop's two re-ground
  docs commits pushed to origin.
- Gates run: none yet (docs-only phase).
- Decisions/deviations: none.

**Next:** P1 (core-engine) — §3.1 `debounced-signal` primitive (+spec, fake
timers), `SEARCH_DEBOUNCE_MS = 200` constant, §3.2 pure haystack builder.
Gate: `npm test`.

## Phase 1 — Pure helpers (2026-09-20, core-engine)

- Commit: `8d32256 feat(shared): add a debounced signal primitive and search haystack helper`
- Files: `shared/util/debounced-signal.ts` (+spec, 7 tests: outside-context
  error, no initial timer, 199/200ms trailing edge, rapid-set collapse,
  flush immediate/disarm/idle-no-op, destroy drops pending, re-arm after
  flush), `shared/constants/search.ts` (`SEARCH_DEBOUNCE_MS = 200`),
  `entry-list.model.ts` (+ pure `entrySearchHaystack` / `matchesQuery`,
  `EntryListItem` untouched — P2 wires it), new `entry-list.model.spec.ts`
  (5 tests incl. the legacy-per-field-scan equivalence pin), folder READMEs
  (`shared/util/README.md` new; constants + shared READMEs updated).
- Implementation note for P2: the mirror settles via a plain `settled`
  variable, so its effect depends only on `source` — no re-run churn.
  `DebouncedSignal` is built by `Object.assign(mirror, { flush })` to satisfy
  Angular 22's `Signal<T>` brand.
- Gate: `CI=true npm test -- --watch=false` **green** (54 files, 0 failures;
  coverage 95.82/89.18/90.81/97.32; both new sources 100%). `npm run lint`
  also passed as a self-check (formal lint gate is P3).
- Deviations: none from the pinned API. Judgment calls flagged: (1)
  `Object.assign` brand trick above; (2) `SEARCH_DEBOUNCE_MS` has no spec
  reference until P2 wires it (v8 coverage only counts loaded files — same
  state as the pre-existing `touch-targets.ts`).

**Next:** P2 (ui-specialist) — wire debounce + haystack into the sidebar
filter (`entry-list.ts/.html` + spec migrations) and the S&R dialog
(`search-replace-dialog.ts` + spec). Gate: `npm test` + `npm run build`.

## Phase 2 — Wiring (2026-09-20, ui-specialist)

- Commit: `290c8fa feat(search): debounce the sidebar filter and search-replace preview`
- Files: `entry-list.model.ts` (`EntryListItem.search` field — the §3.2
  interface edit belongs to wiring, P1 landed only helpers),
  `entry-list.ts/.html/.spec.ts`, `search-replace-dialog.ts/.html/.spec.ts`,
  both folder READMEs (search-replace README created).
- What landed: `filterDebounced` mirror; `items` builds the haystack via
  `entrySearchHaystack` (locals hoisted, single fold per entry change);
  `filtered` scans `matchesQuery` off the debounced value (tag chips stay
  immediate — pinned); count badge and empty-state read the settled view;
  append-reveal flushes the mirror after filter-clear so the 0ms reveal
  scroll still finds the row. S&R: `queryDebounced`/`replacementDebounced`;
  `pattern`/`matchEntry` consume mirrors; toggles immediate;
  `patternError` compiles the IMMEDIATE query (fresh compile, no book scan —
  feedback lags in neither direction); `apply()` flushes both mirrors
  before reading rows.
- Spec migrations (strengthened, none loosened): entry-list filter tests +
  4 hidden sync `filtered()` consumers (select-all, append-reveal, viewport
  index mapping, out-of-range drops) now settle the debounce first; all 16
  S&R tests `await typeIn`; new pins: debounce-settles, multi-word
  separator guard, preview-empty-until-settle, immediate-invalid-regex,
  apply-flush ×2, tag-chips-stay-immediate.
- Gates: `CI=true npm test -- --watch=false` **green** (54 files / 1010
  tests; coverage 95.76/89.16/90.61/97.26; entry-list.ts 91.32/84.21/89.83/92.52,
  search-replace group 92.59/85.18/83.33/96.2); `npm run build` **green**.
- Deviations (justified): (1) fake-timer idiom needed repo-specific
  `toFake: ['setTimeout','clearTimeout']` (default set starves
  `fixture.whenStable()`) and `detectChanges()` before clock-advance (the
  debounce effect is a view effect flushed by `appRef.tick()`) — documented
  in the spec helpers; (2) `patternError` compiles the immediate query
  instead of reading a debounced `pattern()` — equivalent by construction,
  pinned by the immediate/lag test; (3) §7.3 guard verified: `items` reads
  only `entries()` + `dirtyEntryIds()` + pure helpers.
- The §3.3 single-pass `matchAll()` stretch is untouched — P3 decides it.

**Next:** P3 (ts-reviewer) — typing/signal-purity review + lint gate +
single-pass scan decision.

## Phase 3 — Review (2026-09-20, ts-reviewer)

- Commits: `3fbc944 fix(shared): make debouncedSignal flush apply the source's
  current value` (+2 debounce pins + entry-list sync-reveal pin),
  `aba0341 refactor(search): share the compile options between pattern and
  patternError` (drift-risk dedup), `2d9108b style(search): restore
  no-results indentation in the dialog template`.
- **Bug found & fixed**: P2's append-reveal `flush()` was a no-op — flush only
  applied an already-armed pending value, but the debounce effect runs
  asynchronously, so a change made inside another effect's body is never
  pending yet; the reveal scroll silently regressed vs pre-task behavior.
  `flush()` now applies the source's CURRENT value (untracked read),
  superseding stale pending ones; the queued effect run early-returns on
  `Object.is`. No double-fire, no resurrected timers.
- Waives: `Object.assign(mirror, {flush})` construction confirmed cleanest
  (zero assertions, writable set unreachable through the declared type);
  `EntryListItem.search` readonly-vs-siblings (not worth churn).
- **§3.3 stretch DECISION: REJECTED — debounce-only ships.** Building
  previews from a `matchAll()` sweep means hand-reimplementing GetSubstitution
  (`$$`, `$&`, `$\``, `$'`, `$1`–`$n` >9-group disambiguation, `$<name>`,
  zero-width advancement); `rows.next*` feeds `apply()` verbatim, so any
  divergence is silent lorebook corruption. Preview and write sharing the
  same `.replace()` closure is the strongest equivalence guarantee.
- Gates: `npm run lint` **clean**; `CI=true npm test -- --watch=false`
  **green** after refactors (54 files / 1012 tests, thresholds met).

**Next:** P4 (qa-auditor) — new light e2e (sidebar filter + S&R), full
three-project suite, manual perf trace in the phase report.
