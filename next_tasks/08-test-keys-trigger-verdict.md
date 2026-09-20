# Task 08 — Test Keys: SillyTavern Trigger Verdict

> **Source**: User bug report 2026-09-20 — *"Test Key should be clearer about if the
> entry is gonna get triggered or not in SillyTavern. In this case, it seems like it's
> gonna get inserted in the context in SillyTavern, but actually not."* Screenshot: the
> Task 04 "Test keys" panel showing a green **Matches Test `NOT Any`** row — a
> secondary key match that under `NOT Any` logic actually **prevents** activation.
> **Type**: UX honesty fix in the Task 04 sandbox (per-key facts are correct; the
> panel never states the joint, entry-level outcome)
> **Suggested agents**: `core-engine` (lead: pure verdict module) → `ui-specialist`
> (panel) → `ts-reviewer` → `qa-auditor`
> **Status**: 🟢 Planned — no implementation started (grounded against `develop` @ `2468de3`)

---

## 1. Objective

The "Test keys" panel answers the author's real question — **"would SillyTavern
insert this entry into the context for this sample text?"** — with an explicit
entry-level verdict row, evaluated exactly like SillyTavern's scan
(`sillytaver-world-info-doc/world-info.js`, vendored ground truth): disabled →
constant → primary keys → secondary logic → probability roll, with the known
limits (chat history, scan depth, recursion, Vector Storage) stated, not hidden.
A matched secondary key under `NOT Any`/`NOT All` must never read as success.

## 2. Gap analysis (panel vs. SillyTavern, `develop` @ `2468de3`)

The panel (`regex-test-panel.ts`) already resolves SillyTavern's matching options
(`:100-107`), the secondary logic label (`:110-114`), and per-key match facts
(`:117-155`) — but stops there. Per the vendored `world-info.js` scan loop, an
activated entry requires **all** of:

| # | SillyTavern check (ground truth) | Panel today |
|---|---|---|
| 1 | Disabled entries are never activated | **not stated** (a disabled entry can show all-green rows) |
| 2 | `constant` → always activated (`world-info.js:4781`) | n/a — the panel hides for constant entries (`visible`, `:84-93`) |
| 3 | Keyless non-constant entries are skipped (`:4791-4794`) | rows simply don't exist; no verdict |
| 4 | Primary keys OR-match (`:4798-4805`) | per-row facts only |
| 5 | Secondary logic gate (`:4823-4880`): `AND_ANY`(0, default) fires iff any secondary matches; `NOT_ALL`(1) iff some secondary does **not** match; `NOT_ANY`(2) iff none match; `AND_ALL`(3) iff all match; gate applies only when `selective === true` **and** secondaries exist | per-row facts only — a matched secondary under `NOT_*` shows a **green** "Matches" row (the user's report) |
| 6 | Probability roll (`:4911-4923`): no roll when `!useProbability` or `probability === 100`; otherwise `Math.random()*100 <= probability`; stored losslessly as `extensions.probability` / `extensions.useProbability` (`:2617`, `:5426`, defaults true/100) | **not stated** (probability < 100 books read as guaranteed) |
| 7 | Timed effects (sticky/cooldown/delay), inclusion groups, token budget, recursion (`:4740-4762`, `:4930+`) | correctly disclaimed in the hint (`regex-test-panel.html:43-47`), but the hint doesn't say **which** outcome they can override |

Docs corroboration: `worldinfo.md:191-197` (Probability — 100 = every activation,
0 = effectively disabled) and `:293` (**"Vectorized … is only an additional
marker. The entry would still behave like a normal … record that will be
activated by keywords if they are set"** — so vectorized entries are key-evaluated
normally; vectors are an *additional* insertion route).

`extensions` round-trips untouched (never-dropped vendor keys), so
`probability`/`useProbability` values from SillyTavern imports are already in the
model — `CharacterBookEntry` (`lorebook.model.ts:61-76`) has no top-level
probability field; read them from `extensions` with the ST defaults.

## 3. Design

### 3.1 Pure verdict module — `core/models/st-trigger.ts`

Bare, framework-free, total (house shape: `st-key-match.ts`/`st-regex.ts`).
The panel already computed per-key facts; the verdict consumes them so panel and
verdict can never disagree:

```ts
export type StTriggerOutlook = 'inserted' | 'blocked' | 'probabilistic' | 'inconclusive';

export interface StTriggerVerdict {
  readonly outlook: StTriggerOutlook;
  /** Machine reason; UI copy maps it to a sentence. Exhaustive union. */
  readonly reason:
    | 'disabled' | 'no-keys' | 'no-key-matched' | 'secondary-logic-denied'
    | 'always' | 'probability-roll' | 'vector-similarity-only';
  /** Effective roll percentage when `reason === 'probability-roll'`. */
  readonly probability: number | null;
  /** True when Vector Storage adds an insertion path keys can't see. */
  readonly vectorPath: boolean;
}

export function evaluateStTrigger(
  entry: CharacterBookEntry,
  facts: { readonly anyPrimaryMatched: boolean; readonly secondaryMatched: readonly boolean[] },
): StTriggerVerdict;
```

Evaluation order mirrors `world-info.js` §2 exactly:

1. `!entry.enabled` → `blocked/disabled`.
2. `entryTriggerState(entry) === 'constant'` → `always`/`probability-roll`
   (constants pass the same probability roll; unreachable from the panel — it
   hides for constants — but the module is total and unit-tested).
3. Vectorized marker (`extensions.vectorized === true`, i.e. `entryTriggerState
   === 'vectorized'`) sets `vectorPath: true`; **does not** bypass key evaluation
   (doc `:293`).
4. No primary keys → `blocked/no-keys`.
5. `!anyPrimaryMatched` →
   `blocked/no-key-matched`, unless `vectorPath` — then `inconclusive/
   vector-similarity-only` (keys stayed silent; vectors decide in live chat).
6. `entry.selective === true && secondaryMatched.length > 0` → logic gate on the
   boolean array with `extensions['selectiveLogic']` (number, default `0`;
   reuse `ST_LOGIC_OPTIONS` values `lorebook.model.ts:286-294`): `AND_ANY` any,
   `NOT_ALL` not-all, `NOT_ANY` none, `AND_ALL` all → else `blocked/
   secondary-logic-denied`.
7. Probability: `useProbability = ext['useProbability'] !== false`
   (default true), `probability = typeof ext['probability'] === 'number' ?
   clamp(ext['probability'], 0, 100) : 100` (numeric garbage clamps — matches ST's
   effective behavior at both ends; non-numbers take the default).
   `!useProbability || probability >= 100` → `inserted/always`; else `probabilistic/
   probability-roll` with the pct. Out-of-scope (hint copy, not verdict):
   sticky/cooldown timers, inclusion groups, token budget, recursion.

Full truth-table unit spec (4 logics × matched/mixed/unmatched secondaries ×
probability on/off/50 × disabled × vectorized × keyless), including the
user-report repro: primary matched + secondary `Test` matched under `NOT_ANY` →
`blocked/secondary-logic-denied`.

### 3.2 Panel integration (`regex-test-panel.*`)

- **Verdict row** pinned above the `.match-rows` list (`regex-test-panel.html:50-52`
  insertion point): icon + one headline sentence + optional sub-line —
  e.g. `inserted` → "Would be inserted into SillyTavern's context";
  `blocked/secondary-logic-denied` → "Would **not** be inserted — the matched
  `NOT Any` secondary keys block activation"; `probabilistic` → "Fires a roll in
  SillyTavern — inserted P% of the time"; `inconclusive` → "Keys stayed silent —
  Vector Storage may still insert this by similarity (not testable here)".
  Final copy at the design checkpoint (`material-3` + `frontend-design`; active
  voice, states that say what happened — house copy rules).
- **Per-row honesty** (the report's core complaint): when a matched secondary row
  sits under `NOT_ALL`/`NOT_ANY`, its state line must not read as success — e.g.
  suffix "(blocks activation)" or a muted/error tone; exact treatment decided at
  the checkpoint against a rendered mock (Design Checkpoint Evidence rule —
  Task 03's post-acceptance fixes all traced to prose-only specs).
- **Hint** (`regex-test-panel.html:43-47`) gains the override list: probability
  rolls, sticky/cooldown timers, inclusion-group budget, recursion, and Vector
  Storage for vectorized entries can each change the live outcome.
- The read-only highlighted preview, per-key rows, and `findStKeyMatches` calls
  stay byte-identical; `rows` feeds `facts` (`anyPrimaryMatched = primary rows
  any kind === 'matched'`, `secondaryMatched = secondary rows matched map`).

### 3.6 Test matrix

| Tier | Required cases |
|------|----------------|
| Unit — `st-trigger.spec.ts` | §3.1 truth table incl. the user-report repro; defaults (`selectiveLogic` absent → AND_ANY; `probability` absent → no roll; `useProbability: false` → no roll); `probability` clamps to [0,100] on garbage; vectorized paths |
| Unit — `regex-test-panel.spec.ts` | verdict row renders per outlook; sample-text edits flip the verdict; matched-secondary-under-NOT treatment per checkpoint; hint lists the overrides; per-key rows unchanged |
| E2E — `regex-sandbox.spec.ts` (extend) | existing `Matches` row pins (`:163-167`) survive; add: the NOT-Any repro (secondary matched + NOT Any → blocked verdict shown) and a probability roll verdict; one mobile-viewport pass over the panel |

**Visual gate**: the panel reshapes → before/after screenshots under
`__screenshots__/08-test-keys-verdict/{before,after}/` (pinned conditions per the
baseline protocol) posted with the phase report; design checkpoint (copy + mock)
closes **before** P2 dispatch.

## 4. Implementation Plan

| Phase | Files | Work |
|-------|-------|------|
| **P1 — Verdict module** (core-engine) | `core/models/st-trigger.ts` (+spec), `core/models/README.md` | §3.1; no changes to `st-key-match`/`st-regex` |
| **P2 — Panel** (ui-specialist) | `regex-test-panel.ts/.html/.scss` (+spec) | §3.2 after the design checkpoint |
| **P3 — Review** (ts-reviewer) | all touched | exhaustive-reason typing, signal purity, lint |
| **P4 — E2E & evidence** (qa-auditor) | `e2e/regex-sandbox.spec.ts` | §3.6 + screenshots |

Commits: `feat(test-keys): state the SillyTavern trigger verdict` (+ `feat(core)`
P1 if it lands separately), `test(e2e): …`, `docs(next_tasks): …`.

## 5. Orchestration

1. **`core-engine`** — P1 (skills: `typescript-advanced-types`). *Gate: `npm test`.*
2. **User design checkpoint** — verdict copy + per-row treatment mock. Gate stays
   open until answered (an unanswered gate stops the task, per house rules).
3. **`ui-specialist`** — P2 (skills: `material-3`, `frontend-design`). *Gate:
   `npm test` + `npm run build`.*
4. **`ts-reviewer`** — P3. *Gate: `npm run lint`.*
5. **`qa-auditor`** — P4 (skills: `playwright-cli`). *Gate: `npx playwright test
   regex-sandbox` green on desktop + mobile.*

## 6. Verification Gates

`npm run build` · `npm test` · `ng test --coverage` (`st-trigger` + panel covered) ·
`npx playwright test regex-sandbox` · `npm run lint` · screenshot comparison in the
phase report.

## 7. Risks & Open Questions

1. **Vendored-truth drift**: the verdict pins the behavior of the vendored
   `world-info.js` snapshot; SillyTavern updates (new timed effects etc.) will
   need a re-read of that file — the module doc comment says so explicitly.
2. **Panel hides for constant entries** (Task 04 mount gating): constants get no
   verdict row. If the user wants an "always inserted" banner there too, that is a
   `visible`-gating change (would show a panel with zero key rows) — deferred
   unless asked.
3. **`delayUntilRecursion`/sticky nuance**: keys can match while the live entry
   still doesn't fire (timers). The verdict says "would be inserted/rolled" from
   the key pipeline only; the hint carries the caveat. Copy must not overclaim —
   checkpoint reviews exact wording.
4. **Probability display**: LoreStitch exposes no probability editor today; the
   verdict still honors imported values. If `probability < 100` surprises users
   who can't see the field, a follow-up could surface it in the options accordion
   — out of scope here.
