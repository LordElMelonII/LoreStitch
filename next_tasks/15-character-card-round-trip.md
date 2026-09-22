# Task 15 — Character Card Round-Trip (PNG & JSON)

> **Source**: user prioritization decision, 2026-09-22 — *"The Character Card PNG
> Round-Trip is the most important one to be done next … Character Cards can be
> PNGs or JSONs … import/export should overtake any other planned tasks."*
> The 2026-09-22 app review verified the feature absent end-to-end (see §2) and
> queued it as a ROADMAP idea; the user promoted it to the top of the queue and
> declassified task 14 (Starter Presets & Templates).
> **Type**: New import/export capability (data-loss prevention for the dominant
> sharing format) + new export surface
> **Suggested agents**: `core-engine` (lead: PNG codec + card spec model) →
> `ui-specialist` (import flow, export surface, copy) → `ts-reviewer` →
> `qa-auditor`
> **Status**: 🔴 Urgent — overtakes the queue (tasks 10, 09, 11 resume after)
> **Dispatch precondition**: the user supplies the reference card PNG + JSON
> (§3.7) at task start — promised 2026-09-22, not yet provided. Planning,
> review, and the in-test codec specs need nothing; P4 (e2e) blocks on them.

---

## 1. Objective

A SillyTavern character card (PNG or JSON, V2 or V3) round-trips through
LoreStitch: **import** extracts the embedded `character_book` into a project
for full editing; **export** re-embeds the edited book into the *same card
container* — every other byte of the card is preserved exactly. The
never-drop-vendor-keys invariant extends one level up: not only unknown keys
inside the book, but the whole card shell (name, description, avatar image,
alternate greetings, assets, unknown fields, other PNG chunks) must survive
untouched. LoreStitch edits the book; it never rewrites the character.

Card = PNG (`tEXt` chunk `chara`, base64 V2 JSON, or `ccv3`, base64 V3 JSON)
**or** card JSON (`spec: "chara_card_v2"` / `"chara_card_v3"` with
`data.character_book`). Both are first-class in this task; PNG is the hard
part, JSON is wiring.

## 2. Gap analysis (develop @ `8d85720` + review branch)

Import is JSON-and-book-only by construction; the card layer does not exist:

| Surface | Today | Evidence |
|---|---|---|
| File reading | `readFileText` — *"imports are JSON only"*; `JSON.parse(await file.text())` | `import-export.service.ts:63-66`, `project-actions.service.ts:145` |
| Import detection | `parseImport` sniffs exactly `character_book` / `stproj` / `sillytavern_native`; a card JSON falls into no branch (its `data.character_book` is invisible) | `import-export.service.ts:76-133` |
| File picker | `IMPORT_ACCEPT = '.json,.stproj,application/json'` — `.png` unreachable | `project-actions.constants.ts:2` |
| PNG handling | zero occurrences of `tEXt` / `chara` / `ccv3` / base64 card decoding anywhere in `src/` (2026-09-22 app-review audit) | — |
| Model hint | `targetType: 'tavern_card_v2'` exists as an enum value but nothing parses or produces a card | `lorebook.model.ts:168` |
| Fixtures | `example_card/` holds JSON books only; no card PNG or card JSON fixture | — |

Round-trip suites stay green today because they never see a card — the hole is
the entire card ecosystem (the dominant way lorebooks are shared).

## 3. Design

### 3.1 Card model + PNG codec — `core/models/character-card.ts` (new)

Bare, framework-free, total (house shape: `st-trigger.ts`, `sha256.ts`). All
byte work through `DataView`/`Uint8Array`; a pure `crc32` helper lives here too
(needed to re-emit chunks; same no-decorator rule). No DOM, no Angular.

```ts
export type CardSpec = 'chara_card_v2' | 'chara_card_v3';

/** Result of a successful card open (PNG or JSON source). */
export interface OpenedCard {
  readonly spec: CardSpec;
  /** Full card JSON as parsed — re-serialized verbatim on export, book swapped. */
  readonly cardJson: string;
  /** The embedded book, run through the normal import pipeline afterwards. */
  readonly rawBook: unknown;
  /** For PNG sources: the original bytes, kept as the export shell. */
  readonly pngBytes?: Uint8Array;
  /** Which text-chunk keyword carried the card (export must reuse it). */
  readonly pngKeyword?: 'chara' | 'ccv3';
}

/** Open a card PNG: signature check, chunk walk, `chara`/`ccv3` tEXt extraction. */
export function openCardPng(bytes: Uint8Array): OpenedCard | CardError;
/** Open a card JSON (`spec` + `data.character_book`; V1 without a book → error). */
export function openCardJson(text: string): OpenedCard | CardError;
/**
 * Re-embed `cardJson` into the PNG shell: replace the same-keyword tEXt chunk
 * in place (recomputed CRC), or insert a fresh tEXt before IEND if absent.
 * Every other chunk — including all IDATs — is byte-identical.
 */
export function embedBookInPng(pngBytes: Uint8Array, cardJson: string, keyword: 'chara' | 'ccv3'): Uint8Array | CardError;
```

`CardError` is a discriminated result (`reason: 'not-a-png' | 'no-card-chunk' |
'bad-chunk-crc' | 'card-without-book' | …` with a humanized message) — never a
throw on the import path (import-failure snackbar precedent,
`project-actions.service.ts:152-157`).

Rules:

- **PNG walk**: 8-byte signature, then `[len, type, data, crc]` chunks;
  `tEXt` = keyword + NUL + Latin-1 text; `chara`/`ccv3` payloads are
  standard-alphabet base64 of the card JSON. Unknown/foreign chunks are never
  inspected beyond the walk.
- **Card JSON normalization**: none beyond `data.character_book` extraction.
  The card object is kept as-parsed; on export only
  `data.character_book` is swapped and the rest re-serialized in original key
  order (`JSON.parse` → `JSON.stringify` preserves insertion order).
- **Book conversion**: the extracted raw book goes through the existing
  import pipeline (`isCharacterBook` → `normalizeImportedBook`,
  `lorebook.model.ts:821,891`) — no parallel book path, so vendor-key
  preservation is inherited, not reimplemented.
- **Export book shape**: cards embed the `character_book` shape; the export
  converts via `toSpecCompliantBook` (`lorebook.model.ts:517`) — the same
  conversion the Character Book JSON export already uses, one path, not a
  new one. **V3 caveat**: the CCv3 book schema has deltas beyond the V2
  shape (string entry `id`, `name` in place of `comment`, per-entry
  `use_regex`) — P1 verifies the exact deltas against the user-provided
  V3 fixture, and if V3 needs its own book mapping, it lives inside
  `character-card.ts` at the card boundary; the vendor card/book objects
  themselves are never normalized to fit.
- **V1 cards** (`name`/`description`/… without `spec` and without
  `data.character_book`): rejected with a clear message — there is no embedded
  book to edit (§7.2).
- **iTXt/zTXt**: import tolerates an uncompressed iTXt carrying `chara`
  (robustness against non-conformant writers); zTXt (zlib) is out of scope.
  Export always writes tEXt.
- **Dual-chunk cards** (real fixtures carry both): when `chara` and `ccv3`
  coexist, import prefers `ccv3` (newest spec); export re-embeds the updated
  book into **every** card-carrying chunk the source had — V2 shape for
  `chara`, V3 shape for `ccv3` (the mapping is part of P1's V3 delta work) —
  so no chunk is left holding a stale book. Foreign chunks (e.g. the
  fixture's `deBG`) are opaque to the codec and preserved byte-for-byte.

### 3.2 Card shell storage — `core/models/project.model.ts`

To re-embed, the project must remember the container it came from:

```ts
export interface CardShell {
  readonly spec: CardSpec;
  /** PNG bytes of the imported card; undefined for JSON-card sources. */
  readonly pngBytes?: Uint8Array;   // stored as-is in IndexedDB (structured clone)
  readonly cardJson: string;        // the card's other fields, verbatim
  readonly pngKeyword?: 'chara' | 'ccv3';
}
// ProjectWorkspace gains optional `readonly cardShell?: CardShell`
```

- `isProjectWorkspace` tolerance: absent = projects created fresh from
  `createProject` — PNG export is simply unavailable for them (§3.4);
  JSON-card export from a shell-less project fabricates a minimal V2 card
  (`data.name` from the project title) — a shell-less *JSON card* export needs
  no image and stays available.
- `.stproj` archives are JSON: `pngBytes` must not ride the serializer
  verbatim (`JSON.stringify` renders a `Uint8Array` as a keyed object, not
  data) — the archive writer needs an explicit base64 transform on export
  and decode on import (~+33% size for the image only). Archive version
  `LORESTITCH_ARCHIVE_VERSION` already tolerates additive fields via
  `isProjectWorkspace`.
- VCS is unaffected by the shell: commit hashing covers the book only
  (`hashBook`/`serializeBook`), so importing a card or holding a shell never
  dirties history — no commit or dirty-tracking changes in this task.
- Old projects never regress: `cardShell` is optional everywhere; every
  existing spec passes untouched.

### 3.3 Import wiring — `import-export.service.ts` + `project-actions.service.ts`

- `import-export.service.ts`: a card branch in `parseImport`
  (`openCardJson` for text files whose sniff fails the three existing shapes;
  `openCardPng` for `.png` files) — the extracted book flows through the
  exact same `createProjectFromBook`/merge prompts as today. Success feedback
  should name the card ("Imported lorebook from character card '<name>'.")
  so users know which layer was opened.
- `project-actions.service.ts`: `importFromFile` accepts `.png`; the accept
  filter gains `.png,image/png`; `readFileText` is bypassed for PNGs (bytes
  path — `file.arrayBuffer()`).

### 3.4 Export surface — `import-export.service.ts` + shell menus

Two new exports beside the existing four:

- **Character card (PNG)** — only when `cardShell.pngBytes` exists: embed the
  updated card JSON into the shell, download as `<card-name>.png`.
- **Character card (JSON)** — always available: from the shell's
  `cardJson` (book swapped) or a fabricated minimal V2 card shell-less.
- Both return the `ExportResult`-style contract; **when task 09 lands, card
  exports route through the same pre-flight validator** (the embedded book is
  a book) — noted here so 09's wiring does not miss the two new call sites.
- Menu placement: the export menu / More menu where the other four live
  (`topbar`, mobile bar routes through `ProjectActionsService`). New
  interactive controls ⇒ design-evidence checkpoint 15-1 with rendered mocks
  (the `__screenshots__/*/[mock-]*.mjs` real-app-driving precedent), plus the
  before/after screenshot baseline (visual feature).

### 3.5 Failure surface

Card parse failures reuse the import-failure snackbar shape with
card-specific copy ("Not a character card — no embedded lorebook found in the
PNG."). PNG export without a shell is disabled in the menu (tooltip explains:
"Export a card PNG by importing one first") rather than erroring at click
time. Copy finalized in the P2 phase report.

### 3.6 Test matrix

| Tier | Required cases |
|------|----------------|
| Unit — `character-card.spec.ts` | codec: minimal PNGs **built in-test** (crafted chunks + crc32): parse→embed→parse identity for every non-book byte; replace-in-place when the chunk exists (length change allowed, recompute CRC), insert-before-IEND when absent; multiple `chara` chunks → first wins + warning reason; truncated/signature-less bytes → `CardError`, never throw; oversized book (multi-100KB) round-trips; Latin-1 text boundary respected |
| Unit — `character-card.spec.ts` (JSON path) | V2/V3 card JSON open; V1 card → `card-without-book` error; unknown card fields survive open→embed verbatim (never-drop pin at the card level); base64 round-trip of the `chara` payload |
| Unit — `import-export.service.spec.ts` | card JSON import produces a project whose book matches the plain-book import of the same `character_book` (pipeline-equivalence pin); card PNG import/export: IDAT bytes unchanged; project without shell exports the JSON card but has PNG export unavailable; shell round-trips through `.stproj` (base64 encode/decode) |
| Unit — workspace/archive | `isProjectWorkspace` accepts with/without `cardShell`; old archives unchanged |
| E2E — new `e2e/character-card.spec.ts` | fixture card PNG (§3.7): import → edit an entry → export card PNG → re-import → edit visible; byte-compare the exported PNG against the fixture shell for all non-`chara` bytes; card-JSON import via the same helper path; PNG export disabled without a shell |
| Existing suites | round-trip/fidelity specs green **without edits** (card work is additive); all shell/menu e2e still pass with the two new export entries |

### 3.7 Fixtures — user-provided reference cards

The user supplies the example cards when the task starts (promised
2026-09-22; **file names agreed**): `example_card/example_card.png` and
`example_card/example_card.json` — ideally covering both V2 and V3 between
them and carrying non-trivial `extensions` plus unknown fields to exercise
the never-drop pins. They land in `example_card/` beside
the existing reference books and are the e2e/round-trip material, imported
through the `importLorebook` helper path. Unit specs do **not** depend on
them — §3.6's codec specs craft minimal PNGs in-test (deterministic, no
binary needed in the spec tree). If a real fixture encodes a shape the
codec rejects, the fixture wins and the codec is wrong — the same stance as
task 09 §7.1.

**Verified fixture profile (2026-09-22, files supplied)**:
`example_card.png` (1.4 MB) = valid PNG with `IHDR · tEXt(chara, V2) ·
tEXt(ccv3, V3) · 90×IDAT · deBG · IEND`, both card chunks carrying the same
70-entry book — dual-chunk rule (§3.1) is exercised for real, and `deBG` is
the foreign-chunk never-drop pin. `example_card.json` = `chara_card_v3`
3.0, 70 entries whose first entry carries both `comment` and `name` and no
`id` — id-less entries flow through the existing `normalizeImportedBook`
id assignment like any id-less book, and the `name`/`comment` dual field is
preserved as vendor data, never collapsed. Both spec versions are therefore
covered, exceeding the "ideally both" ask.

## 4. Implementation Plan

| Phase | Files | Work |
|-------|-------|------|
| **P1 — Codec + card model** (core-engine) | `core/models/character-card.ts` (+spec), `core/models/project.model.ts` (shell + tolerance), `core/models/README.md` | §3.1 + §3.2 |
| **Checkpoint 15-1** (user) | — | shell-storage decision (store vs. re-import-per-export), PNG-export availability rule, menu placement evidence, copy |
| **P2 — Wiring** (ui-specialist) | `import-export.service.ts`, `project-actions.service.ts`, `project-actions.constants.ts`, export menu templates, snackbar copy | §3.3 + §3.4 + §3.5 |
| **P3 — Review** (ts-reviewer) | all touched | `DataView` byte-reading rigor, result-union exhaustiveness, `Uint8Array` immutability, lint |
| **P4 — E2E & evidence** (qa-auditor) | `e2e/character-card.spec.ts`, `example_card/` fixtures (user-provided, §3.7), screenshots | §3.6 + §3.7 + baseline |

Commits: `feat(core): character-card model and PNG codec`, `feat(export):
character card import/export wiring`, `feat(shell): card export surface`,
`test(e2e): character card round-trip`, `docs(next_tasks): …`.

## 5. Orchestration

1. **`core-engine`** — P1 (skills: `typescript-advanced-types`). *Gate:
   `npm test`.*
2. **User checkpoint 15-1** — shell storage + export surface + copy. Gate
   stays open until answered.
3. **`ui-specialist`** — P2 (skills: `material-3`, `frontend-design`). *Gate:
   `npm test` + `npm run build`.*
4. **`ts-reviewer`** — P3. *Gate: `npm run lint`.*
5. **`qa-auditor`** — P4 (skills: `playwright-cli`). *Gate:
   `npx playwright test character-card round-trip` per project (long-gate
   rule: one project per command), coverage diff clean, screenshots posted.*

## 6. Verification Gates

`npm run build` · `npm test` · `ng test --coverage` (codec fully covered) ·
`npx playwright test character-card round-trip` · `npm run lint` ·
byte-preservation asserted in unit specs (non-book PNG bytes and non-book card
JSON keys) and re-proven by e2e re-import.

## 7. Risks & Open Questions

1. **Shell storage cost**: storing the card PNG in the workspace grows
   IndexedDB records and `.stproj` archives by the image size (cards are
   typically 0.4–1.5 MB). Alternative — re-import the card at export time —
   kills the one-click promise. Checkpoint 15-1 decides; recommendation is
   store (data-loss prevention beats archive size).
2. **IndexedDB write amplification**: every debounced `scheduleSave` put
   serializes the whole `ProjectWorkspace` record — with the shell embedded,
   a ~1 MB image is structured-cloned on every 400 ms save window even when
   only entry text changed. Options at checkpoint 15-1: (a) accept it
   (single-user local app; MBs are cheap), (b) keep shells in a separate
   IndexedDB record keyed by project id, written once at import and read at
   export — costs a `StorageService` surface change. Recommendation: start
   with (a), measure, move to (b) only if saves visibly regress.
3. **V1 cards without a book**: rejected at import with a clear message. An
   "edit a V1 card's description fields" feature is out of scope (LoreStitch
   edits books, not characters) but could be a follow-up task.
4. **Non-conformant PNGs**: zTXt-compressed card chunks (rare) are not read;
   the import error names the limitation rather than silently ignoring the
   chunk. Animated PNG (APNG) is unaffected — the codec only rewrites chunk
   boundaries around tEXt.
5. **Multiple `chara` chunks**: malformed cards exist; first chunk wins, the
   error/warning surfaces it, and export replaces that same chunk position.
6. **Task 09 interplay**: pre-flight export validation does not exist yet; the
   card export methods land with the `ExportResult` contract shape so 09's
   wiring can adopt them without re-signing (§3.4).
7. **Fixture size**: the user-provided card PNG (typically 0.4–1.5 MB) joins
   the `example_card/` reference set — acceptable by precedent (the Fate
   Stay Night book is comparable). Unit specs stay binary-free (in-test
   crafted PNGs).
