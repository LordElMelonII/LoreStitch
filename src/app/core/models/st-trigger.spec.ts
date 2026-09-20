import { ST_LOGIC, type CharacterBookEntry } from './lorebook.model';
import { evaluateStTrigger, type StTriggerVerdict } from './st-trigger';
import { entryWith } from '../../../testing/project-fixtures';

/** The panel-facts parameter of `evaluateStTrigger`. */
type Facts = Parameters<typeof evaluateStTrigger>[1];

/** Facts shorthand: the primary OR-result plus one boolean per secondary key. */
function facts(anyPrimaryMatched: boolean, ...secondaryMatched: boolean[]): Facts {
  return { anyPrimaryMatched, secondaryMatched };
}

/** Verdict for a key-satisfied entry under probability defaults. */
const INSERTED_ALWAYS: StTriggerVerdict = {
  outlook: 'inserted',
  reason: 'always',
  probability: null,
  vectorPath: false,
};

/** Verdict when the secondary-logic gate denies an otherwise-matching entry. */
const SECONDARY_DENIED: StTriggerVerdict = {
  outlook: 'blocked',
  reason: 'secondary-logic-denied',
  probability: null,
  vectorPath: false,
};

/** Verdict when the verdict is decided by vectors the keys cannot see. */
const VECTOR_ONLY: StTriggerVerdict = {
  outlook: 'inconclusive',
  reason: 'vector-similarity-only',
  probability: null,
  vectorPath: true,
};

/** Verdict for a rolled entry at `pct`. */
function rolledAt(pct: number, vectorPath = false): StTriggerVerdict {
  return { outlook: 'probabilistic', reason: 'probability-roll', probability: pct, vectorPath };
}

/**
 * A keyed, selective, enabled entry whose trigger-relevant extensions are
 * exactly `extensions` — probability/logic defaults live only where a case
 * writes them, so "absent" cases stay genuinely absent.
 */
function selectiveEntry(
  extensions: Record<string, unknown>,
  secondaryKeys: readonly string[],
): CharacterBookEntry {
  return entryWith(0, {
    keys: ['alpha'],
    selective: true,
    secondary_keys: [...secondaryKeys],
    extensions,
  });
}

describe('st-trigger', () => {
  describe('disabled entries are never activated (world-info.js:4689-4692)', () => {
    it('blocks despite matched primaries, a passing gate and probability defaults', () => {
      const entry = entryWith(0, {
        keys: ['alpha'],
        selective: true,
        secondary_keys: ['beta'],
        enabled: false,
        extensions: { selectiveLogic: ST_LOGIC.AND_ALL },
      });
      expect(evaluateStTrigger(entry, facts(true, true))).toEqual({
        outlook: 'blocked',
        reason: 'disabled',
        probability: null,
        vectorPath: false,
      });
    });

    it('still reports the vectorized marker on the blocked verdict', () => {
      const entry = entryWith(0, {
        keys: ['alpha'],
        enabled: false,
        extensions: { vectorized: true },
      });
      expect(evaluateStTrigger(entry, facts(true))).toEqual({
        outlook: 'blocked',
        reason: 'disabled',
        probability: null,
        vectorPath: true,
      });
    });

    it('ignores probability fields — the roll is never reached', () => {
      const entry = entryWith(0, {
        keys: ['alpha'],
        enabled: false,
        extensions: { probability: 50 },
      });
      expect(evaluateStTrigger(entry, facts(true))).toEqual({
        outlook: 'blocked',
        reason: 'disabled',
        probability: null,
        vectorPath: false,
      });
    });
  });

  describe('constant entries skip keys but face the same roll (world-info.js:4781, :4900-4930)', () => {
    it('with probability defaults → inserted/always', () => {
      const entry = entryWith(0, { keys: [], constant: true, extensions: {} });
      expect(evaluateStTrigger(entry, facts(false))).toEqual(INSERTED_ALWAYS);
    });

    it('with probability 50 → probabilistic at 50 (worldinfo.md:193: any activation route rolls)', () => {
      const entry = entryWith(0, { keys: [], constant: true, extensions: { probability: 50 } });
      expect(evaluateStTrigger(entry, facts(false))).toEqual(rolledAt(50));
    });

    it('key facts are irrelevant (unreachable from the panel, which hides constants — totality pin)', () => {
      const entry = entryWith(0, {
        keys: ['alpha'],
        selective: true,
        secondary_keys: ['beta'],
        constant: true,
        // Would deny activation were the key pipeline consulted.
        extensions: { selectiveLogic: ST_LOGIC.NOT_ANY },
      });
      expect(evaluateStTrigger(entry, facts(false, true))).toEqual(INSERTED_ALWAYS);
    });

    it('carries the vectorized marker alongside constancy (raw-marker reading)', () => {
      const entry = entryWith(0, { keys: [], constant: true, extensions: { vectorized: true } });
      expect(evaluateStTrigger(entry, facts(false))).toEqual({
        ...INSERTED_ALWAYS,
        vectorPath: true,
      });
    });
  });

  describe('keyless non-constant entries (world-info.js:4793-4796)', () => {
    it('are skipped → blocked/no-keys', () => {
      const entry = entryWith(0, { keys: [], extensions: {} });
      expect(evaluateStTrigger(entry, facts(false))).toEqual({
        outlook: 'blocked',
        reason: 'no-keys',
        probability: null,
        vectorPath: false,
      });
    });

    it('the keyless check wins over contradictory facts (evaluation-order pin)', () => {
      const entry = entryWith(0, { keys: [], extensions: {} });
      expect(evaluateStTrigger(entry, facts(true))).toEqual({
        outlook: 'blocked',
        reason: 'no-keys',
        probability: null,
        vectorPath: false,
      });
    });

    it('with the vectorized marker → inconclusive: removing the keys is how an entry is made vector-only (worldinfo.md:284, :293)', () => {
      const entry = entryWith(0, { keys: [], extensions: { vectorized: true } });
      expect(evaluateStTrigger(entry, facts(false))).toEqual(VECTOR_ONLY);
    });
  });

  describe('primary keys OR-match (world-info.js:4798-4810)', () => {
    it('no primary match → blocked/no-key-matched', () => {
      const entry = entryWith(0, { keys: ['alpha'], extensions: {} });
      expect(evaluateStTrigger(entry, facts(false))).toEqual({
        outlook: 'blocked',
        reason: 'no-key-matched',
        probability: null,
        vectorPath: false,
      });
    });

    it('no primary match + vectorized → inconclusive/vector-similarity-only', () => {
      const entry = entryWith(0, { keys: ['alpha'], extensions: { vectorized: true } });
      expect(evaluateStTrigger(entry, facts(false))).toEqual(VECTOR_ONLY);
    });

    it('a primary match on a vectorized entry takes the normal path — vectors are additional, not a bypass (worldinfo.md:293)', () => {
      const entry = entryWith(0, { keys: ['alpha'], extensions: { vectorized: true } });
      expect(evaluateStTrigger(entry, facts(true))).toEqual({
        ...INSERTED_ALWAYS,
        vectorPath: true,
      });
    });

    it('a vectorized entry with probability 50 rolls with the marker attached', () => {
      const entry = entryWith(0, {
        keys: ['alpha'],
        extensions: { vectorized: true, probability: 50 },
      });
      expect(evaluateStTrigger(entry, facts(true))).toEqual(rolledAt(50, true));
    });
  });

  describe('secondary-logic gate (world-info.js:4812-4876, enum :33-38)', () => {
    const GATE_CASES: readonly {
      logicLabel: string;
      logic: number;
      scenario: string;
      secondaryMatched: readonly boolean[];
      gatePasses: boolean;
    }[] = [
      {
        logicLabel: 'AND Any',
        logic: ST_LOGIC.AND_ANY,
        scenario: 'all secondaries matched',
        secondaryMatched: [true, true],
        gatePasses: true,
      },
      {
        logicLabel: 'AND Any',
        logic: ST_LOGIC.AND_ANY,
        scenario: 'mixed secondaries',
        secondaryMatched: [true, false],
        gatePasses: true,
      },
      {
        logicLabel: 'AND Any',
        logic: ST_LOGIC.AND_ANY,
        scenario: 'no secondary matched',
        secondaryMatched: [false, false],
        gatePasses: false,
      },
      {
        logicLabel: 'NOT All',
        logic: ST_LOGIC.NOT_ALL,
        scenario: 'all secondaries matched',
        secondaryMatched: [true, true],
        gatePasses: false,
      },
      {
        logicLabel: 'NOT All',
        logic: ST_LOGIC.NOT_ALL,
        scenario: 'mixed secondaries',
        secondaryMatched: [true, false],
        gatePasses: true,
      },
      {
        logicLabel: 'NOT All',
        logic: ST_LOGIC.NOT_ALL,
        scenario: 'no secondary matched',
        secondaryMatched: [false, false],
        gatePasses: true,
      },
      {
        logicLabel: 'NOT Any',
        logic: ST_LOGIC.NOT_ANY,
        scenario: 'all secondaries matched',
        secondaryMatched: [true, true],
        gatePasses: false,
      },
      {
        logicLabel: 'NOT Any',
        logic: ST_LOGIC.NOT_ANY,
        scenario: 'mixed secondaries',
        secondaryMatched: [true, false],
        gatePasses: false,
      },
      {
        logicLabel: 'NOT Any',
        logic: ST_LOGIC.NOT_ANY,
        scenario: 'no secondary matched',
        secondaryMatched: [false, false],
        gatePasses: true,
      },
      {
        logicLabel: 'AND All',
        logic: ST_LOGIC.AND_ALL,
        scenario: 'all secondaries matched',
        secondaryMatched: [true, true],
        gatePasses: true,
      },
      {
        logicLabel: 'AND All',
        logic: ST_LOGIC.AND_ALL,
        scenario: 'mixed secondaries',
        secondaryMatched: [true, false],
        gatePasses: false,
      },
      {
        logicLabel: 'AND All',
        logic: ST_LOGIC.AND_ALL,
        scenario: 'no secondary matched',
        secondaryMatched: [false, false],
        gatePasses: false,
      },
    ];

    for (const testCase of GATE_CASES) {
      it(`${testCase.logicLabel} + ${testCase.scenario} -> ${testCase.gatePasses ? 'inserted' : 'blocked'}`, () => {
        const entry = selectiveEntry({ selectiveLogic: testCase.logic }, ['beta', 'gamma']);
        const verdict = evaluateStTrigger(entry, facts(true, ...testCase.secondaryMatched));
        expect(verdict).toEqual(testCase.gatePasses ? INSERTED_ALWAYS : SECONDARY_DENIED);
      });
    }

    it('USER-REPORT REPRO (Task 08 §1): primary matched + secondary "Test" matched under NOT Any blocks activation', () => {
      // The reported screenshot showed a green "Matches Test · NOT Any" row
      // reading as success — under NOT Any a MATCHED secondary denies
      // activation. The verdict must say "not inserted"; this is the case
      // the whole task exists for.
      const entry = entryWith(0, {
        keys: ['sir ademar'],
        selective: true,
        secondary_keys: ['Test'],
        extensions: { selectiveLogic: ST_LOGIC.NOT_ANY },
      });
      expect(evaluateStTrigger(entry, facts(true, true))).toEqual(SECONDARY_DENIED);
    });
  });

  describe('gate preconditions (hasSecondaryKeywords, world-info.js:4812-4823)', () => {
    it('selective=false with secondaries present skips the gate', () => {
      const entry = entryWith(0, {
        keys: ['alpha'],
        selective: false,
        secondary_keys: ['beta'],
        // Would deny activation were the gate consulted.
        extensions: { selectiveLogic: ST_LOGIC.NOT_ANY },
      });
      expect(evaluateStTrigger(entry, facts(true, true))).toEqual(INSERTED_ALWAYS);
    });

    it('selective=true with no secondary-key facts skips the gate', () => {
      const entry = selectiveEntry({ selectiveLogic: ST_LOGIC.NOT_ANY }, []);
      expect(evaluateStTrigger(entry, facts(true))).toEqual(INSERTED_ALWAYS);
    });

    it('absent selectiveLogic defaults to AND_ANY (world-info.js:4827)', () => {
      // AND_ANY denies when nothing matched and passes when something did.
      const denied = selectiveEntry({}, ['beta']);
      expect(evaluateStTrigger(denied, facts(true, false))).toEqual(SECONDARY_DENIED);
      const passed = selectiveEntry({}, ['beta', 'gamma']);
      expect(evaluateStTrigger(passed, facts(true, false, true))).toEqual(INSERTED_ALWAYS);
    });

    it('out-of-enum and non-number logic values deny — the oracle fall-through (world-info.js:4865)', () => {
      const outOfEnum = selectiveEntry({ selectiveLogic: 7 }, ['beta']);
      expect(evaluateStTrigger(outOfEnum, facts(true, true))).toEqual(SECONDARY_DENIED);
      const nonNumber = selectiveEntry({ selectiveLogic: '2' }, ['beta']);
      expect(evaluateStTrigger(nonNumber, facts(true, false))).toEqual(SECONDARY_DENIED);
    });
  });

  describe('probability step (world-info.js:4909-4930; defaults :4025-4026)', () => {
    // Numeric garbage clamps at both ends; non-numbers take the default 100.
    // NaN is a typeof-'number' non-number: Math.min/max clamp it to NaN, so
    // it is pinned to the default too — the dedicated test below documents
    // the decision.
    const CASES: readonly [
      label: string,
      extensions: Record<string, unknown>,
      expected: StTriggerVerdict,
    ][] = [
      ['probability absent → no roll', {}, INSERTED_ALWAYS],
      ['probability 100 → no roll', { probability: 100 }, INSERTED_ALWAYS],
      ['probability 50 → roll at 50', { probability: 50 }, rolledAt(50)],
      [
        'probability 0 → roll at 0 (worldinfo.md:197: effectively disabled)',
        { probability: 0 },
        rolledAt(0),
      ],
      [
        'useProbability false → no roll even below 100',
        { probability: 50, useProbability: false },
        INSERTED_ALWAYS,
      ],
      ['useProbability false alone → no roll', { useProbability: false }, INSERTED_ALWAYS],
      ['negative garbage clamps to 0', { probability: -25 }, rolledAt(0)],
      ['above-100 garbage clamps to 100', { probability: 250 }, INSERTED_ALWAYS],
      ['Infinity clamps to 100', { probability: Number.POSITIVE_INFINITY }, INSERTED_ALWAYS],
      ['-Infinity clamps to 0', { probability: Number.NEGATIVE_INFINITY }, rolledAt(0)],
      ['string probability → the default 100', { probability: '50' }, INSERTED_ALWAYS],
      ['null probability → the default 100', { probability: null }, INSERTED_ALWAYS],
      [
        'NaN → the default 100 (see the decision pin below)',
        { probability: Number.NaN },
        INSERTED_ALWAYS,
      ],
    ];

    for (const [label, extensions, expected] of CASES) {
      it(label, () => {
        const entry = entryWith(0, { keys: ['alpha'], extensions });
        expect(evaluateStTrigger(entry, facts(true))).toEqual(expected);
      });
    }

    it('NaN decision pin: a typeof-number NaN is treated as absent, not clamped', () => {
      // `typeof NaN === 'number'`, so the raw-value guard alone would admit
      // it, and Math.min/Math.max clamp NaN to NaN — surfacing a garbage
      // percentage (and `NaN >= 100` is false, so it would read as a roll).
      // The oracle's literal behavior is worse to mirror: it rolls
      // `Math.random() * 100 <= NaN`, which is always false — the entry
      // would NEVER insert, which is not a percentage anyone configured on
      // purpose. The "non-numbers take the default" rule is the sanest total
      // behavior for garbage (Task 08 §3.1); pinned here so any future change
      // is a deliberate act.
      const entry = entryWith(0, { keys: ['alpha'], extensions: { probability: Number.NaN } });
      expect(evaluateStTrigger(entry, facts(true))).toEqual(INSERTED_ALWAYS);
    });
  });

  describe('purity', () => {
    it('never mutates the entry', () => {
      const entry = selectiveEntry(
        { selectiveLogic: ST_LOGIC.NOT_ANY, probability: 50, vectorized: true },
        ['beta', 'gamma'],
      );
      const before = structuredClone(entry);
      evaluateStTrigger(entry, facts(true, true, false));
      evaluateStTrigger(entry, facts(false));
      expect(entry).toEqual(before);
    });

    it('treats a missing extensions bag as empty (hardening for untrusted data)', () => {
      // The model types `extensions` as required, but the same defensive
      // `?? {}` the rest of the model layer applies (entryStPosition et al.)
      // keeps hand-edited or legacy payloads total.
      const entry = {
        ...entryWith(0, { keys: ['alpha'] }),
        extensions: undefined,
      } as unknown as CharacterBookEntry;
      expect(evaluateStTrigger(entry, facts(true))).toEqual(INSERTED_ALWAYS);
    });
  });
});
