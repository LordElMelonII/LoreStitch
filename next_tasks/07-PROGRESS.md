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
