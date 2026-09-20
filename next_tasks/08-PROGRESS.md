# Task 08 — Progress Ledger

Plan: [08-test-keys-trigger-verdict.md](./08-test-keys-trigger-verdict.md)
Branch: `feature/08-test-keys-trigger-verdict` (off `develop` @ `ba67c85`)

## Phase 0 — Prep & re-ground (2026-09-20)

- Re-grounded the plan against `develop` @ `ba67c85`: verified the vendored
  ground truth `sillytaver-world-info-doc/world-info.js` citations by reading
  them — constant activation (~:4781), keyless skip (~:4791-4794), primary
  `.find` OR-match (~:4798-4805), the secondary gate (~:4812-4880:
  `entry.selective && keysecondary.length` precondition, `selectiveLogic ?? 0`,
  enum AND_ANY:0 / NOT_ALL:1 / NOT_ANY:2 / AND_ALL:3 at :33-38), the
  probability roll (~:4911-4923: `!useProbability || probability === 100` →
  no roll, else `Math.random()*100 <= probability`), the extensions mapping
  (~:2617) and defaults (~:5426). `worldinfo.md:191-197` (probability) and
  `:291-295` (vectorized = additional marker only) confirmed.
  `lorebook.model.ts:61-76` (CharacterBookEntry) and `:286-294`
  (ST_LOGIC_OPTIONS) confirmed. Panel references confirmed at
  `entry-editor/entry-keys/regex-test-panel.*` (`visible` :84-93, rows
  :117-155, hint html:43-47, insertion point html:50-52). **No drift.**
  One nuance recorded for P1: in the vendored scan, sticky timers fire before
  the keyless check and inclusion groups/budget sit between activation and
  the probability roll — both are out of scope per plan (hint copy carries
  the caveat); the verdict's order stays as §3.1 pins it.
- **Before screenshots** captured to `__screenshots__/08-test-keys-verdict/before/`
  (chromium; desktop 1280×800 + mobile 390×844; light theme; FATE fixture via
  the real import path; first entry; `excalibur` primary + `avalon` secondary
  added through the real chip inputs; Test keys open; SAMPLE filled):
  `01-not-any-matched-secondary` (the user-report repro — green "Matches" on
  the secondary under NOT Any) and `02-and-any-matched-secondary` (healthy
  contrast) per viewport. Capture script kept beside them.
- Gates run: none yet (docs-only phase).
- Decisions/deviations: none.

**Next:** P1 (core-engine) — §3.1 pure `st-trigger` verdict module + full
truth-table spec incl. the user-report repro pin. Gate: `npm test`.
