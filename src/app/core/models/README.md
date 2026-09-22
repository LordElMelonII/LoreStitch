# core/models/

Pure, framework-free domain logic (Tier-1 specs, no Angular imports):

- `lorebook.model.ts` — the SillyTavern vendor contract: canonical V2 `CharacterBook` schema, native world-info shape, and the lossless converters/guards between them (unknown vendor keys preserved). The LoreStitch app-domain model used to live here too; it moved to `project.model.ts` and is re-exported from here for pre-split import paths.
- `project.model.ts` — LoreStitch project/VCS model: `ProjectWorkspace`, `ProjectCommit`, `LintPrefs` (+ archive sanitizing) and the `.stproj` guards. Nothing vendor-shaped lives here.
- `delimiters.ts` — wrap/strip/re-wrap content delimiters (`<tag>`, `[name=…]`, `---`) incl. malformed-wrapper detection and repair.
- `st-regex.ts`, `st-key-match.ts` — pure ports of SillyTavern's `parseRegexFromString` and key-matching semantics.
- `st-trigger.ts` — entry-level trigger verdict (would SillyTavern insert this entry?): disabled → constant → keys → secondary-logic gate → probability roll over precomputed per-key facts (Task 08 §3.1).
- `build-info.ts` / `build-info.prod.ts` — version metadata; the prod variant is swapped in by `fileReplacements` and generated at build time.

**Hints**

- `st-regex`/`st-key-match`/`st-trigger` cite `sillytaver-world-info-doc/world-info.js` by line number — re-check those citations if the vendored file is ever updated.
- `build-info.prod.ts` is gitignored; `npm run build` regenerates it (`scripts/generate-build-info.mjs`).
- The `lorebook.model` ⇄ `project.model` re-export cycle is safe: every cross-module reference is a hoisted function declaration, so neither evaluation order observes an uninitialized binding.
