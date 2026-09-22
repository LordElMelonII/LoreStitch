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

**Next:** dispatch P1 (core-engine) — PNG chunk codec + crc32, card-spec openers, `CardError` results,
`CardShell` in `project.model.ts`, archive base64 transform, dual-chunk rule, V3-delta verification
against `example_card.json`. Gate: `CI=true npm test -- --watch=false`.
