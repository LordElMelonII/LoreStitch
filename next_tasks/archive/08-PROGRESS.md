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

## Phase 2 — Panel (2026-09-21, ui-specialist)

- Commit: `0dbb5fa feat(test-keys): state the SillyTavern trigger verdict`
- What landed: pure `verdict` computed off the existing `rows` facts →
  `evaluateStTrigger`; `role="status"` banner above `.match-rows` with the
  approved mock copy (M3 container tokens per outlook, icon `@switch`);
  `(blocks activation)` error suffix on the offending matched-secondary row,
  verdict-driven so panel and verdict can never disagree; hint extended
  with the §3.2 override list (probability rolls, sticky/cooldown, inclusion
  groups, recursion, Vector Storage). 13 new spec tests (28 in file);
  `entry-keys/README.md` updated.
- **icons:refresh WAS needed** — `block`, `casino`, `blur_on` were missing
  ligatures; subset 60 → 63, regenerated font staged in the same commit.
- Gates: `CI=true npm test -- --watch=false` **green** (55 files / 1072
  tests; panel html 100/95.55/100/100, ts 97.53/91.8/100/97.22); `npm run
  build` **green**. (One intermediate 5s `whenStable` flake in an untouched
  spec under machine load; clean full re-run is the gate result.)
- **Deviations (accepted — all preserve honesty)**: (1) suffix narrowed to
  NOT_ALL/NOT_ANY denials — under AND_ALL a matched row is not what blocks
  (the missing key is), so suffixing it would be dishonest; still
  verdict-driven, pinned. (2) AND_ANY/AND_ALL denied headlines reworded to
  not name an empty set ("no 'AND Any' secondary key matches…"), keeping
  the "Would **not** be inserted —" frame. (3) Out-of-enum `selectiveLogic`
  gets a generic cause with no quoted label/suffix (mirrors the P1 oracle
  fall-through). (4) `OnPush` added to the panel.
- Non-approved-reason copy (orchestrator-approved, follows the approved
  sentence shape): no-key-matched → "no primary key matches this sample.";
  no-keys → "the entry has no primary keys, so the keyword scan skips it.";
  disabled → "the entry is disabled."

**Next:** P3 (ts-reviewer) — exhaustive-reason typing, signal purity, lint.

## Phase 3 — Review (2026-09-21, ts-reviewer)

- Commit: `b95d836 test(test-keys): guard the verdict reason switch
  exhaustively` (test-only): Angular 22's `@switch` does no compile-time
  exhaustiveness checking, so a future 8th `reason` member would have
  silently rendered an empty banner — added a typed
  `Record<StTriggerVerdict['reason'], {entry, sample}>` fixture loop
  asserting non-empty copy + icon per reason (verified the guard bites:
  removing a key is a compile error).
- Verified clean: st-trigger typing + oracle fidelity spot-check;
  verdict computeds pure; logicLabel/selectiveLogic split behavior-identical;
  suffix verdict-driven only; banner inert while collapsed; OnPush safe.
- Gates: `npm run lint` **clean**; units **1073/1073**.

**Next:** P4 (qa-auditor) — regex-sandbox e2e extensions + screenshots.

## Phase 4 — E2E & evidence (2026-09-21, qa-auditor)

- Commit: `7fee7c5 test(e2e): pin the trigger verdict in the sandbox`
- Existing `Matches` row pins and the whole-word flip leg survive untouched
  (the verdict legs run first and restore AND Any + probability 100).
- New e2e: the NOT-Any repro end-to-end (mat-select flip → `verdict-blocked`
  banner with the approved headline, `Matches (blocks activation)` suffix on
  avalon; AND Any flips back to inserted + suffix gone). **Probabilistic
  verdict pinned end-to-end too** — the plan's "no probability editor"
  premise was outdated: the Activation section has a real `Probability %`
  field writing `extensions.probability` through the workspace mutator
  (entry-activation.html:44); 50 → "Fires a probability roll … inserted 50%
  of the time.", 100 → inserted again. Mobile-chrome leg green (the
  mobile-safari describe skip kept).
- Playwright per project: desktop-chrome 55p/12s, mobile-chrome 32p/35s,
  mobile-safari 29p/37s + 1 unrelated WebKit timing flake (token meter;
  passed 5/5 on isolated re-run).
- Screenshots: after-set re-captured with the pinned script (one disclosed
  minimal fix: a `revealTestKeys` scroll — the banner lands below the
  options accordion's own scroll fold; pinned conditions untouched).
  Verified: state 01 shows the red blocked banner + suffix on both
  1280×800 and 390×844; state 02 the inserted banner + plain Matches row.
- Checklist: build clean; typecheck:e2e clean; coverage at baseline (panel
  ts 97.53/91.8/100/97.22, html 100/95.55/100/100, st-trigger 100;
  globals 95.83/89.46/90.75/97.27); lint clean.
- **Flake flagged for the user (pre-existing, not this diff)**:
  `entry-editor.spec.ts > renders the writing surface…` intermittently hits
  vitest's 5s `whenStable` limit under full-suite parallel load (3 of 7
  runs; isolated reruns always pass) — a `testTimeout` bump is the likely
  fix, left as a user decision.
- Deviations: none material (the capture-script scroll helper disclosed
  above).

## Task complete

All four phases green; awaiting user test + ff-merge go-ahead. Commit range
on `feature/08-test-keys-trigger-verdict` (rebased onto develop @ `0b7f9a4`):
`dd77670..7fee7c5`; code phases: P1 `1df3007`, P2 `0dbb5fa`, P3 `b95d836`,
P4 `7fee7c5`. Open items: the pre-existing entry-editor unit flake above.
