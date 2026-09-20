# Task 07 — Search Responsiveness: Debounced Filter & Preview

> **Source**: User bug report 2026-09-20 — *"On enormous lorebooks, searching takes a
> while and it struggles with every single character. Possible solution: debounce
> first; for the search performance, I dunno."* Screenshot: the Search & Replace
> dialog's per-keystroke preview. The sidebar filter box has the same disease.
> **Type**: Performance fix (no behavior/byte changes to search results)
> **Suggested agents**: `core-engine` (pure helpers) → `ui-specialist` (wiring) →
> `ts-reviewer` → `qa-auditor`
> **Status**: 🟢 Planned — no implementation started (grounded against `develop` @ `2468de3`)

---

## 1. Objective

Typing in **both** search surfaces stays responsive on enormous lorebooks (thousands
of entries, multi-KB contents): the expensive scan runs at most every ~200ms instead
of per keystroke, and the per-scan constant cost drops by never re-case-folding
entry text. Search **results** (which entries match, hit counts, replacement
previews, exports) must stay byte-identical — only *when* the computation runs and
*how often the fold happens* changes.

## 2. Current hot paths (code audit, `develop` @ `2468de3`)

- **Sidebar filter** (`entry-list.ts`): the form model updates per keystroke
  (`filterForm = form(this.filterModel)`, `:158-159`); `filtered` (`:205-230`) then
  scans every item on every keystroke, calling `item.content.toLowerCase()` — a
  fresh lowercase copy of the **full content** per entry **per keystroke** — plus
  `title`/`keys`/`tags` folds. Nothing is cached across keystrokes.
- **Search & Replace dialog** (`search-replace-dialog.ts`): `rows` is a computed
  over the live form signals (`:90-101`); `matchEntry` (`:112-163`) runs the regex
  `.match()` over every entry's full content + keys + name and, for hit rows, a
  second full `replace()` pass to build the preview — all synchronously per
  keystroke. `patternError` (`:80-88`) is the only cheap path.
- **Debounce precedent**: `core/services/storage.service.ts:19,135` — a plain
  `setTimeout` debounce for IndexedDB saves. There is no RxJS scheduling in the
  app's signal layer; keep it that way (house invariant: Signals over RxJS state).
- **Fake-timer precedent**: `storage.service.spec.ts` uses `vi.useFakeTimers` —
  reuse it for debounce tests.
- **Pinned behavior to migrate**: `entry-list.spec.ts:113-130` sets
  `filterModel` and asserts `filtered()` synchronously — debounce breaks these
  unless the spec flushes the timer (§3.6). The Search & Replace dialog has **no
  e2e coverage today** (unit-only: `search-replace-dialog.spec.ts`; the
  "Replace" hit in `round-trip.spec.ts:145` is a comment about fixture content) —
  the qa phase adds a light S&R e2e (§3.6) rather than re-running something that
  doesn't exist.

## 3. Design

### 3.1 Shared debounce primitive

New bare module `src/app/shared/util/debounced-signal.ts` (no decorator; house
precedent for bare modules: `core/services/sha256.ts`):

```ts
/** A signal that mirrors `source`, lagging at most `delayMs` behind it. */
export function debouncedSignal<T>(source: Signal<T>, delayMs: number): DebouncedSignal<T>;

export interface DebouncedSignal<T> extends Signal<T> {
  /** Runs a pending timer immediately (search submit, destroy). */
  flush(): void;
}
```

- `setTimeout`-based (storage-service idiom; no RxJS creep), creates its timer via
  an `effect` created in the caller's injection context and cancels it on
  `DestroyRef` — a keystroke within the window **replaces** the pending value
  (trailing-edge debounce), and `set` on the source while idle is free.
- Constant `SEARCH_DEBOUNCE_MS = 200` in `src/app/shared/constants/`
  (next to `breakpoints.ts`), shared by both surfaces.
- Unit spec (fake timers): trailing-edge semantics, `flush()`, cancellation on
  destroy, no timer armed while the source is idle.

### 3.2 Sidebar filter (`entry-list.ts` + `entry-list.model.ts`)

- **Haystack pre-fold**: `EntryListItem` gains `readonly search: string` built in
  the `items` computed (`entry-list.ts:179-192`) as
  `[title, ...keys, ...tags, content].join('\n').toLowerCase()`. The fold then runs
  **once per entry change**, not once per keystroke; the per-keystroke cost of
  `filtered` becomes a zero-allocation `includes` scan.
  - Equivalence note: today's check is `title || keys || tags || content` — the
    joined haystack matches the same queries because a single-line text input
    sanitizes newlines out of its value (WHATWG input sanitization), so a query
    can never span the `'\n'` separators. Pin this reasoning in a unit test.
  - Memory: one extra string ≈ content size per entry (~doubles text memory for
    the open book). Acceptable; noted in the module doc comment.
- **Debounce**: `protected readonly filterDebounced = debouncedSignal(this.filter, SEARCH_DEBOUNCE_MS);`
  `filtered` reads `filterDebounced()`; the `Entries N` count badge (template
  `:4`) reads `filtered()` too, so it settles with the list (consistent display).
  The input itself keeps its immediate form value — typing never feels laggy.
- Tag chips keep filtering immediately (discrete taps; already cheap).

### 3.3 Search & Replace dialog (`search-replace-dialog.ts`)

- Debounced mirrors: `queryDebounced`/`replacementDebounced` over the form fields;
  the three mode/scope/field toggles stay immediate (discrete). `pattern` and
  `rows`/`totalHits`/`selectedRows` consume the **debounced** mirrors;
  `patternError` stays on the **immediate** query (invalid-regex feedback must not
  lag).
- `apply()` calls `.flush()` (or reads `untracked` + recomputes) first so a fast
  type→click Replace can never replace against stale preview rows.
- Single-pass scan (stretch, review-gated): `matchEntry` currently counts hits
  with one `.match()` pass and builds previews with a second `.replace()` pass per
  field. If `ts-reviewer` deems it low-risk, compute both from one `matchAll()`
  sweep (identical semantics: same regex, same field set) — otherwise ship
  debounce-only. Either way `MatchRow` output is byte-identical; the spec pins it.

### 3.6 Test matrix

| Tier | Required cases |
|------|----------------|
| Unit — `debounced-signal.spec.ts` | trailing-edge timing (fake timers); `flush()`; rapid keystrokes collapse to the last value; destroy cancels pending; no-timer-while-idle |
| Unit — `entry-list.spec.ts` | haystack equivalence pins (title/key/tag/content, case-insensitive, multi-word); separator-guard (query with spaces still matches across a single field only); debounce: `filterModel.set` then fake-advance → `filtered` settles; **migrate** the existing sync assertions (`:113-130`) to flush |
| Unit — `search-replace-dialog.spec.ts` | rows empty until the debounce settles; invalid regex errors immediately while rows lag; `apply()` after flush replaces what the preview showed (byte-identical rows pre/post refactor if the single-pass lands) |
| E2E | new light sidebar-filter spec: fill → count badge settles within the debounce window → clear → count restores; new light S&R spec (none exists today): fill Find… → preview rows settle after the debounce → toggle a row off → Replace all → content reflects the replacement (desktop + one mobile viewport) |

**Not a CI gate**: a manual perf trace protocol — synthetic ~3–5k-entry book,
type 12 characters, record main-thread long tasks before/after in Chrome DevTools;
paste the before/after numbers into the phase report (keeps flaky timing asserts
out of CI).

## 4. Implementation Plan

| Phase | Files | Work |
|-------|-------|------|
| **P1 — Pure helpers** (core-engine) | `shared/util/debounced-signal.ts` (+spec), `shared/constants/` (const), `entry-list.model.ts` (haystack builder + `matchesQuery` if it aids testing) | §3.1, §3.2 pure parts |
| **P2 — Wiring** (ui-specialist) | `entry-list.ts/.html` (+spec), `search-replace-dialog.ts` (+spec) | §3.2, §3.3 incl. the spec migrations |
| **P3 — Review** (ts-reviewer) | all touched | decides the single-pass scan (§3.3 stretch); typing, lint |
| **P4 — E2E & report** (qa-auditor) | `e2e/` (new filter + S&R specs; full suite re-run) | §3.6 + manual perf trace in the phase report |

## 5. Orchestration

1. **`core-engine`** — P1 (skills: `typescript-advanced-types`). *Gate: `npm test`.*
2. **`ui-specialist`** — P2. *Gate: `npm test` + `npm run build`.*
3. **`ts-reviewer`** — P3. *Gate: `npm run lint`.*
4. **`qa-auditor`** — P4 (skills: `playwright-cli`). *Gate: `npx playwright test`.*

P1 → P2 sequential (P2 consumes the primitive); file sets are disjoint from
Task 06 except `e2e/` runs — serialize the qa phases.

## 6. Verification Gates

`npm run build` · `npm test` · `ng test --coverage` (new util + touched specs
covered) · `npx playwright test` · `npm run lint`. No visual baseline required —
no UI reshapes (the 200ms settle is behavior, and the e2e pins it).

## 7. Risks & Open Questions

1. **Debounced count feels slow** for small books (250-entry FATE settles in
   200ms — imperceptible). If the user objects later, a length-based bypass
   (scan immediately under ~500 entries) is the documented fallback — not built now.
2. **Haystack doubles text memory** for enormous books — measured in the perf
   trace; if it bites, switch to per-item memoized folding keyed on entry
   identity (documented fallback, not built now).
3. **`items` recomputation storms**: `dirtyEntryIds()` changes during typing? No —
   typing edits the editor model, and the items computed only re-runs when
   `entries()`/dirty set change identity; verify no hidden dependency is added.
4. **Regex-mode S&R** on pathological patterns stays O(book) per settled query —
   debounce hides the per-keystroke pain; a truly incremental engine is out of scope
   (user: "for the search performance, I dunno" — revisit only with a real report).
