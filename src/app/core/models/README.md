# core/models/

Pure, framework-free domain logic (Tier-1 specs, no Angular imports):

- `lorebook.model.ts` — the SillyTavern vendor contract: canonical V2 `CharacterBook` schema, native world-info shape, and the lossless converters/guards between them (unknown vendor keys preserved). Purely the vendor contract: the LoreStitch app-domain model that used to live here moved to `project.model.ts` (every import site follows the split).
- `project.model.ts` — LoreStitch project/VCS model: `ProjectWorkspace`, `ProjectCommit`, `LintPrefs` (+ archive sanitizing), the card shell (`CardShell`, plan 15 §3.2) and the `.stproj` guards/transforms. Nothing vendor-shaped lives here.
- `character-card.ts` — the character-card boundary: PNG codec (`tEXt`/`iTXt`/`zTXt` walk, `crc32`, base64/UTF-8 payload handling) plus card-JSON open/swap (`openCardPng`/`openCardJson`/`embedCardPayloads`/`embedBookIntoCardJson`). Total functions — the import path never throws, every failure is a `CardError` result. Vendor card/book objects are never normalized to fit; the embed side swaps only `data.character_book` via `toSpecCompliantBook`.
- `delimiters.ts` — wrap/strip/re-wrap content delimiters (`<tag>`, `[name=…]`, `---`) incl. malformed-wrapper detection and repair.
- `st-regex.ts`, `st-key-match.ts` — pure ports of SillyTavern's `parseRegexFromString` and key-matching semantics.
- `st-trigger.ts` — entry-level trigger verdict (would SillyTavern insert this entry?): disabled → constant → keys → secondary-logic gate → probability roll over precomputed per-key facts (Task 08 §3.1).
- `build-info.ts` / `build-info.prod.ts` — version metadata; the prod variant is swapped in by `fileReplacements` and generated at build time.

**Hints**

- `st-regex`/`st-key-match`/`st-trigger` cite `sillytaver-world-info-doc/world-info.js` by line number — re-check those citations if the vendored file is ever updated.
- `build-info.prod.ts` is gitignored; `npm run build` regenerates it (`scripts/generate-build-info.mjs`).
- `project.model.ts` imports helpers from `lorebook.model.ts` one-directionally (the reverse re-export shim that once closed a module cycle was removed when import sites migrated to the split).
