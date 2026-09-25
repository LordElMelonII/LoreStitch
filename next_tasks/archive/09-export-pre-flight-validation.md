# Task 09 — Book Schema Validation & Guided Repair

> **Source**: ROADMAP.md "CRITICAL & QUALITY GATES" — *"Pre-flight schema validation
> must run before file export to block malformed data structures from reaching
> disk."* — the one gate bullet with no enforcement in code (roadmap evaluation
> 2026-09-22).
> **Type**: Invariant enforcement on import + export paths, with a repair dialog
> **Suggested agents**: `core-engine` (lead: validator + repair planner + wiring)
> → `ui-specialist` (repair dialog + surfaces) → `ts-reviewer` → `qa-auditor`
> **Status**: 🟡 Planned — not started
> **Revision 2026-09-24** (user review): the first draft blocked the export with
> a snackbar instructing the user to "fix entry ids before exporting" — an
> instruction the app cannot fulfill (entry ids are never user-editable; there
> is no id field in any editor). The plan now centers a **guided repair
> dialog**: when validation finds fixable defects, the user is offered a
> one-click repair with an explicit change list — at import (primary surface)
> and at export (backstop). Clean books still export byte-identically; hard
> blocks survive only for defects no repair can fix.

---

## 1. Objective

Every book LoreStitch reads or writes is checked against the export contract,
and the user is never told to fix something the app itself must fix:

- **Import (primary surface)**: a book that reaches the workspace with
  fixable id defects (duplicate, string, non-finite) triggers a dialog listing
  the proposed repairs — "Fix & import" applies them, "Import as-is" declines.
- **Export (backstop)**: every book-carrying export validates first. Fixable
  defects offer the same repair dialog ("Fix & export"); unfixable structures
  block the export with a reason. No malformed bytes reach disk either way.
- Books that are well-formed export **byte-identically** — validation and
  repair observe and (only on consent) repair; unknown vendor keys are never
  dropped, filtered, or rewritten beyond the repair the user approved.

## 2. Gap analysis (develop @ `591ce15`)

Import is guarded at three levels — `isCharacterBook`
(`lorebook.model.ts:696`), `isSillyTavernWorldInfo` (`:711`) and the archive
guard in `project.model.ts` — plus a hardening pass (`normalizeImportedBook`
`:731`, `stEntryField` during native conversion). Export validates nothing:

| Export | Path today | Validation |
|---|---|---|
| Character Book V2 | `import-export.service.ts:314` → `toSpecCompliantBook` (`lorebook.model.ts:396`) | none — normalization (position collapse), not a check |
| ST World Info (v1) | `import-export.service.ts:319` → `characterBookToStNative` (`lorebook.model.ts:1204`) | none |
| `.stproj` archive | `import-export.service.ts:342` (workspace via `serializeWorkspaceForArchive`, `project.model.ts:250` — verbatim except card-shell `pngBytes` re-encoded base64) | none |
| Split export | `import-export.service.ts:327` → `extractSubBook` (`lorebook.model.ts:863`) then the two above | none |
| Markdown digest | `import-export.service.ts:433` | n/a — proofreading artifact, never an ST input (stays unvalidated by design) |

The concrete malformed structures that survive import today all trace to the
**id field**:

1. **Non-numeric / missing-after-parse ids**: `isCharacterBook` checks only
   `content` + `keys` per entry (`:700-703`); `normalizeImportedBook:741`
   assigns ids only when `entry.id` is `undefined` — a string id (`"7"`) or
   `NaN` rides through and is written as V2 `id` / ST `uid`.
2. **Duplicate ids**: nothing checks uniqueness. The ST native export is a
   uid-keyed bag, so two entries under one uid **collapse on SillyTavern's
   parse** — the exported file silently loses an entry. In-session they are
   equally toxic (`WorkspaceService.updateEntry`, `workspace.service.ts:234`,
   patches every id match).
3. **Wrong-typed scalars**: `insertion_order` is defaulted only when
   non-numeric by `normalizeImportedBook` (`:744`) on the bare-book path;
   `priority` is never re-checked for finiteness after the null-tolerant
   native conversion shapes.

**Why the block-only design was wrong (the revision's core finding)**: the
reachability chain ends in a dead end. Defects enter via third-party files →
the UI cannot author them, and the UI **also cannot repair them** — entry ids
have no editor (`addEntry`/`duplicateEntry` allocate `max+1`,
`workspace.service.ts:260/:275` via the `nextEntryId` helper `:395`, and
nothing else ever writes an id). "Fix entry
ids before exporting" instructs an action that does not exist; the only
workaround is deleting and recreating entries (data loss by hand). Blocking
must therefore come with the fix, or not at all.

## 3. Design

### 3.1 Pure validator — `core/models/book-schema.ts`

Bare, framework-free, total (house shape: `st-trigger.ts`/`st-key-match.ts`).
Renamed from the draft's `st-export-schema.ts`/`validateExportBook` — import
uses it too. Validate-only: no normalization, no key filtering, `extensions`
and unknown vendor keys are **never** inspected beyond `isJsonObject` (an
unknown key can never make a book invalid — a rule that rejects one is a bug).

```ts
export type BookDefectKind =
  | 'entry-id-not-finite'
  | 'entry-id-duplicate'
  | 'entry-content-not-string'
  | 'entry-keys-not-string-array'
  | 'entry-secondary-keys-not-string-array'
  | 'entry-insertion-order-not-finite'
  | 'entry-priority-not-finite'
  | 'entry-extensions-not-object'
  | 'book-entries-not-array';

export interface BookDefect {
  readonly kind: BookDefectKind;
  readonly entryId: number | null; // null = book-level
  readonly entryTitle: string | null;
}

/** Total, read-only; order-stable (book order, then kind). Never throws. */
export function validateBook(book: CharacterBook): BookDefect[];
```

Rule set — only what the exporters and SillyTavern's own parsing index:

| # | Rule | Protects |
|---|---|---|
| 1 | `entries` is an array | both formats |
| 2 | every `id` a finite number | V2 `id`, ST `uid` |
| 3 | ids unique across the book | ST uid-keyed bag (duplicate-key collapse) |
| 4 | `content` a string | both |
| 5 | `keys` a string array | both |
| 6 | `secondary_keys` a string array when present | both |
| 7 | `insertion_order` finite when present | both |
| 8 | `priority` finite when present (`undefined` legal — the documented unset) | both |
| 9 | `extensions` a plain object when present | both |

`position` is **not** a rule: `entryStPosition` already coerces legacy values
and `toSpecCompliantBook` collapses to the spec-legal strings — validating
here would reject books that export perfectly. Rules 4–5 cannot fire
in-session (`isCharacterBook` blocks them at import) but stay as
defense-in-depth for the export backstop.

### 3.2 Pure repair planner — `core/models/book-repair.ts`

The "something to fix the issues" the dialog offers. Bare, framework-free,
deterministic, total; repairs only what a rule flagged, touches only that
field, and reports every change it would make **before** making it:

```ts
export type RepairChangeKind =
  | 'coerce-id'              // "7" → 7 (string id parseable as a finite number, target free)
  | 'reassign-id'            // duplicate (later occurrence loses) or unparseable id → fresh sequential id (max+1…)
  | 'default-insertion-order'// non-finite → 100 (normalizeImportedBook's own default)
  | 'unset-priority';        // non-finite → undefined (the documented unset)

export interface RepairChange {
  readonly kind: RepairChangeKind;
  readonly entryTitle: string;
  readonly from: string;     // human-readable prior value ("7", "NaN", "∞")
  readonly to: string;       // human-readable new value
}

export interface BookRepair {
  readonly book: CharacterBook;          // repaired copy (structuredClone base)
  readonly changes: readonly RepairChange[]; // order-stable, dialog-ready
}

/** null ⇢ no fixable defect (hard-block territory). Never throws. */
export function planBookRepair(book: CharacterBook, defects: readonly BookDefect[]): BookRepair | null;
```

Policies (final say at checkpoint 09-1): duplicates keep the **first
occurrence in book order**, later ones renumber from `max(finite ids)+1`;
`coerce-id` wins over `reassign-id` when the parsed number is free; unknown
vendor keys and all untouched fields ride along verbatim (the repair is a
spread-replace of exactly one field per change); the function is idempotent —
`validateBook(repair.book)` is clean, and re-planning over it returns `null`.
Unfixable kinds (`book-entries-not-array`, `entry-content-not-string`,
`entry-keys-not-string-array`, `entry-secondary-keys-not-string-array`,
`entry-extensions-not-object`) yield no changes; their presence makes the
whole plan `null` → hard block.

### 3.3 Repair dialog — `shared/components/book-repair-dialog/`

New interactive control ⇒ **design-evidence checkpoint 09-1** (per
AGENTS.md: every control cites its in-app exemplar or ships a rendered mock —
the `__screenshots__/*/[mock-]*.mjs` precedent). Exemplars to cite:

- structure + data-driven content: `shared/components/confirm-dialog/`
  (`confirm-dialog.ts`, `confirm-dialog.model.ts`);
- dual-container opening: `ResponsiveOverlayService.openResponsive` — the
  dialog/bottom-sheet branch never appears at a call site (house invariant).

Content: title, one-line explanation, the **change list** (`changes[]`
rendered scrollably, e.g. `Castle gates: id "7" → 7`, `Tavern: id 7 → 12`),
and context-dependent actions — import context: **Fix & import** (primary) /
**Import as-is**; export context: **Fix & export** (primary) / **Cancel**.
When `planBookRepair` returned `null` but unfixable defects exist, export
falls back to a plain block dialog (list + single **Close**) — no download.

### 3.4 Import wiring (primary surface) — `features/shell/project-actions.service.ts`

Both import modes (`replace` at `:116`, `merge` at `:124` → private
`importFile` at `:148`) gain the same step after parse + guards +
`normalizeImportedBook`: `validateBook` → defects with a repair plan open the
dialog **before the book enters the workspace**. "Fix & import" applies the
repaired book; "Import as-is" proceeds unmodified (byte purists keep their
file verbatim; the export backstop still guards them later — and the
duplicate-id in-session hazard `updateEntry` patches-all-matches is documented
behavior they opted into).

### 3.5 Export wiring (backstop) — `import-export.service.ts`

Each book-carrying export (`exportCharacterBook:314`, `exportStNative:319`,
`exportSelectedBook:327`, `exportProject:342`) runs `validateBook` first and
changes its contract from `void` to a discriminated result:

```ts
export type ExportResult =
  | { ok: true }
  | { ok: false; defects: BookDefect[]; repair: BookRepair | null };
```

Surfacing lives in `ProjectActionsService` (topbar and mobile bar both route
through it — one home per export, the import-failure snackbar precedent
(`:164-191`, `:206-232`; approved copy map `CARD_FAILURE_COPY` in
`project-actions.constants.ts:19`) gives the fallback copy shape). Fixable
defects open the repair dialog; **Fix & export** applies `repair.book` through a new narrow
`WorkspaceService` mutator (`applyBookRepair` — routed through the private
`mutateProject` chokepoint `:452` → immutable replace → debounced save, so
the repair persists, marks the tree dirty, and is committable like any edit)
and then re-runs the export on the repaired tree. Blocked exports call no
`download*` method at all. `exportProject` validates `activeBook` **and**
every `commits[].snapshot` — snapshots are history and not repairable
in-session, so a defective snapshot is a hard block naming its commit.
`exportMarkdownDigest` stays `void` and unvalidated (§2).

### 3.6 Test matrix

| Tier | Required cases |
|------|----------------|
| Unit — `book-schema.spec.ts` | each `BookDefectKind` triggered once by a minimal fixture; a clean book returns `[]`; **a book loaded with unknown vendor keys at book/entry/extensions level returns `[]`** (the never-false-positive pin); duplicate ids report both positions; result order stable |
| Unit — `book-repair.spec.ts` | each `RepairChangeKind` produced by its defect; duplicate → first keeps, later renumbered, ids unique after; `"7"` coerced, `"abc"` reassigned; **idempotence** (repair → validate clean → plan `null`); unknown vendor keys byte-preserved in the repaired copy; unfixable defect present ⇒ `null`; `from`/`to` strings human-readable |
| Unit — import surface | replace + merge: defective fixture ⇒ dialog offered, Fix applies repaired book, as-is imports verbatim; clean fixture ⇒ no dialog |
| Unit — export surface | each export method: fixable fixture ⇒ `{ok:false, repair≠null}` and no download call; unfixable ⇒ `repair: null`, no download; clean ⇒ `ok: true` and byte output unchanged vs. pre-task snapshot pins; `applyBookRepair` marks the tree dirty through `mutateProject` |
| E2E — new `e2e/repair.spec.ts` | import a hand-crafted defective third-party JSON (via `importLorebook`) ⇒ dialog lists changes; **Fix & import** ⇒ export ST native ⇒ **both duplicate entries present with unique uids** (the anti-collapse pin, parsed from the downloaded file); Import as-is ⇒ export ⇒ fix dialog ⇒ **Fix & export** downloads the repaired book; clean round-trip untouched (§6) |

**Visual gate**: the dialog is new UI ⇒ before/after screenshots under
`__screenshots__/09-book-repair/{before,after}/` (before = silent import /
no guard; after = import + export dialogs), pinned conditions per the
baseline protocol, posted with the P2 phase report.

## 4. Implementation Plan

| Phase | Files | Work |
|-------|-------|------|
| **P1 — Validator + planner + contracts** (core-engine) | `core/models/book-schema.ts`, `core/models/book-repair.ts` (+specs), `import-export.service.ts` (ExportResult), `core/models/README.md` | §3.1 + §3.2 + §3.5 contract |
| **Checkpoint 09-1** (user) | — | repair policies (§3.2) + dialog mock with exemplar citations (§3.3) + copy — also the sign-off for renumbered `uid`s changing exported bytes vs. the source file |
| **P2 — Dialog + surfaces** (ui-specialist) | `shared/components/book-repair-dialog/`, `project-actions.service.ts` (import + export), `workspace.service.ts` (`applyBookRepair`) | §3.3 + §3.4 + §3.5 |
| **P3 — Review** (ts-reviewer) | all touched | defect/change discriminated unions, no-any kinds, dialog data typing, lint |
| **P4 — Fidelity evidence** (qa-auditor) | `e2e/repair.spec.ts` | §3.6 gates + per-file coverage diff against baseline |

Commits: `feat(core): book schema validation and guided repair`,
`feat(shell): import and export repair dialogs`, `test(e2e): …`,
`docs(next_tasks): …`.

## 5. Orchestration

1. **`core-engine`** — P1 (skills: `typescript-advanced-types`). *Gate:
   `npm test`.*
2. **User checkpoint 09-1** — repair policies + dialog evidence. Gate stays
   open until answered (house rule).
3. **`ui-specialist`** — P2 (skills: `material-3`, `frontend-design`).
   *Gate: `npm test` + `npm run build`.*
4. **`ts-reviewer`** — P3. *Gate: `npm run lint`.*
5. **`qa-auditor`** — P4 (skills: `playwright-cli`). *Gate: `npx playwright
   test repair round-trip` green on desktop-chrome + one mobile project
   (mobile: the dialog renders as a bottom sheet via `openResponsive` — pin
   it), run per project per the long-gate rule.*

## 6. Verification Gates

`npm run build` · `npm test` · `ng test --coverage` (`book-schema` +
`book-repair` fully covered) · `npx playwright test repair round-trip`
(round-trip **without edits** — the no-byte-change proof for clean books) ·
`npm run lint` · screenshot comparison in the P2 report.

## 7. Risks & Open Questions

1. **False-positive blocking**: unchanged from the draft — mitigated by the
   rule set's scope (§3.1) and the vendor-keys-pass unit pin. If a rule trips
   on `example_card/` books at implementation time, the rule is wrong, not
   the book.
2. **Renumbering changes exported `uid`s** vs. the source file (the
   byte-level behavior the draft deferred to sign-off): now explicitly
   consented per-instance at the dialog, and checkpoint 09-1 approves the
   policy class. Trade-off noted: `extractSubBook` keeps ids so split-merge
   resolves collisions against original uids (`lorebook.model.ts:857-861`) —
   renumbered duplicates were ambiguous for merging anyway; they could never
   be resolved. Accepted.
3. **Import as-is keeps in-session hazards** (duplicate ids ⇒ `updateEntry`
   patches all matches, `workspace.service.ts:234`): documented opt-in; the
   export backstop re-offers the repair at the door. A linter rule flagging
   id collisions in-session remains a cheap follow-up candidate (separate
   task if wanted).
4. **Snapshot defects hard-block `.stproj` export** with no repair (history
   is immutable in-session). Rare (the archive guard checked structure at
   import; only id-level drift passes); the block names the commit so the
   user can roll forward or fix by hand with full information.
5. **Dialog under defect floods**: a 500-entry third-party book with
   wholesale bad ids renders a long list — the change list scrolls, the
   primary action copy carries the count ("Fix 37 issues & import"), and
   `console.warn` keeps the full detail. If the checkpoint wants a
   summary-only variant, that is a copy decision inside P2, not new scope.
