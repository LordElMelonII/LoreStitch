# Task 09 — Export Pre-Flight Schema Validation

> **Source**: ROADMAP.md "CRITICAL & QUALITY GATES" — *"Pre-flight schema validation
> must run before file export to block malformed data structures from reaching
> disk."* — the one gate bullet with no enforcement in code (roadmap evaluation
> 2026-09-22).
> **Type**: Invariant enforcement on the export path (no UI reshape)
> **Suggested agents**: `core-engine` (lead: pure validator + export wiring) →
> `ui-specialist` (failure surface) → `ts-reviewer` → `qa-auditor`
> **Status**: 🟡 Planned — not started

---

## 1. Objective

Every file LoreStitch writes to disk is checked against the export contract
**before** the download starts: a payload that would land malformed blocks the
export and tells the author which structure broke. Books that are well-formed
today export **byte-identically** — the validator observes, never mutates, and
never drops keys. Blocking with a reason (instead of silent repair) is exactly
what the never-drop-vendor-keys invariant demands: repairing is rewriting, and
rewriting is where vendor data dies.

## 2. Gap analysis (develop @ `ddc9f04`)

Import is guarded at three levels — `isCharacterBook`
(`lorebook.model.ts:821`), `isProjectWorkspace` (`:852`) and
`isSillyTavernWorldInfo` (`:871`) — plus two hardening passes
(`normalizeImportedBook:891`, `stEntryField` during native conversion). Export
validates nothing:

| Export | Path today | Validation |
|---|---|---|
| Character Book V2 | `import-export.service.ts:140` → `toSpecCompliantBook` (`lorebook.model.ts:517`) | none — `toSpecCompliantBook` is a normalization (position collapse), not a check |
| ST World Info (v1) | `import-export.service.ts:145` → `characterBookToStNative` (`lorebook.model.ts:1362`) | none |
| `.stproj` archive | `import-export.service.ts:168` (workspace verbatim) | none |
| Split export | `import-export.service.ts:154` → `extractSubBook` (`lorebook.model.ts:1021`) then the two above | none |
| Markdown digest | `import-export.service.ts:181` | n/a — proofreading artifact, never an ST input (stays unvalidated by design) |

The concrete malformed structures that can reach disk today all trace to the
**id field**, which no guard or normalizer fully covers:

1. **Non-numeric / missing-after-parse ids**: `isCharacterBook` checks only
   `content` + `keys` per entry (`:833-839`); `normalizeImportedBook:898`
   assigns ids only when `entry.id` is `undefined` — a string id (`"7"`) or
   `NaN` sails through and is written as V2 `id` / ST `uid`.
2. **Duplicate ids**: nothing checks uniqueness. The ST native export is a
   uid-keyed bag (`SillyTavernWorldInfo.entries`), so two entries under one uid
   **collapse on SillyTavern's parse** — the exported file silently loses an
   entry. In-session they are equally toxic (`WorkspaceService.updateEntry`,
   `workspace.service.ts:221`, patches every id match).
3. **Wrong-typed scalars**: `insertion_order`/`priority` are only defaulted when
   non-numeric by `normalizeImportedBook` (`:900`) for the bare-book path; ST
   native conversion tolerates `null`-able shapes (`isStNumberOrNull` family,
   `:760-790`) whose surviving values are not re-checked for finiteness.
   `extensions` non-objects are coerced (`:899`) — covered.

Round-tripping the reference books stays green regardless (`example_card/`
fixtures carry unique numeric ids), so the suite cannot see this hole — it
only shows up on hand-edited or third-party files.

## 3. Design

### 3.1 Pure validator — `core/models/st-export-schema.ts`

Bare, framework-free, total (house shape: `st-trigger.ts`/`st-key-match.ts`).
Validate-only: no normalization, no key filtering, `extensions` and unknown
vendor keys are **never** inspected beyond `isJsonObject` (an unknown key can
never make an export invalid — a rule that rejects one is a bug).

```ts
export type ExportDefectKind =
  | 'entry-id-not-finite'
  | 'entry-id-duplicate'
  | 'entry-content-not-string'
  | 'entry-keys-not-string-array'
  | 'entry-secondary-keys-not-string-array'
  | 'entry-insertion-order-not-finite'
  | 'entry-priority-not-finite'
  | 'entry-extensions-not-object'
  | 'book-entries-not-array';

export interface ExportDefect {
  readonly kind: ExportDefectKind;
  readonly entryId: number | null; // null = book-level
  readonly entryTitle: string | null;
}

/** Total, read-only; order-stable (book order, then kind). Never throws. */
export function validateExportBook(book: CharacterBook): ExportDefect[];
```

Rule set — deliberately only what the exporters and SillyTavern's own parsing
index (the same "fields the consumer indexes" stance as `isProjectWorkspace`):

| # | Rule | Protects |
|---|---|---|
| 1 | `entries` is an array | both formats |
| 2 | every `id` a finite number | V2 `id`, ST `uid` |
| 3 | ids unique across the book | ST uid-keyed bag (duplicate-key collapse) |
| 4 | `content` a string | both |
| 5 | `keys` a string array (absent ≠ invalid at this layer — model-typed `string[]`, check presence-in-model only) | both |
| 6 | `secondary_keys` a string array when present | both |
| 7 | `insertion_order` finite when present | both |
| 8 | `priority` finite when present (`undefined` legal — it is the documented "unset") | both |
| 9 | `extensions` a plain object when present | both |

`position` is **not** a rule: `entryStPosition` (`lorebook.model.ts:383`)
already coerces any legacy value and `toSpecCompliantBook` collapses to the
two spec-legal strings on the V2 path — validating here would reject books
that export perfectly.

### 3.2 Export wiring — `import-export.service.ts`

Each book-carrying export (`exportCharacterBook`, `exportStNative`,
`exportSelectedBook`, `exportProject`) runs the validator first and changes
its contract from `void` to a discriminated result:

```ts
export type ExportResult = { ok: true } | { ok: false; defects: ExportDefect[] };
```

`exportProject` validates `activeBook` **and** every `commits[].snapshot`
(a malformed snapshot would ride the archive to disk) with the entry id of the
defect keyed to the commit it came from via the returned message layer.
Blocked exports call no `download*` method at all. `exportMarkdownDigest`
stays `void` and unvalidated (§2).

### 3.3 Failure surface — `project-actions.service.ts`

One home for export triggers (topbar menu and mobile bar both route through
`ProjectActionsService`), so surfacing lives in exactly one place per export:
the import-failure snackbar precedent (`project-actions.service.ts:152-157`)
gives the shape — `snackBar.open(...)` with an active-voice, state-what-happened
sentence (house copy rules), e.g. `"Export blocked — 2 entries share id 7.
Fix entry ids before exporting."` First defect + count in the snackbar; the
full list to `console.warn`. Final copy reviewed in the P2 phase report (no
new interactive control ⇒ no design checkpoint required; see §7.3).

### 3.6 Test matrix

| Tier | Required cases |
|------|----------------|
| Unit — `st-export-schema.spec.ts` | each `ExportDefectKind` triggered once by a minimal fixture; a clean book returns `[]`; **a book loaded with unknown vendor keys at book/entry/extensions level returns `[]`** (the never-false-positive pin); duplicate ids report both positions; result order stable |
| Unit — `import-export.service.spec.ts` | each export method: malformed fixture ⇒ `ok: false`, download **not** called (spy), bytes on disk impossible; clean fixture ⇒ `ok: true` and byte output unchanged vs. the pre-task snapshot pins |
| Unit — `project-actions` surface | snackbar copy for one vs. many defects |
| E2E — `round-trip.spec.ts` (existing) | must stay green **without edits** — the no-byte-change proof. No new e2e required: a malformed book cannot be authored through the UI today (the validator is defense-in-depth against import/vendor files), and hand-crafting one through the DOM would test the fixtures, not the guard |

## 4. Implementation Plan

| Phase | Files | Work |
|-------|-------|------|
| **P1 — Validator + wiring** (core-engine) | `core/models/st-export-schema.ts` (+spec), `import-export.service.ts`, `core/models/README.md` | §3.1 + §3.2 |
| **P2 — Failure surface** (ui-specialist) | `project-actions.service.ts` (+spec) | §3.3 |
| **P3 — Review** (ts-reviewer) | all touched | result-discriminant typing, no-any on defect kinds, lint |
| **P4 — Fidelity evidence** (qa-auditor) | — | §3.6 gates + per-file coverage diff against baseline |

Commits: `feat(core): pre-flight schema validation for exports`,
`feat(shell): surface blocked exports`, `test: …` as needed,
`docs(next_tasks): …`.

## 5. Orchestration

1. **`core-engine`** — P1 (skills: `typescript-advanced-types`). *Gate:
   `npm test`.*
2. **`ui-specialist`** — P2 (skills: `material-3`). *Gate: `npm test` +
   `npm run build`.*
3. **`ts-reviewer`** — P3. *Gate: `npm run lint`.*
4. **`qa-auditor`** — P4 (skills: `playwright-cli`). *Gate: `npx playwright test
   round-trip` green on all three projects, per-file coverage diff clean.*

No design checkpoint: P1→P2 handoff carries the proposed snackbar copy in the
phase report for a glance-level review only (§7.3).

## 6. Verification Gates

`npm run build` · `npm test` · `ng test --coverage` (`st-export-schema` fully
covered) · `npx playwright test round-trip` · `npm run lint` · export byte
equality asserted in unit specs (the round-trip e2e is the independent
confirmer).

## 7. Risks & Open Questions

1. **False-positive blocking**: a rule stricter than the exporters' actual
   needs would block legitimate vendor books. Mitigated by the rule set's
   scope (§3.1 — only fields consumers index) and the vendor-keys-pass unit
   pin. If a rule trips on `example_card/` books at implementation time, the
   rule is wrong, not the book.
2. **Duplicate-id repair is deliberately out of scope**: renumbering on import
   would change exported `uid`s — a byte-level behavior change under the
   human-sign-off gate. The validator blocks instead. An import-time repair
   (renumber with notice, or a linter rule flagging collisions) is a
   follow-up candidate; route it as its own task if wanted. Note the
   collision with `WorkspaceService.updateEntry` patching all id matches
   (`workspace.service.ts:221`) — in-session corruption on duplicate ids is
   pre-existing and untouched here.
3. **Failure copy** is the only user-facing surface and lands in P2 without a
   formal design checkpoint (no new interactive control — snackbar precedent).
   If the gate review wants the full defect list in a dialog instead, that is
   a UI reshape and triggers the checkpoint + screenshot protocol — flag
   before P2 dispatch.
4. **Contract change** `void` → `ExportResult` on four export methods: single
   consumer (`ProjectActionsService`) plus unit specs; e2e drives the UI and
   is unaffected.
