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

**Next:** checkpoint 15-1 — menu placement (rendered-mock evidence), final copy, §7.2
inline-vs-separate confirmation; hard stop until the user answers.
