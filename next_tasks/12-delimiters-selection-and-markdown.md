# Task 12 — Delimiters: Selection Scope + Markdown Style + Responsive Pane

> **Source**: User doc [`"Delimiters Dialog improvements.md"`](../Delimiters Dialog improvements.md)
> (repo root, 2026-09-26). User-priority intake: **preempts tasks 10/11** — "This will have priority
> over every other task" (2026-09-26).
> **Type**: Feature (batch scope + new core style) + UX migration (responsive overlay) + hardening
> (markdown malformed shapes)
> **Suggested agents**: `core-engine` (lead) → `ui-specialist` → `ts-reviewer` → `qa-auditor`
> **Status**: ✅ **Ready** — design decisions D1–D10 locked with the user 2026-09-26 (§3).
> Checkpoints **12-1** (behavior contract, after P1) and **12-2** (visual evidence, after P2) are
> blocking gates.

---

## 1. Objective

Three deliverables from the improvements doc, one supporting migration:

1. **Selection scope** — apply delimiters to the checked entries (not just "this entry" / "all"),
   through a **Delimiters** batch action in the entry list (desktop batch toolbar + mobile bottom
   bar), pane locked to the selection (Batch-edit precedent).
2. **Markdown wrapper style** — `#{level} Name` ATX header (+ optional trailing `---`), with a
   level picker (default `##`) and a trailing-separator toggle; name-matched detection so ordinary
   opening headers stay payload; two minimal malformed shapes.
3. **Responsive pane migration** — the delimiters pane moves from plain `MatDialog` (+ CSS
   full-screen fallback <600px) to `ResponsiveOverlayService` dual-container (dialog ≥768px,
   Material bottom sheet on phones), the last top-level pane still on the old path.
4. **Discoverability** (user note: "the user should be told about how they can do this") — an
   in-pane hint in the editor-opened dialog points at the selection flow.

No exported-bytes change for books that never opt in: existing styles, detection for non-markdown
content, and the whole malformed tag/bracket contract stay byte-for-byte except the two documented
detection-order effects in §4.4 (checkpoint 12-1).

## 2. Grounding (develop @ `ad200c8`, surveyed 2026-09-26)

- **Pane**: `src/app/features/delimiters/` — scope select `entry|all` (`delimiter-dialog.model.ts:9`),
  styles from `DELIMITER_STYLE_OPTIONS`, name row (fixed / first primary key / per-entry),
  example card, malformed banner, per-entry preview rows + `DiffViewer`, apply via
  `workspace.updateManyEntries` (`delimiter-dialog.ts:386–417`). Opened **only** from
  `EntryContentField.openDelimiterDialog()` (`entry-content-field.ts:112–122`) via plain
  `MatDialog.open` + `.app-compact-fullscreen-dialog` (styles.scss:168–184) — the app's one
  top-level pane not on `ResponsiveOverlayService`.
- **Core**: `src/app/core/models/delimiters.ts` (437 lines) — `DelimiterStyle` union, `TAG_RE` /
  `BRACKET_RE` / `SEPARATOR_RE`, `detectDelimiter` / `wrapContent` / `unwrapContent` /
  `rewrapContent`, `sanitizeDelimiterName`, malformed family (`MalformedWrapper`,
  `detectMalformedWrapper`, `stripMalformedWrapper`), `DELIMITER_STYLE_OPTIONS`, entry-name chain
  (`entryDelimiterName`, `entryDelimiterNameFromKey`). **No markdown support** (task 01 §3.1
  explicitly deferred it: "Markdown-header content is treated as ordinary payload").
- **Selection infra**: `entry-list.ts` — `selection` signal, desktop batch toolbar
  (entry-list.html:59–103, `[Batch edit] [Export] [⋮ More] [✕]`), `openBatchOperations()`
  (ts:458–487) = the `overlays.openResponsive` + dual-inject + `paneResult` + `clearSelection`
  precedent (`BatchOperationsDialog` dual-injects `MatDialogRef`/`MatBottomSheetRef` and both DATA
  tokens). Mobile: batch actions render in the docked bottom bar's `batch` state, routed through
  `app.ts` (~line 318).
- **Dialog expected-name rule**: `resolveExpectedNames` (`delimiter-dialog.ts:214–223`) accepts the
  resolved name + entry-derived chain + **the detected wrapper's own name** (any well-formed
  wrapper is replaceable). §4.3 deliberately does NOT extend that acceptance to markdown (D7).
- **Linter**: `malformed-wrapper` rule (`linter.ts:418–436`) shares the entry-name hint chain with
  the content-field badge by contract (task 05 §3.2.4).
- **Tests**: `delimiters.spec.ts` (~90 cases), `delimiter-dialog.spec.ts` (27),
  `entry-content-field.spec.ts` (7), `e2e/delimiters.spec.ts` (desktop suite + a 390×844
  full-screen-dialog mobile suite at :640), `e2e/linter.spec.ts:124`, `e2e/batch-and-tokens.spec.ts`.

## 3. Design decisions (locked with the user, 2026-09-26)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Entry point for selection apply | **Batch action**: labeled "Delimiters" button in the desktop batch toolbar + the mobile bottom bar's batch actions (Batch-edit mirror) |
| D2 | Scope when opened from selection | **Locked** to the selection (no Apply-to select; header shows "N entries") |
| D3 | Mobile | **Migrate now** to the dual-container responsive pattern (in this task) |
| D4 | Granularity | **One branch, phased commits** (`feature/12-delimiters-selection-and-markdown`) |
| D5 | Markdown shape | Header + blank line + verbatim payload; **optional trailing `\n\n---` via checkbox** |
| D6 | Level | **Picker `#`–`######`, default `##`**, normalized across all targets on apply |
| D7 | Detection gate | **Name-matched only**: a first-line header is a wrapper only when its text matches the entry-derived expected-name chain; foreign headers and prose stay payload (stricter than the tag rule — see §4.3) |
| D8 | Malformed markdown | **Minimal shapes**: empty first-line header (`##` with no text) + `#Name`-no-space when the name matches hints; nothing else |
| D9 | Action placement | **Direct toolbar button** (not the ⋮ menu, not chained inside Batch edit) |
| D10 | Discoverability | **In-pane hint** under the Apply-to select in the editor-opened dialog (the only touch picked; no tooltip/CHANGELOG extras beyond the standard release entry) |

## 4. Core contract — `delimiters.ts` (target state, pure & total)

### 4.1 Style union and options

- `DelimiterStyle` gains `'markdown'`; `DELIMITER_STYLE_OPTIONS` gains
  `{ value: 'markdown', label: 'Markdown — ## Name', hint: 'ATX heading, optional trailing ---' }`
  placed **after `bracket`** (named-wrapper family) and before `separator`.
- New additive options parameter on the wrap APIs (existing call sites and pins unchanged):

```ts
export interface MarkdownWrapOptions {
  level?: 1 | 2 | 3 | 4 | 5 | 6;   // default 2
  trailingSeparator?: boolean;      // default false
}
wrapContent(content, style, name, options?: MarkdownWrapOptions): string;
rewrapContent(content, style, name, expectedNames?, options?): string;
```

- `wrapContent('markdown')`: blank payload no-op (invariant); emits
  `#{level} {safeName}\n\n{payload}` (+ `\n\n---` when `trailingSeparator`), `safeName` via
  `sanitizeDelimiterName` with the `'entry'` fallback — spaces survive (header text is prose).
  The trailing separator appends unconditionally (same documented ambiguity as `separator`: a
  payload already ending in blank lines is indistinguishable; re-apply canonicalizes).

### 4.2 Detection (shape-level, name-agnostic — the gate lives at strip time)

`DetectedDelimiter` gains optional `level?: 1–6`. `detectDelimiter` order becomes
**tag → bracket → markdown → separator** (a markdown wrapper with a trailing `---` must classify
as markdown, never as bare separator).

Markdown shape = first line `[ \t]*(#{1,6})[ \t]+{name}` where:

- the name (rest of the line, trimmed) is non-blank and ≤ 80 code points;
- after the header's line terminator, **at most one structural blank line** is tolerated (the
  canonical emitted form has exactly one; a hand-written tight `## Name\ncontent` also detects —
  re-apply canonicalizes to the blank-line form, diff-visible);
- the payload (everything after the structural newlines, excluding any trailing separator run)
  is non-blank — `## Name\n\n---` alone is **not** a markdown wrapper (blank payload) and falls
  through to `separator` with the header as payload.

Not markdown (stay payload / other styles): `#{7,} Name`, `#Name` (no space — that is §4.5's
hint-gated malformed shape), a header on any line but the first, an empty name.

### 4.3 Name-matched stripping (D7 — stricter than tags)

The dialog's accepted-detected-name rule (any well-formed wrapper is replaceable because its own
detected name is injected into `expectedNames`) is **not** extended to markdown. For style
`markdown`, `unwrapContent` strips only when the header text matches `expectedNames` via
`delimiterNameMatches` (case-insensitive, sanitized). The dialog's `resolveExpectedNames` passes
the entry-derived chain (resolved name + `entryDelimiterName` + `entryDelimiterNameFromKey`)
**without** the detected markdown name, so a foreign-named header is previewed as unchanged.
Escape hatch (documented in the pane copy review): typing the header's current text as the fixed
wrapper name adds it to the chain and makes the wrapper replaceable.

**Fallback chain (regression-critical)**: when markdown is detected but the name gate fails,
`unwrapContent` must fall back to separator handling on the full text (a trailing `---` stays
strippable under `stripSeparator`) — otherwise applying `separator` to foreign-header content
that already ends in `---` would emit a second marker (today it is idempotent). Tier-1 pins this.

### 4.4 `stripSeparator` matrix (target style → is a trailing `---` consumed?)

| Target style | Trailing `---` | Notes |
|---|---|---|
| `none`, `separator` | consumed | existing behavior, unchanged |
| `markdown`, toggle ON | consumed, re-emitted once | idempotent, normalizes level + spacing |
| `markdown`, toggle OFF | consumed | the toggle must actually remove the old marker |
| `tag`, `bracket` | kept as payload | scene-break protection, unchanged |

> **Amendment (user, 2026-09-26, post-testing)**: a trailing `---` is consumed
> on **every** style switch. When a markdown **wrapper** is detected, the
> marker is the style's own toggle (a foreign-named header keeps D7 header
> protection, its marker does not survive). When the content merely *ends*
> with `---` (separator detection — the user applied it as the delimiter),
> the switch consumes it too: the user confirmed this second case the same
> day. The one surviving D4 protection: a `---` *inside* a tag/bracket
> payload (a scene break with content around it) is never touched.

Two pinned-behavior effects of the detection-order change (checkpoint **12-1** evidence):
`delimiterLabel`/badge for header-led content that used to read `---` (separator) or nothing now
reads the header (`## Name`), and `# Header`-led content classifies `markdown` instead of
`none`. Task 01's "markdown header is ordinary payload" pins migrate in P1.

### 4.5 Malformed markdown (D8 — flows into the existing family)

```ts
| { kind: 'empty-header'; level: number }    // '##\n\npayload' — hashes, no name, non-blank payload below
| { kind: 'no-space-header'; name: string }  // '#Name\n…' — first line, hint-gated
```

- **`empty-header`**: first line is `#{1,6}` + trailing whitespace only, followed by a non-blank
  payload. Fires **without hints** (mirrors `mismatched`: a whole-content empty heading is never
  innocent prose). Blank payload never classifies.
- **`no-space-header`**: first line matches `^#{1,6}\S`, the text after the hashes (trimmed)
  matches `hints` via `delimiterNameMatches` — hint-gated like orphans, so a `#hashtag` line in
  prose stays payload. Both DATA surfaces pass the entry-derived chain (linter/badge/dialog).
- `malformedWrapperLabel`: `## ?` / `#Name ?`. `stripMalformedWrapper` removes the offending
  first line + one structural blank line, payload verbatim; one shell per call, idempotent.
  Guard 1 (well-formed never malformed) covers markdown automatically via §4.2.
- Linter: both kinds flow through the existing `malformed-wrapper` rule (no new rule id);
  severity `warning` for both (no payload-corruption risk; `mismatched` stays `error`).

## 5. UI contract

### 5.1 Pane migration (D3)

`DelimiterDialog` becomes a dual-container pane exactly on the `BatchOperationsDialog` pattern:
optional `MatDialogRef`/`MatBottomSheetRef` pair, optional `MAT_DIALOG_DATA`/
`MAT_BOTTOM_SHEET_DATA` (fallback `{ entryIds: [] }`), shared title/close markup. Both entry
points route through `overlays.openResponsive`:

- `EntryContentField.openDelimiterDialog()` keeps the lazy import, swaps `dialog.open` for
  `overlays.openResponsive(...)`; dialog config `{ panelClass: 'app-compact-fullscreen-dialog',
  maxWidth: 'min(96vw, 860px)' }` (unchanged), new `sheetPanelClass: 'app-delimiters-sheet'`
  (styles.scss, `app-batch-sheet` recipe at 246–251).
- Audit `app-compact-fullscreen-dialog` consumers before touching its CSS — the class is shared;
  only delimiters' reliance changes (phones now get the sheet; the <599px full-screen rule simply
  stops applying to this pane).

### 5.2 Data model + selection entry points (D1, D2)

```ts
interface DelimiterDialogData {
  entryIds?: number[];          // selection mode when non-empty → scope locked (D2)
  activeEntryId?: number | null; // editor mode (entry | all), unchanged
}
```

- Selection mode: Apply-to select hidden; header "Delimiters — N entries"; preview/apply
  machinery unchanged (already N-entry). Apply → `updateManyEntries`, snackbar, `close(true)`,
  and the **caller clears the selection** (Batch-edit precedent).
- `EntryList.openDelimiters()` mirrors `openBatchOperations()` (ts:458–487): guard on
  `selectionCount() > 0`, `openResponsive` with `{ entryIds: [...selection] }`, `paneResult`,
  `clearSelection()` on applied.
- Desktop toolbar: labeled icon button **Delimiters** after Batch edit — icon `code` (reuses the
  content-field delimiter affordance; ligature already in the subset, no `icons:refresh` needed).
- Mobile: `app.ts` gains `case 'delimiters-selection'` routing to `list.openDelimiters()`
  (existing bottom-bar batch action list).

### 5.3 Markdown controls (D5, D6)

When style = `markdown` (name required, so `needsName('markdown') = true`):

- **Level** mat-select, options `#`–`######` (H1–H6), default `##`. Exemplar: the Selective-logic
  select in the Batch-edit pane.
- **"Add trailing ---"** checkbox, default off. Exemplar: the "Use first primary key" checkbox in
  this dialog.
- Example card renders the live shape (level + toggle aware). Preview rows/chips/hints reuse the
  existing machinery: `replacedDelimiter` shows the detected markdown label; malformed chips
  `empty header` / `missing space` join `mismatched` / `unclosed`.

### 5.4 Discoverability hint (D10)

Editor-opened pane only, under the Apply-to select, always visible (entry/all scopes):
"Select entries in the list and choose Delimiters in the batch toolbar to apply to a range."
Copy finalized with `frontend-design` in P2. Not shown in selection mode (the reader is already
there).

## 6. Test matrix

**Tier 1 — `delimiters.spec.ts`** (extend, ~90 existing cases untouched except the two migrated
task-01 markdown pins):

| Area | Required cases |
|---|---|
| wrap | levels 1–6 round-trip; default `##`; toggle on/off; blank no-op; name sanitize + `'entry'` fallback; spaces in names survive |
| detect | blank-line vs tight form; CRLF; `#{7,}` payload; `#Name` not detected; header on line 2 not detected; `## Name\n\n---` → `separator`; markdown-with-`---` → `markdown` (order pin); 80-cp cap |
| unwrap/rewrap | name-matched strip byte-lossless; foreign-name no-touch **+ separator fallback idempotency pin** (§4.3); level normalize on re-apply (never nests); toggle-off removes old `---`; toggle-on single `---`; markdown→tag keeps trailing `---` as payload; idempotency fixed points for every style pair |
| malformed | `empty-header` fires un-hinted, blank payload → null; `no-space-header` hint-gated both directions; strip lossless + idempotent; labels; well-formed markdown never malformed |

**Tier 2 — `delimiter-dialog.spec.ts` / `entry-list.spec.ts` / `entry-content-field.spec.ts`**:
selection mode (locked scope, header count, apply writes only the selection, selection cleared);
editor mode unchanged + hint rendered (and absent in selection mode); markdown controls (defaults,
example card, preview rows, malformed chips); badge shows `## Name` for detected markdown;
`openDelimiterDialog` goes through `openResponsive`.

**Tier 3 — `e2e/delimiters.spec.ts` + `e2e/batch-and-tokens.spec.ts`**: desktop selection flow
(select rows → toolbar Delimiters → apply → content + cleared selection); markdown apply +
re-apply idempotency + level normalization + toggle; export → re-import byte-survival of a
markdown wrapper (mirrors the existing cycle test); malformed markdown repair; **migrate the
390×844 mobile suite from full-screen-dialog assertions to `app-delimiters-sheet` bottom-sheet
assertions**, and add the mobile bottom-bar batch-state → Delimiters flow.

## 7. Implementation plan

| Phase | Owner | Work | Commit |
|-------|-------|------|--------|
| **P0** | orchestrator | Before-set screenshots (`__screenshots__/12/`, pinned conditions) on `develop` | — |
| **P1 — core** | `core-engine` | §4 (style + options + detection order + fallback + malformed kinds); Tier-1 matrix incl. migrated task-01 pins | `feat(delimiters): add markdown wrapper style with name-matched detection` |
| **⏸ Checkpoint 12-1** | user | Old-vs-new pinned-behavior contract (§4.4) with minimal repro — **blocking** | — |
| **P2 — UI** | `ui-specialist` | (a) §5.1 + §5.2 migration/entry points/hint; (b) §5.3 markdown controls + preview/chips; Tier-2 specs | `feat(delimiters): apply to the checked selection via the batch toolbar` · `feat(delimiters): markdown style controls in the pane` |
| **⏸ Checkpoint 12-2** | user | After-set screenshots + exemplar table (§5.3) — **blocking** | — |
| **P3 — review** | `ts-reviewer` | Strict typing (exhaustive `MalformedWrapper`, union data model), lint | `refactor(delimiters): …` (as triggered) |
| **P4 — QA** | `qa-auditor` | Tier-3 e2e + migrated mobile suite; coverage; desktop-chrome smoke; branch-final three-project sweep | `test(e2e): …` + `docs(next_tasks): task 12 …` |

Progress ledger `next_tasks/12-PROGRESS.md` after every phase (shared convention). Branch
`feature/12-delimiters-selection-and-markdown` off `develop`; push at close, stop for user
testing — no auto-merge.

## 8. Verification gates

Per task (fast): `npm run build` · `CI=true npm test -- --watch=false` (+ coverage thresholds) ·
`npm run lint` · `npm run typecheck:e2e` · desktop-chrome smoke of touched e2e specs.
Branch-final: three-project Playwright sweep per project + closing coverage/lint. Known
pre-existing red (mobile-safari bottom-bar export menu, AGENTS.md) is not this task's regression.

## 9. Risks & trade-offs

1. **Foreign-named markdown wrappers are not replaceable** (D7, stricter than tags). Accepted by
   design; the fixed-name escape hatch (§4.3) covers stuck wrappers. Revisit only on a real
   report.
2. **Detection-order flips pinned behavior** (badge `---`→`## Name`; `# Header` payload→wrapper
   shape). Migrated pins in P1, user sign-off at 12-1 — never closed on a recommended default.
3. **Separator double-emit regression** if the §4.3 fallback is missed — dedicated Tier-1
   idempotency pin.
4. **Tight-form canonicalization**: re-applying to a hand-written `## Name\ncontent` adds the
   structural blank line — diff-visible by contract ("what is previewed is what is written").
5. **Mobile e2e churn** from the sheet migration — both existing mobile specs migrate in P4, not
   deleted.
6. **Toolbar crowding** (D9 direct button): if checkpoint 12-2 flags width, fall back to
   icon-only + tooltip; the labeled form is the default.
