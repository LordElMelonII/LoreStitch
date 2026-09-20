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

## Phase 1 — Verdict module (2026-09-20, core-engine)

- Commit: `233bd52 feat(core): evaluate the SillyTavern trigger verdict for an entry`
- Files: `core/models/st-trigger.ts` (bare, framework-free, total; the §3.1
  interface verbatim; evaluation order mirrors the vendored scan — module doc
  pins the snapshot as ground truth, §7.1), `core/models/st-trigger.spec.ts`
  (47 data-driven cases: 12 gate cases, probability table incl. clamps and
  ±Infinity, disabled, constant ± probability, keyless, vectorized paths,
  gate preconditions, out-of-enum logic fall-through, order pins, purity),
  `core/models/README.md` updated.
- **User-report repro pinned by name**: primary matched + secondary `Test`
  matched under NOT_ANY → `blocked/secondary-logic-denied`.
- NaN decision pinned: `extensions.probability = NaN` → treated as absent →
  default 100 → `inserted/always`. The oracle's literal roll
  (`Math.random()*100 <= NaN` = always false, entry silently never inserts)
  is not a percentage anyone configured on purpose; ±Infinity clamp normally.
- Gate: `CI=true npm test -- --watch=false` **green**; `st-trigger.ts`
  coverage 100/100/100/100.
- **Deviations from §3.1 (accepted by orchestrator, both documented in code
  and tests):**
  1. Keyless + vectorized → `inconclusive/vector-similarity-only` instead of
     the literal step-4 `blocked/no-keys` (step 5's UNLESS extended to step
     4). Ground truth: worldinfo.md :284 (keyless vector matching requires
     the Vectorized status) + :293 — a keyless vectorized entry is the
     canonical vector-only configuration; `blocked` there would be the exact
     honesty failure the user reported. Keyless without the marker stays
     `blocked/no-keys`.
  2. `vectorPath` reads the raw `extensions.vectorized === true` marker, not
     the `entryTriggerState` tri-state (they differ only for constant+
     vectorized, where the constant path decides the outlook anyway); keeps
     the field an honest "Vector Storage sees this entry" report.

**Next:** §5 step 2 — user design checkpoint (verdict copy + per-row
treatment mock). P2 dispatch is BLOCKED until the user answers.

## Checkpoint evidence posted (2026-09-20, orchestrator)

- Mocks rendered over the real app in the repro state
  (`__screenshots__/08-test-keys-verdict/`, script `mock-verdict.mjs`):
  `*-mock-blocked-verdict-suffix` (verdict row + "(blocks activation)"
  suffix), `*-mock-blocked-verdict-tone` (verdict row + error-tone recolor),
  desktop+mobile; desktop-only `mock-inserted-verdict` (AND Any contrast)
  and `mock-verdict-copy-all-outlooks` (all four outlook rows for copy
  review). Before-set probe pins the repro objectively: the `avalon`
  secondary row shows state "Matches" under the "NOT Any" chip with a
  neutral icon color — the dishonest green the user reported.
- Verdict copy proposed (P2 implements whatever the user approves):
  blocked → "Would **not** be inserted — the matched 'NOT Any' secondary
  keys block activation."; inserted → "Would be inserted into SillyTavern's
  context for this sample."; probabilistic → "Fires a probability roll in
  SillyTavern — inserted P% of the time."; inconclusive → "Keys stayed
  silent — Vector Storage may still insert this by similarity." (+ "Similarity
  is not testable here." sub-line).
- **GATE OPEN — awaiting the user's answer. No P2 dispatch.**

## Checkpoint answer (2026-09-20, orchestrator)

- **User answered Gate 08-1: treatment 1** — the verdict banner + the
  "(blocks activation)" error suffix on the offending matched-secondary row
  (treatment 2's tone recolor rejected). The copy shown in the mocks is
  approved as rendered (blocked/inserted/probabilistic/inconclusive lines in
  the 08 ledger's checkpoint entry above). P2 implements exactly that.
- **GATE CLOSED — P2 dispatched with the treatment-1 decision.**
