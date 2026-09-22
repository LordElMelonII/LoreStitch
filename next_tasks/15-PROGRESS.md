# Task 15 — Progress Ledger (character card round-trip)

Plan: [15-character-card-round-trip.md](./15-character-card-round-trip.md) (re-grounded 2026-09-22).
Branch: `feature/15-character-card-round-trip` (created 2026-09-22 off `develop` @ `e9b2ca1`).
Push policy: pushed to origin after every phase commit (house crash-backup rule; no contrary user order this session).

## Pre-phase setup — 2026-09-22

- Preconditions verified cheaply: fixtures present; profile confirmed by direct byte/JSON inspection —
  `example_card/example_card.png` (1,439,893 B): valid signature, 106 chunks, clean walk to EOF,
  layout IHDR · tEXt(chara → chara_card_v2/2.0, 70 entries) · tEXt(ccv3 → chara_card_v3/3.0, 70 entries) ·
  90×IDAT · deBG (16 B foreign chunk) · IEND; no iTXt, no zTXt.
  `example_card/example_card.json` (272,562 B): `chara_card_v3`/3.0, book keys `name,entries`, 70 entries,
  all 70 id-less, entry 0 carries both `comment` and `name` — matches plan §3.7's verified profile.
- Re-grounding landed in `1edf722` (`docs(next_tasks): re-ground task 15 plan`), drift found and corrected in the plan:
  - `parseImport` (import-export.service.ts:78-132) delegates sniffing to `detectLoreFileFormat`
    (`lorebook.model.ts:767-792`); its doc comment there (~line 765) still states cards are intentionally
    not recognized — correct it when the wiring lands (P2), not before.
  - Model helpers moved after a file split: `toSpecCompliantBook` → `lorebook.model.ts:395`,
    `isCharacterBook` → 695, `normalizeImportedBook` → 730.
  - Legacy card residue exists pre-incident: `TavernCardV2` interface (`lorebook.model.ts:20-40`) and
    `ProjectWorkspace.targetType: 'tavern_card_v2'` / `rawCardData?` (`project.model.ts:59,61`) — nothing
    parses/produces cards; the new `CardShell` is separate and additive, legacy fields untouched.
  - Project-actions service/constants actually live in `src/app/features/shell/` (snackbar precedent lines 150-156;
    `IMPORT_ACCEPT` constants:2-3).

## Phase P1 — 2026-09-22 — core-engine agent

**Files** (`94f9148`, `feat(core): character-card model and PNG codec`, 7 files, +2273/−5):
- NEW `src/app/core/models/character-card.ts` (+984) — bare framework-free card boundary + PNG codec:
  `crc32`, base64 helpers, `openCardPng`/`openCardJson`, `CardError` result union (10 reasons), `CardWarning`
  (`multiple-card-chunks` | `truncated-png`), plus the export side `embedBookIntoCardJson` +
  `updatedCardPayloads` + `embedCardPayloads` (dual-chunk re-embed).
- NEW `src/app/core/models/character-card.spec.ts` (+899) — 56 tests; minimal PNGs crafted in-test,
  binary-free.
- `project.model.ts` (+163) — `CardShell` (+ dual-chunk `extraCardJson`), `isCardShell`,
  `serializeWorkspaceForArchive`/`deserializeWorkspaceFromArchive` controls
  (`pngBytes` ⇄ `pngBytesBase64`), guard tolerance; `LORESTITCH_ARCHIVE_VERSION` unchanged.
- `import-export.service.ts` (+13) — narrow wrap at the two archive call sites only.
- Spec additions in `lorebook.model.spec.ts` (+8 tests) and `import-export.service.spec.ts` (+4).
- `core/models/README.md` catalog entries.

**Gates**: `CI=true npm test -- --watch=false` = 1162 tests green (subagent 56.7 s; orchestrator
counter-run green, coverage table clean, exit 0); `ng test --coverage` = 1162 green, no threshold
violations; `character-card.ts` + `project.model.ts` 100/100/100/100. Round-trip/fidelity suites green
**without edits**.

**Decisions/deviations** (recorded from the phase report):
1. Dual-chunk generalization (orchestrator-sanctioned, reported verbatim): plan §3.2's single
   `pngKeyword` replaced with preferred `cardJson`/`pngKeyword` + `extraCardJson` per-keyword record —
   the fixture carries independent V2+V3 card JSONs, both must survive export.
2. Plan sketch's `embedBookInPng(png, cardJson, keyword)` factored into `embedBookIntoCardJson` +
   `updatedCardPayloads` + `embedCardPayloads` (one shared conversion path).
3. Error-reason tokens beyond the sketch: `no-iend-chunk`, `bad-base64`, `card-json-invalid`,
   `not-a-card`, `compressed-card-chunk`, `stale-card-chunk`.
4. `embedBookIntoCardJson` = `toSpecCompliantBook` + card-JSON `data.character_book` swap. **V3-delta
   verdict (fixture wins)**: `example_card.json`'s V3 book uses V2-style field names plus `name` and
   no `id` — `toSpecCompliantBook` serves both `chara` and `ccv3` chunks; the plan's a-priori caveat
   (string entry ids, `name` in place of `comment`, per-entry `use_regex`) was refuted; NO
   card-boundary V3 mapping implemented; ids are assigned upstream by `normalizeImportedBook`
   (1-based, pre-existing reducer), never at the boundary; the `comment`+`name` dual field is
   preserved verbatim, never collapsed.
5. CRC verified only for card chunks actually read; untouched chunks' CRCs preserved verbatim.
6. iTXt uncompressed tolerated (rewritten as tEXt on export); zTXt never read — sole-card zTXt
   errors naming the limitation.
7. `isProjectWorkspace` shape-rejects a malformed shell when present (sign-all sanitation
   precedent contrast, per brief).
8. Storage-path audit: IndexedDB save path is structured clone (`db.put`, Uint8Array-safe) — no
   change needed; `vcs.service.ts` canonicalJson hashes book snapshots only (never the shell).
9. Checkpoint note (§7.2): every 400 ms save structured-clones the shell (~1.4 MB fixture class);
   archive +33% (~1.92 MB base64); `openCardPng` on the fixture ≈150 ms one-off.

## Checkpoint 15-1 — GATE OPEN (unanswered) — 2026-09-22

- **P1 landed** (`94f9148`) before the gate; branch pushed through `aa0776e`.
- **Evidence produced and posted** (mock by driving the real app, precedent
  `__screenshots__/*/[mock-]*.mjs`; script
  `__screenshots__/15-character-card-round-trip/mock-menu.mjs`, shots under its
  `checkpoint/` dir — gitignored):
  - desktop 1280×800 light: no-shell disabled rows; disabled + tooltip
    "Import a character card first"; enabled-state simulation (disabled attr
    dropped); mobile 390×844 More → Export submenu with disabled rows.
  - Placement proposal: new "Character card" section at the END of the Export
    menu (after "Reference & proofreading"); same menu via More → Export on
    phones. Mock icons are in-subset stand-ins (`menu_book`/`code`); P2 proposes
    `image`/`article` + `npm run icons:refresh`.
  - Implementation discovery for P2: CDK renders overlays through the native
    Popover top layer — body-level elements cannot stack above an open menu;
    tooltips on truly-disabled buttons need a wrapper row (both noted in the
    checkpoint post).
- **Proposed copy** posted (menu rows, disabled tooltips, import success +
  per-reason failure snackbars, stale-chunk export failure). Card JSON export
  is field-faithful, not byte-identical (minified re-serialization + pipeline
  ids); PNG export preserves every non-card byte.
- **§7.2 recommendation presented**: inline `cardShell` (P1 measurements:
  ~1.4 MB structured clone per 400 ms save, archive +33%, `openCardPng`
  ~150 ms one-off); separate IndexedDB record as fallback.
## Checkpoint 15-1 — APPROVED — 2026-09-22

- **User answer**: *"Just checked the Screenshots. I approve."* — closes the
  checkpoint against the posted evidence:
  1. **Menu placement**: approved as mocked — new "Character card" section at
     the end of the Export menu (after "Reference & proofreading"); same menu
     via More → Export on phones.
  2. **Copy**: approved as proposed (titles/descriptions, disabled tooltips,
     import success + per-reason failure snackbars; see the posted table).
  3. **§7.2 storage**: inline `cardShell` on the project record — the
     checkpoint's presented recommendation (P1-measured acceptable) and the
     plan header's pre-recorded direction ("start with (a), measure, move to
     (b) only if saves visibly regress"). Separate-record remains the fallback.
- Evidence + copy + storage notes in the previous section (mock script
  `__screenshots__/15-character-card-round-trip/mock-menu.mjs`).

**Next:** dispatch P2 (ui-specialist) — `.png` accept path, card branches in
`parseImport`, two export flavors with approved availability rules + copy.
Gate: `npm test` + `npm run build`.

## Phase P2 — 2026-09-22 — ui-specialist agent

**Files** (`8a7e1b6`, `feat(export): character card import/export wiring`, 16 files,
+1506/−89): import wiring (IMPORT_ACCEPT + `.png` bytes path, `parseImport` card branch,
additive `parseCardImport` sibling, `ParsedImport.cardShell?`), shell via
`startProjectFromBook(title, book, cardShell?)` mutator, two export methods
(`exportCardPng`/`exportCardJson` returning `CardExportFailure | null`) + wrappers,
approved copy table `CARD_FAILURE_COPY` + `cardExportRowState` (single home for row
availability + tooltip), topbar + mobile-bottom-bar "Character card" sections,
`.card-export-unavailable` muted-row style (global styles, no `::ng-deep`), stale
card doc comments in `lorebook.model.ts` corrected, `image`/`article` ligatures added
via `npm run icons:refresh` (woff2 regenerated and staged with the commit), 25 new
unit tests (1187 total).

**Gates**: `CI=true npm test -- --watch=false` = 1187/1187 green, thresholds enforced
(subagent ~52 s; orchestrator counter-run exit 0); `npm run build` = green (13.5 s;
orchestrator counter-run exit 0). Round-trip/fidelity specs green without edits; one
pinned unit test migrated ('unsupported-format' → card copy — grepped, no e2e pins the
old text).

**Decisions/deviations**:
1. `parseImport` return type couldn't widen without breaking ~40 spec call sites —
   reason-carrying path is the additive `parseCardImport(source): CardImportParse`;
   `parseImport` gains an optional third `source` param and folds card failures into
   `null` (historical contract).
2. Unrecognized JSON now reports card-layer copy (`card-without-book`) instead of the
   generic unsupported-format text; one pinned unit test migrated accordingly.
3. Card section duplicated into the mobile bottom bar's export menu (house rule:
   duplicate markup, never logic — both menus share `cardExportRowState`).
4. Unavailable rows stay ENABLED buttons, muted via `.card-export-unavailable`
   (Material's stock `[disabled]` recipe) — Material tooltips never fire on truly
   disabled buttons, and MatMenuItem's host binding unconditionally writes
   `aria-disabled=false`; the unavailable state surfaces through the muted class +
   `aria-description` (approved copy) + a wrapper click-guard that snacks the same
   copy. Checkpoint look preserved; aria trade-off documented in the template.
5. Export contract: the four existing exports return void + snack internally; card
   exports return `CardExportFailure | null` and the wrappers snack — importer
   computes, feature layer snacks (task 09 can adopt off `reason` without re-signing).
6. No success snackbar on card exports (matches the four fixed-format wrappers) —
   open question flagged; cheap to add if the user wants one.
7. `startProjectFromBook` carries the shell at project birth (one initial-commit
   write) rather than a second `adoptCardShell` save; later shell updates must go
   through `mutateProject`.

**Visual baseline**: `__screenshots__/15-character-card-round-trip/{before,after}/`
(pinned conditions: light theme, Fate-seeded project via welcome screen, settled
rendering, dev 4321; 1280×800 + 1024×768 + 390×844; capture script `p2-capture.mjs`).
After-set includes real-implementation menu shots, real CDK tooltip inside the
Popover top layer, and the real enabled state from importing `example_card.json`
end-to-end (project titled from card `data.name`; JSON row enabled, PNG row muted).
Orchestrator spot-verified the enabled-state and tooltip shots against the approved
checkpoint mock.

**Next:** dispatch P3 (ts-reviewer) — typing/lint sweep over everything touched.
Gate: `npm run lint` (+ `npm test` if it fixed anything).
