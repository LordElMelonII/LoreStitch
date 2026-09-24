# Task 09 Progress Ledger

Plan: [09-export-pre-flight-validation.md](./09-export-pre-flight-validation.md)
(reworked 2026-09-24, grounded at `fa0b798` / anchors refreshed `7089cc0`).
Branch: `feature/09-book-repair` (off `develop` @ `7089cc0`).

## Phase P1 — Validator + repair planner + ExportResult contract (core-engine)

**Status**: ✅ complete — commit `0f85885` `feat(core): book schema validation and guided repair`

**Landed**:
- NEW `src/app/core/models/book-schema.ts` (224 ln) — `BookDefectKind` (9 kinds),
  `BookDefect`, `validateBook(book): BookDefect[]`; total, order-stable, never
  throws; unknown vendor keys/`extensions` inspected only for plain-objectness;
  `position` deliberately not a rule.
- NEW `src/app/core/models/book-repair.ts` (392 ln) — `RepairChangeKind` (4
  kinds), `RepairChange`, `BookRepair`, `planBookRepair(book, defects):
  BookRepair | null`; structuredClone base, one flagged field per change,
  idempotent; unfixable kinds ⇒ `null`.
- `src/app/core/services/import-export.service.ts` — `ExportResult` discriminated
  union; `exportCharacterBook`/`exportStNative`/`exportSelectedBook`/`exportProject`
  validate before serializing, return `{ok:false}` and call no download on
  defects; `exportProject` also validates every `commits[].snapshot`
  (snapshot defect ⇒ hard block, `repair: null`, `source: "<message> (<id7>)"`);
  `exportMarkdownDigest` untouched. Clean path byte-identical (pins in spec).
- NEW specs `book-schema.spec.ts` (18 tests), `book-repair.spec.ts` (23 tests);
  `import-export.service.spec.ts` extended (+12 tests → 65) incl. byte-identity
  pins captured against the pre-task serializer.
- `core/models/README.md` documents both modules.

**Gates** (orchestrator re-ran all): `CI=true npm test --watch=false --coverage`
→ 59 files / 1245 tests passed, thresholds green, `book-schema.ts` +
`book-repair.ts` at 100/100/100/100 · `npm run build` green · `npm run lint`
green · `npm run typecheck:e2e` green.

**Decisions/deviations**:
1. **Dispatch incident**: the first P1 dispatch was killed by a harness captcha
   timeout mid-run and left uncommitted partial work; the re-dispatch audited
   and completed it per the AGENTS.md cancelled-subagent rule (no restart).
   Two real defects in the partial work were fixed: ungated id machinery
   (planner invented id changes with no id defect flagged) and unreachable
   defensive branches (blocked the "fully covered" requirement).
2. **ExportResult additive field** (brief-allowed, plan deviation): failure
   variant gained `readonly source?: string` — present only on `exportProject`'s
   snapshot hard-block, naming the commit — so the P2 UI can attribute the
   block (plan §7.4 requires naming it).
3. **Null handling** (verified against codebase + vendored ST oracle):
   `secondary_keys: null` and `extensions: null` are legal (converters
   substitute `?? []`/`?? {}`); `insertion_order: null` and `priority: null`
   are defects (serialize verbatim into V2 bytes); absent `id` is a defect
   (`extractSubBook:870` silently drops id-less entries). Repair assigns
   `priority = undefined` kept as a key (house shape, `Object.hasOwn` pinned).
4. Duplicate detection keys on `String(id)` — the ST uid bag's collapse key —
   so `7`/`"7"`/`NaN` collisions are caught; renumbering max excludes
   non-finite ids.
5. Caller compile fallout only (mocks return `{ ok: true }` instead of
   `undefined`) in `commit-history.spec.ts` + `project-actions.service.spec.ts`;
   `project-actions.service.ts` itself untouched, callers ignore the result.

**Checkpoint 09-1 notes for the user**: repair policies as plan §3.2 (duplicates
keep first occurrence in book order, later renumber from `max(finite ids)+1`;
`coerce-id` wins when target free; non-finite `insertion_order` → 100;
non-finite `priority` → unset). Renumbered `uid`s change exported bytes vs. the
source file — consented per-instance in the dialog, policy class signed off at
the checkpoint (plan §7.2).

**Next**: CHECKPOINT 09-1 — orchestrator builds the dialog mock by driving the
real app (`__screenshots__/*/[mock-]*.mjs` precedent) seeded with a defective
book, presents (a) repair policies §3.2, (b) mock with exemplar citations §3.3,
(c) final copy, and the renumbered-uid byte-change sign-off; STOP until the
user answers. Then P2 (ui-specialist).

## Checkpoint 09-1 — user sign-off

**Status**: ✅ approved 2026-09-24 — all four facets answered explicitly:
1. **Repair policies (§3.2)**: approved as planned (first-occurrence-keeps,
   renumber from max+1, coerce-when-free, order→100, priority→unset).
2. **Dialog design**: approved as mocked — ConfirmDialog exemplar anatomy,
   desktop/tablet centered dialog + phone bottom sheet (drag handle, stacked
   full-width buttons).
3. **Copy**: approved as written ("Fix 4 issues before importing?/exporting?",
   kind labels "Id corrected / Id renumbered / Insertion order set / Priority
   unset", "Fix 4 issues & import"+"Import as-is", "Fix 4 issues &
   export"+"Cancel", hard block "This book can't be exported yet" + Close).
4. **Renumbered-uid byte change (§7.2)**: signed off (policy class approved;
   per-instance consent stays in the dialog).

**Evidence**: mock driver `__screenshots__/09-book-repair/mock-repair-dialog.mjs`
(real app, seeded with `defective-book.json`; change list verified against the
shipped P1 planner via `.verify-trace.mjs`) — five mocks:
`desktop-1280x800-mock-{import-repair,export-repair,hard-block}.png`,
`mobile-390x844-mock-{import-repair,export-repair}-sheet.png`. The change list
shown (Tavern `"7"`→7; River dock 2→4 + order ∞→100; Old forest priority ∞→unset)
is the planner's actual output, not an illustration.

**Next**: P2 (ui-specialist) — `shared/components/book-repair-dialog/`,
import wiring in `features/shell/project-actions.service.ts`, export surfacing,
`WorkspaceService.applyBookRepair`; before/after screenshots under
`__screenshots__/09-book-repair/{before,after}/`.
