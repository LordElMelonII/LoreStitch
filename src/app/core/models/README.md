# core/models/

Pure, framework-free domain logic (Tier-1 specs, no Angular imports):

- `lorebook.model.ts` — the SillyTavern vendor contract: canonical V2 `CharacterBook` schema, native world-info shape, and the lossless converters/guards between them (unknown vendor keys preserved). Purely the vendor contract: the LoreStitch app-domain model that used to live here moved to `project.model.ts` (every import site follows the split).
- `project.model.ts` — LoreStitch project/VCS model: `ProjectWorkspace`, `ProjectCommit`, `LintPrefs` (+ archive sanitizing), the card shell (`CardShell`, plan 15 §3.2) and the `.stproj` guards/transforms. Nothing vendor-shaped lives here.
- `character-card.ts` — the character-card boundary: PNG codec (`tEXt`/`iTXt`/`zTXt` walk, `crc32`, base64/UTF-8 payload handling) plus card-JSON open/swap (`openCardPng`/`openCardJson`/`embedCardPayloads`/`embedBookIntoCardJson`). Total functions — the import path never throws, every failure is a `CardError` result. Vendor card/book objects are never normalized to fit; the embed side swaps only `data.character_book` via `toSpecCompliantBook`.
- `delimiters.ts` — wrap/strip/re-wrap content delimiters (`<tag>`, `[name=…]`, `---`) incl. malformed-wrapper detection and repair.
- `st-regex.ts`, `st-key-match.ts` — pure ports of SillyTavern's `parseRegexFromString` and key-matching semantics.
- `st-trigger.ts` — entry-level trigger verdict (would SillyTavern insert this entry?): disabled → constant → keys → secondary-logic gate → probability roll over precomputed per-key facts (Task 08 §3.1).
- `book-schema.ts` — the export-contract pre-flight validator (Task 09 §3.1): `validateBook` flags exactly the malformed structures the exporters and SillyTavern's own parsing index (non-finite/duplicate ids, wrong-typed `content`/`keys`/`secondary_keys`, non-finite `insertion_order`/`priority`, non-object `extensions`) and nothing else — `position` is deliberately not a rule and unknown vendor keys are never inspected beyond the plain-object check. Total, read-only, never throws; a clean book exports byte-identically.
- `book-repair.ts` — the guided repair planner (Task 09 §3.2): `planBookRepair` turns the validator's fixable defects (id coercion/renumber, insertion-order default, priority unset) into a dialog-ready change list over a `structuredClone`d book — exactly one flagged field per change, every untouched and vendor key rides along verbatim. Unfixable kinds hard-block with `null`; idempotent with the validator.
- `build-info.ts` / `build-info.prod.ts` — version metadata; the prod variant is swapped in by `fileReplacements` and generated at build time.

**Hints**

- `st-regex`/`st-key-match`/`st-trigger` cite `sillytaver-world-info-doc/world-info.js` by line number — re-check those citations if the vendored file is ever updated. The same applies to `book-schema`/`book-repair`: their rule set and repair policies are indexed against the vendored snapshot (the uid-keyed bag and the V2→native conversion), so a SillyTavern update requires re-reading it (per their module doc comments).
- `build-info.prod.ts` is gitignored; `npm run build` regenerates it (`scripts/generate-build-info.mjs`).
- `project.model.ts` imports helpers from `lorebook.model.ts` one-directionally (the reverse re-export shim that once closed a module cycle was removed when import sites migrated to the split).
