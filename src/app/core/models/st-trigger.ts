/**
 * SillyTavern entry-level trigger verdict — would SillyTavern insert this
 * entry into the context for the scanned text?
 *
 * Pure, framework-free evaluation of an entry's JOINT activation outcome,
 * mirroring the vendored scan loop
 * (sillytaver-world-info-doc/world-info.js): disabled check (:4689-4692),
 * constant activation (:4781-4785), keyless skip (:4793-4796), primary-key
 * OR-match (:4798-4810), secondary-logic gate (:4812-4876; enum :33-38;
 * nullish default :4827), probability roll (:4909-4930; template defaults
 * :4025-4026). The verdict consumes precomputed per-key facts — the Test
 * Keys panel's own match results — so the per-key rows and the entry-level
 * verdict can never disagree (Task 08 §3.1).
 *
 * Known limits — the verdict speaks for the keyword pipeline plus the
 * probability step only. Timed effects (sticky/cooldown/delay), the
 * generation-type trigger filter, inclusion groups, token budget and
 * recursion can each still change the live outcome, and Vector Storage
 * similarity is reported (`vectorPath`), never decided, here. The UI hint
 * carries those caveats; the verdict must not overclaim.
 *
 * The vendored snapshot is the pinned ground truth: a SillyTavern update
 * (new activation gates, changed defaults) requires a re-read of the vendored
 * file and a re-grounding of this module and its spec (Task 08 §7.1).
 */

import { ST_LOGIC, entryTriggerState, type CharacterBookEntry } from './lorebook.model';

/** The entry-level outcome bucket for the verdict row. */
export type StTriggerOutlook = 'inserted' | 'blocked' | 'probabilistic' | 'inconclusive';

export interface StTriggerVerdict {
  readonly outlook: StTriggerOutlook;
  /** Machine reason; UI copy maps it to a sentence. Exhaustive union. */
  readonly reason:
    | 'disabled'
    | 'no-keys'
    | 'no-key-matched'
    | 'secondary-logic-denied'
    | 'always'
    | 'probability-roll'
    | 'vector-similarity-only';
  /** Effective roll percentage when `reason === 'probability-roll'`. */
  readonly probability: number | null;
  /** True when Vector Storage adds an insertion path keys can't see. */
  readonly vectorPath: boolean;
}

/**
 * The secondary-logic gate (`matchSecondaryKeys`, world-info.js:4831-4866) as
 * a predicate over the caller's per-secondary-key facts:
 *
 * - `AND_ANY` (0) fires when any secondary matched;
 * - `NOT_ALL` (1) fires when some secondary did NOT match;
 * - `NOT_ANY` (2) fires when none matched;
 * - `AND_ALL` (3) fires when all matched.
 *
 * `rawLogic` takes the oracle's nullish default only — `?? 0` at
 * world-info.js:4827 — so `null`/`undefined` mean AND_ANY while any other
 * value (a string, an out-of-enum number) satisfies no branch and denies,
 * mirroring the oracle's fall-through `return false` (world-info.js:4865).
 */
function secondaryGatePasses(rawLogic: unknown, secondaryMatched: readonly boolean[]): boolean {
  const logic: unknown = rawLogic ?? ST_LOGIC.AND_ANY;
  if (logic === ST_LOGIC.AND_ANY) {
    return secondaryMatched.some((matched) => matched);
  }
  if (logic === ST_LOGIC.NOT_ALL) {
    return secondaryMatched.some((matched) => !matched);
  }
  if (logic === ST_LOGIC.NOT_ANY) {
    return secondaryMatched.every((matched) => !matched);
  }
  if (logic === ST_LOGIC.AND_ALL) {
    return secondaryMatched.every((matched) => matched);
  }
  return false;
}

/**
 * Effective roll percentage. A number clamps to [0, 100] — ST keeps
 * out-of-range values losslessly but rolls `rollValue <= probability`, so 250
 * never fails a roll and -25 never passes one, exactly like the clamped
 * percentages. Every other value — strings, `null`, and `NaN` (which
 * `typeof` still reports as `'number'` but no clamp can tame) — counts as
 * "no percentage" and takes ST's template default 100 (world-info.js:4025).
 * The NaN pin is deliberate: propagating NaN would surface a garbage
 * percentage, and the oracle's literal behavior (an always-failing
 * `Math.random() * 100 <= NaN` comparison) is not a percentage anyone
 * configured on purpose — the absent-default rule is the sanest total
 * behavior (Task 08 §3.1).
 */
function effectiveProbability(raw: unknown): number {
  if (typeof raw !== 'number' || Number.isNaN(raw)) {
    return 100;
  }
  return Math.min(100, Math.max(0, raw));
}

/**
 * The probability step (`verifyProbability`, world-info.js:4909-4930) minus
 * the roll itself: no roll when `useProbability` is not exactly `false`
 * (template default `true`, world-info.js:4026) or the effective percentage
 * reaches 100 — after clamping that is the oracle's `probability === 100`;
 * otherwise the entry is probabilistic at the effective percentage. Applies
 * to every activation route, constants included (worldinfo.md:193).
 */
function probabilityVerdict(ext: Record<string, unknown>, vectorPath: boolean): StTriggerVerdict {
  const useProbability = ext['useProbability'] !== false;
  const probability = effectiveProbability(ext['probability']);
  if (!useProbability || probability >= 100) {
    return { outlook: 'inserted', reason: 'always', probability: null, vectorPath };
  }
  return { outlook: 'probabilistic', reason: 'probability-roll', probability, vectorPath };
}

/**
 * Evaluates whether SillyTavern would insert `entry` into the context for
 * the text the caller matched against, consuming the caller's per-key facts:
 * `anyPrimaryMatched` — the primary keys OR-matched (world-info.js:4798-4810);
 * `secondaryMatched` — one boolean per secondary key, in the entry's
 * `secondary_keys` order. Pure and total: the entry and the facts are only
 * read, never mutated, and every extension shape yields a verdict.
 *
 * Order mirrors the vendored scan (Task 08 §3.1):
 *
 * 1. Disabled entries are skipped before anything else (world-info.js:4689)
 *    → `blocked/disabled` — keys, gate and probability are irrelevant.
 * 2. Constants skip the key pipeline but face the same probability roll
 *    (world-info.js:4781; rolled with every activation at :4900-4930) —
 *    unreachable from the Test Keys panel, which hides for constants; the
 *    module is total regardless.
 * 3. The vectorized marker (`extensions.vectorized === true`) rides along on
 *    EVERY verdict as `vectorPath` and never bypasses key evaluation —
 *    vectors are an additional insertion route, not a strategy switch
 *    (worldinfo.md:293). The raw marker is read rather than
 *    `entryTriggerState === 'vectorized'` because that helper collapses the
 *    strategy selector's tri-state (constant wins) while `vectorPath`
 *    reports whether Vector Storage sees the entry at all.
 * 4. Keyless non-constant entries are skipped by the keyword scan
 *    (world-info.js:4793) → `blocked/no-keys` — unless the vector marker is
 *    set: removing the keys is exactly how an entry is made vector-only
 *    (worldinfo.md:284, :293), so the honest outlook is
 *    `inconclusive/vector-similarity-only`.
 * 5. Silent primary keys → `blocked/no-key-matched`, or
 *    `inconclusive/vector-similarity-only` when vectorized.
 * 6. Selective entries with secondary facts pass the secondary-logic gate
 *    (world-info.js:4812-4876; the oracle's `hasSecondaryKeywords`
 *    precondition at :4812-4823) or are `blocked/secondary-logic-denied`.
 * 7. The probability step decides `inserted/always` vs
 *    `probabilistic/probability-roll`.
 */
export function evaluateStTrigger(
  entry: CharacterBookEntry,
  facts: { readonly anyPrimaryMatched: boolean; readonly secondaryMatched: readonly boolean[] },
): StTriggerVerdict {
  const ext = (entry.extensions ?? {}) as Record<string, unknown>;
  const vectorPath = ext['vectorized'] === true;

  if (!entry.enabled) {
    return { outlook: 'blocked', reason: 'disabled', probability: null, vectorPath };
  }

  if (entryTriggerState(entry) === 'constant') {
    return probabilityVerdict(ext, vectorPath);
  }

  if (entry.keys.length === 0) {
    return vectorPath
      ? { outlook: 'inconclusive', reason: 'vector-similarity-only', probability: null, vectorPath }
      : { outlook: 'blocked', reason: 'no-keys', probability: null, vectorPath };
  }

  if (!facts.anyPrimaryMatched) {
    return vectorPath
      ? { outlook: 'inconclusive', reason: 'vector-similarity-only', probability: null, vectorPath }
      : { outlook: 'blocked', reason: 'no-key-matched', probability: null, vectorPath };
  }

  if (
    entry.selective === true &&
    facts.secondaryMatched.length > 0 &&
    !secondaryGatePasses(ext['selectiveLogic'], facts.secondaryMatched)
  ) {
    return { outlook: 'blocked', reason: 'secondary-logic-denied', probability: null, vectorPath };
  }

  return probabilityVerdict(ext, vectorPath);
}
