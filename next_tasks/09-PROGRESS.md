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

## Phase P2 — Repair dialog + surfaces (ui-specialist)

**Status**: ✅ complete — commit `d7cd74f` `feat(shell): import and export repair dialogs`

**Landed**:
- NEW `src/app/shared/components/book-repair-dialog/` — `book-repair-dialog.ts`
  (standalone dual-container pane, inline template/styles, ConfirmDialog
  contract: closes truthy only on the primary action), `book-repair-dialog.model.ts`
  (`BookRepairDialogData { context, repair, defects, source?, bookTitle }`;
  `repair: null` selects the hard-block variant), `book-repair-dialog.spec.ts`
  (9 tests). Opened only via `openResponsive` (`sheetPanelClass: 'app-repair-sheet'`).
- `features/shell/project-actions.service.ts` — import wiring (both modes) at
  the shared post-parse/post-normalize point: repair offered on the incoming
  book before it enters the workspace (merge: before `openMergeDialog`); export
  surfacing for all four book-carrying exports (dialog on fixable; hard-block
  with `source` line on snapshot defects; re-export after consent); `console.warn`
  full detail at open (plan §7.5).
- `core/services/workspace.service.ts` — `applyBookRepair(repair, selection?)`
  mutator through `mutateProject`: wholesale activeBook replace, or (split
  export) per-field patch of the mapped parent entries. Snapshots untouched.
- `styles.scss` — `.app-repair-dialog` + `.app-repair-sheet` (28px top radius,
  content-hugging, max-height 88dvh).
- Spec migrations (async export wrappers): `topbar.spec.ts`,
  `mobile-bottom-bar.spec.ts`; +5 tests `project-actions.service.spec.ts`,
  +2 `workspace.service.spec.ts`.
- Visual baseline: `__screenshots__/09-book-repair/capture.mjs` (before/after
  modes, pinned chromium/light/3 viewports/one fixture); 6 before + 6 after
  shots. After-set verified against the approved mock by the orchestrator:
  desktop dialog and phone sheet both match.

**Gates** (orchestrator re-ran all): test+coverage → 60 files / 1264 tests
passed, thresholds green (dialog 100% stmts/lines, 97.95% branches — one
defensive fallback branch) · build green · lint green · typecheck:e2e green.

**Decisions/deviations**:
1. Split-export repair application (plan §3.5 gap, decided by orchestrator):
   the sub-book repair folds back onto the PARENT entries — sub-book entry i ↦
   i-th id-bearing parent entry in book order (`extractSubBook`'s filter
   order) — patching only the planner's three fields; unit-pinned (unselected
   entry keeps object identity; vendor keys preserved).
2. Import dialog backdrop is the welcome screen (the offer blocks before the
   book enters the workspace) — correct per plan, differs from the mock's
   injected-over-workspace backdrop only in backdrop.
3. Before-set export shot pins the silent no-download state (P1 was already
   landed, so even "before" swallows defective exports — documented in
   `capture.mjs`).
4. Change/block lists scroll (`max-height: min(42dvh, 380px)`) per §75 flood
   mitigation; invisible at the 4-row baseline.
5. `.stproj`-import repair offer deliberately NOT added (plan scopes import
   wiring to book imports) — archive-import gap noted as a potential follow-up.

**Next**: P3 (ts-reviewer) — all touched files: discriminated defect/change
unions, no-any, dialog data typing, lint.

## Phase P3 — Typing/lint review (ts-reviewer)

**Status**: ✅ complete — commit `9251f68` `refactor(core): state the keep-key
invariant locally instead of casting`

**Review outcome** (full diff `7089cc0..HEAD`, 19 files):
- Discriminated unions: confirmed — every consumer narrows on the `ok`
  discriminant; kind maps are total `Record<Kind, string>` (compiler-enforced
  exhaustiveness); block-variant template narrows via `@if (repair; as plan)`.
- No `any` / no non-null assertions / no ts-ignore across touched files;
  defensive `unknown` reads all go through `isJsonObject`/`typeof` guards;
  explicit return types on all public methods.
- Dialog data typing: all `BookRepairDialogData` fields consumed, optionals
  guarded, boolean result typed end-to-end through `openResponsive`.
- House invariants: no `::ng-deep`; models import nothing Angular; dialog
  opened only via `openResponsive`; writes only through `applyBookRepair` →
  `mutateProject`; no RxJS state; no dangling promise/subscription chains.
- One fix applied (zero behavior change): `book-repair.ts:198` — cross-closure
  `as string` cast replaced with a local `key !== null` guard.

**Findings flagged (informational, no action)**: F1 — dialog dismissal
(ESC/backdrop) resolves falsy = "Import as-is" / no download (safe defaults,
consistent with the ConfirmDialog contract); F2 — `exportSelectedBook`
double-validates (sub-book + delegate) — idempotent, cheap, uniform contracts;
F3 — pre-existing `downloadBytes` cast (plan 15) out of scope.

**Gates** (reviewer ran on final tree; orchestrator re-ran test+lint): lint
green · 60 files / 1264 tests green · build green.

**Next**: P4 (qa-auditor) — author `e2e/repair.spec.ts` per plan §3.6 (incl.
the anti-collapse pin), per-task Playwright gate (desktop-chrome on repair +
round-trip; one mobile project on repair only — bottom-sheet pin), per-file
coverage diff vs phase-start baseline.

## Phase P4 — E2E fidelity evidence (qa-auditor)

**Status**: ✅ complete — commit `7ce2c40` `test(e2e): cover the guided repair
flow end to end`

**Landed**:
- NEW `e2e/repair.spec.ts` (6 tests) + committed fixture
  `e2e/fixtures/defective-book.json` (byte-identical to the checkpoint-verified
  defective book).
- `e2e/helpers.ts` extended (no logic duplicated): `repairDialog`,
  `importLorebookOfferingRepair`, `exportWorldInfoOfferingRepair`,
  `exportWorldInfoViewportAware` (plain `exportWorldInfo` delegates to it —
  desktop behavior identical, so `round-trip`/`delimiters` needed zero edits),
  `expectProjectOpen` extracted from `importLorebook`'s tail.

**All 6 cases pass** (desktop-chrome 5 passed + 1 phone-pinned skip;
mobile-chrome 6 passed): import offer lists the 4 changes · **anti-collapse
pin** (Fix & import → export ST native → 5-entry uid bag, all unique,
`entries["2"]`=Gate house + `entries["4"]`=River dock) · import-as-is → export
re-offer → Fix & export persists via `applyBookRepair` · Cancel blocks the
download · clean book never offers (never-false-positive pin) · phone form is
a bottom sheet (`.app-repair-sheet`, drag handle, stacked full-width actions).

**Pin-behavior grep**: no existing spec pinned the old silent behavior; no
migration needed; `round-trip.spec.ts` zero edits and green (byte-identity
proof holds).

**Gates**: typecheck:e2e clean · build green · 60 files / 1264 unit tests ·
lint green · `repair` desktop-chrome 5+1skip / mobile-chrome 6 passed ·
`round-trip` desktop-chrome 4+1skip. **Coverage diff** vs the P3-final baseline
(`__screenshots__/09-book-repair/coverage-baseline.txt`): 0 deltas across 133
rows (P4 touched only e2e files, outside unit coverage). Touched-file rows
identical to baseline (`book-schema` 100s, `book-repair` 100/99.22/100/100,
`book-repair-dialog` 100/97.95/100/100). Note: baseline = P3-final state (each
earlier phase enforced its own gate); pre-task per-file values not re-captured.

**No product bugs found.**

**Next**: branch-final sweep (orchestrator): full Playwright matrix per
project (`--project=desktop-chrome`, then `mobile-chrome`, then
`mobile-safari`), closing `npm test -- --watch=false --coverage` + `npm run
lint`; push and STOP for user merge testing.
