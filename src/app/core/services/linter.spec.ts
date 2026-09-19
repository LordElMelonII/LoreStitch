import {
  LARGE_BOOK_THRESHOLD,
  lintBook,
  lintDiagnosticSignature,
  type LintDiagnostic,
  type LintOptions,
  type LintRuleId,
} from './linter';
import type { CharacterBook, CharacterBookEntry } from '../models/lorebook.model';

// ============================================================================
// Fixtures
// ============================================================================

/** A minimal valid entry; every test overrides only what it exercises. */
function makeEntry(id: number, overrides: Partial<CharacterBookEntry> = {}): CharacterBookEntry {
  return {
    id,
    keys: [],
    content: '',
    enabled: true,
    insertion_order: 100,
    extensions: {},
    ...overrides,
  };
}

function makeBook(entries: CharacterBookEntry[]): CharacterBook {
  return { name: 'Lint fixture', description: '', extensions: {}, entries };
}

function ruleOf(diagnostics: readonly LintDiagnostic[], rule: LintRuleId): LintDiagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.rule === rule);
}

/** Asserts exactly one diagnostic of `rule` exists and returns it. */
function singleOf(diagnostics: readonly LintDiagnostic[], rule: LintRuleId): LintDiagnostic {
  const matching = ruleOf(diagnostics, rule);
  expect(matching).toHaveLength(1);
  const first = matching[0];
  // Unreachable after the length assertion; satisfies noUncheckedIndexedAccess.
  if (first === undefined) {
    throw new Error(`expected exactly one '${rule}' diagnostic`);
  }
  return first;
}

/** Recursively freezes a fixture so any mutation attempt surfaces in strict mode. */
function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item);
    }
    Object.freeze(value);
    return value;
  }
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * A book of `total` entries whose only live structure is an Alpha → Beta →
 * Alpha recursion cycle. Filler entries are disabled so the O(V²) pair loop
 * rejects them at the gate checks — the fixture measures the threshold
 * behavior, not the matcher's throughput.
 */
function makeLargeBook(total: number): CharacterBook {
  const cycle = [
    makeEntry(1, { comment: 'Alpha', keys: ['alpha'], content: 'the beta rises' }),
    makeEntry(2, { comment: 'Beta', keys: ['beta'], content: 'the alpha falls' }),
  ];
  const filler = Array.from({ length: total - 2 }, (_, i) =>
    makeEntry(1000 + i, { keys: [`filler ${i}`], content: '', enabled: false }),
  );
  return makeBook([...cycle, ...filler]);
}

// ============================================================================
// Suite
// ============================================================================

describe('linter', () => {
  describe('rule: invalid-regex', () => {
    it('flags a primary key that is regex-shaped but does not compile', () => {
      const diagnostics = lintBook(makeBook([makeEntry(1, { keys: ['/unbalanced[/i'] })]));
      const invalid = singleOf(diagnostics, 'invalid-regex');
      expect(invalid.severity).toBe('error');
      expect(invalid.entryIds).toEqual([1]);
      expect(invalid.details).toBe('/unbalanced[/i');
    });

    it('flags an invalid regex on a secondary key too', () => {
      const diagnostics = lintBook(
        makeBook([makeEntry(2, { keys: ['plain'], secondary_keys: ['/oops[/g'] })]),
      );
      const invalid = singleOf(diagnostics, 'invalid-regex');
      expect(invalid.details).toBe('/oops[/g');
    });

    it('does not flag valid regex keys or plain keys', () => {
      const diagnostics = lintBook(
        makeBook([
          makeEntry(3, {
            keys: ['/rose/i', 'plain key'],
            secondary_keys: ['/x/y'],
            selective: true,
          }),
        ]),
      );
      expect(diagnostics).toHaveLength(0);
    });

    it('has no suppressions — disabled entries are diagnosed too', () => {
      const diagnostics = lintBook(makeBook([makeEntry(4, { keys: ['/bad[/i'], enabled: false })]));
      expect(ruleOf(diagnostics, 'invalid-regex')).toHaveLength(1);
    });
  });

  describe('rule: malformed-wrapper', () => {
    it('reports a mismatched pair as an error with the wrapper label', () => {
      const diagnostics = lintBook(
        makeBook([makeEntry(5, { keys: ['k'], content: '<test>\nlore\n</universe>' })]),
      );
      const malformed = singleOf(diagnostics, 'malformed-wrapper');
      expect(malformed.severity).toBe('error');
      expect(malformed.entryIds).toEqual([5]);
      expect(malformed.details).toBe('<test> ? </universe>');
    });

    it('reports a hint-matched orphan opener as a warning', () => {
      const diagnostics = lintBook(
        makeBook([makeEntry(6, { comment: 'London', keys: ['k'], content: '<London>\nlore' })]),
      );
      const malformed = singleOf(diagnostics, 'malformed-wrapper');
      expect(malformed.severity).toBe('warning');
      expect(malformed.details).toBe('<London> ?');
    });

    it('reports a hint-matched orphan closer as a warning', () => {
      const diagnostics = lintBook(
        makeBook([makeEntry(7, { comment: 'London', keys: ['k'], content: 'lore\n</London>' })]),
      );
      const malformed = singleOf(diagnostics, 'malformed-wrapper');
      expect(malformed.severity).toBe('warning');
      expect(malformed.details).toBe('? </London>');
    });

    it('reports an unclosed bracket through the same hint chain', () => {
      const diagnostics = lintBook(
        makeBook([makeEntry(8, { comment: 'London', keys: ['k'], content: '[London=\nlore' })]),
      );
      expect(singleOf(diagnostics, 'malformed-wrapper').details).toBe('<London> ?');
    });

    it('never reports a well-formed wrapper', () => {
      const diagnostics = lintBook(
        makeBook([
          makeEntry(9, { comment: 'London', keys: ['k'], content: '<London>\nlore\n</London>' }),
        ]),
      );
      expect(diagnostics).toHaveLength(0);
    });

    it('leaves orphans hint-gated: an unmatched lone tag stays payload', () => {
      const diagnostics = lintBook(
        makeBook([makeEntry(10, { comment: 'Paris', keys: ['k'], content: '<London>\nlore' })]),
      );
      expect(diagnostics).toHaveLength(0);
    });

    it('reports disabled entries too — the defect ships in exported bytes', () => {
      const diagnostics = lintBook(
        makeBook([
          makeEntry(11, { keys: ['k'], content: '<test>\nlore\n</universe>', enabled: false }),
        ]),
      );
      expect(singleOf(diagnostics, 'malformed-wrapper').severity).toBe('error');
    });
  });

  describe('rule: duplicate-key', () => {
    it('reports one diagnostic per duplicate group listing all members', () => {
      const diagnostics = lintBook(
        makeBook([makeEntry(1, { keys: ['rose'] }), makeEntry(2, { keys: ['rose'] })]),
      );
      const duplicate = singleOf(diagnostics, 'duplicate-key');
      expect(duplicate.severity).toBe('warning');
      expect(duplicate.entryIds).toEqual([1, 2]);
      expect(duplicate.details).toBe('rose');
      expect(duplicate.message).toContain("share the primary key 'rose'");
    });

    it('only enabled entries participate', () => {
      const diagnostics = lintBook(
        makeBook([
          makeEntry(1, { keys: ['rose'] }),
          makeEntry(2, { keys: ['rose'], enabled: false }),
          makeEntry(3, { keys: ['rose'] }),
        ]),
      );
      expect(singleOf(diagnostics, 'duplicate-key').entryIds).toEqual([1, 3]);
    });

    it('compares case-insensitively when neither entry sets case_sensitive', () => {
      const diagnostics = lintBook(
        makeBook([makeEntry(1, { keys: ['Rose'] }), makeEntry(2, { keys: ['rose'] })]),
      );
      const duplicate = singleOf(diagnostics, 'duplicate-key');
      expect(duplicate.severity).toBe('warning');
      // details carries the key as first written in book order.
      expect(duplicate.details).toBe('Rose');
    });

    it('compares exact-case when both entries set case_sensitive: true', () => {
      const diagnostics = lintBook(
        makeBook([
          makeEntry(1, { keys: ['Rose'], case_sensitive: true }),
          makeEntry(2, { keys: ['rose'], case_sensitive: true }),
        ]),
      );
      expect(ruleOf(diagnostics, 'duplicate-key')).toHaveLength(0);
    });

    it('still flags identical spelling when both entries are case-sensitive', () => {
      const diagnostics = lintBook(
        makeBook([
          makeEntry(1, { keys: ['rose'], case_sensitive: true }),
          makeEntry(2, { keys: ['rose'], case_sensitive: true }),
        ]),
      );
      expect(singleOf(diagnostics, 'duplicate-key').severity).toBe('warning');
    });

    it('compares a mixed case_sensitive pair case-insensitively (documented choice)', () => {
      // The non-case-sensitive entry collides under ST's fallback to the
      // global default (caseSensitive false), so the pair compares CI. Mirrors
      // lintDuplicateKeys' doc comment in linter.ts.
      const diagnostics = lintBook(
        makeBook([
          makeEntry(1, { keys: ['Rose'], case_sensitive: true }),
          makeEntry(2, { keys: ['rose'] }),
        ]),
      );
      const duplicate = singleOf(diagnostics, 'duplicate-key');
      expect(duplicate.severity).toBe('warning');
      expect(duplicate.entryIds).toEqual([1, 2]);
    });

    it('treats an explicit case_sensitive: false like the unset default', () => {
      const diagnostics = lintBook(
        makeBook([
          makeEntry(1, { keys: ['Rose'], case_sensitive: false }),
          makeEntry(2, { keys: ['rose'], case_sensitive: false }),
        ]),
      );
      expect(ruleOf(diagnostics, 'duplicate-key')).toHaveLength(1);
    });

    it('bridges components through a non-case-sensitive entry', () => {
      // 1 (CS) and 2 (CS) do not collide directly, but both collide with the
      // CI entry 3 — one maximal component, one diagnostic.
      const diagnostics = lintBook(
        makeBook([
          makeEntry(1, { keys: ['rose'], case_sensitive: true }),
          makeEntry(2, { keys: ['Rose'], case_sensitive: true }),
          makeEntry(3, { keys: ['Rose'] }),
        ]),
      );
      const duplicate = singleOf(diagnostics, 'duplicate-key');
      expect(duplicate.entryIds).toEqual([1, 2, 3]);
      expect(duplicate.details).toBe('rose');
    });

    it('never duplicates blank keys', () => {
      const diagnostics = lintBook(
        makeBook([makeEntry(1, { keys: ['', '   '] }), makeEntry(2, { keys: [' ', ''] })]),
      );
      expect(ruleOf(diagnostics, 'duplicate-key')).toHaveLength(0);
    });

    it('downgrades to info when all members share a non-empty group', () => {
      const diagnostics = lintBook(
        makeBook([
          makeEntry(1, { keys: ['rose'], extensions: { group: 'knights' } }),
          makeEntry(2, { keys: ['rose'], extensions: { group: 'knights' } }),
        ]),
      );
      const duplicate = singleOf(diagnostics, 'duplicate-key');
      expect(duplicate.severity).toBe('info');
      expect(duplicate.message).toContain('extensions.group');
    });

    it('keeps the warning when members are in different groups', () => {
      const diagnostics = lintBook(
        makeBook([
          makeEntry(1, { keys: ['rose'], extensions: { group: 'knights' } }),
          makeEntry(2, { keys: ['rose'], extensions: { group: 'villains' } }),
        ]),
      );
      expect(singleOf(diagnostics, 'duplicate-key').severity).toBe('warning');
    });

    it('counts an entry once even when its key list repeats the key in other cases', () => {
      const diagnostics = lintBook(
        makeBook([makeEntry(1, { keys: ['rose', 'Rose'] }), makeEntry(2, { keys: ['rose'] })]),
      );
      const duplicate = singleOf(diagnostics, 'duplicate-key');
      expect(duplicate.entryIds).toEqual([1, 2]);
      expect(duplicate.details).toBe('rose');
    });
  });

  describe('rule: secondary-keys-ignored', () => {
    it('tells constant entries that all of their keys are ignored', () => {
      const diagnostics = lintBook(
        makeBook([makeEntry(1, { constant: true, secondary_keys: ['s'] })]),
      );
      const ignored = singleOf(diagnostics, 'secondary-keys-ignored');
      expect(ignored.severity).toBe('warning');
      expect(ignored.entryIds).toEqual([1]);
      expect(ignored.message).toContain('constant');
      expect(ignored.message).toContain('ignores all of its keys');
    });

    it('tells non-selective entries that their secondary keys are ignored', () => {
      const diagnostics = lintBook(makeBook([makeEntry(2, { secondary_keys: ['s'] })]));
      const ignored = singleOf(diagnostics, 'secondary-keys-ignored');
      expect(ignored.severity).toBe('warning');
      expect(ignored.message).toContain('not selective');
    });

    it('reports selective entries with secondary keys as healthy', () => {
      const diagnostics = lintBook(
        makeBook([makeEntry(3, { selective: true, secondary_keys: ['s'] })]),
      );
      expect(ruleOf(diagnostics, 'secondary-keys-ignored')).toHaveLength(0);
    });

    it('emits the constant message alone when an entry is constant and selective', () => {
      const diagnostics = lintBook(
        makeBook([makeEntry(4, { constant: true, selective: true, secondary_keys: ['s'] })]),
      );
      const ignored = singleOf(diagnostics, 'secondary-keys-ignored');
      expect(ignored.message).toContain('constant');
    });

    it('does not flag constant or non-selective entries without secondary keys', () => {
      const diagnostics = lintBook(
        makeBook([makeEntry(5, { constant: true }), makeEntry(6, { keys: ['k'] })]),
      );
      expect(ruleOf(diagnostics, 'secondary-keys-ignored')).toHaveLength(0);
    });
  });

  describe('rule: selective-without-secondary', () => {
    it('notes a selective entry with no secondary keys as info', () => {
      const diagnostics = lintBook(makeBook([makeEntry(1, { selective: true })]));
      const note = singleOf(diagnostics, 'selective-without-secondary');
      expect(note.severity).toBe('info');
      expect(note.entryIds).toEqual([1]);
    });

    it('does not flag selective entries that have secondary keys', () => {
      const diagnostics = lintBook(
        makeBook([makeEntry(2, { selective: true, secondary_keys: ['s'] })]),
      );
      expect(ruleOf(diagnostics, 'selective-without-secondary')).toHaveLength(0);
    });

    it('does not flag non-selective entries', () => {
      const diagnostics = lintBook(makeBook([makeEntry(3, { selective: false })]));
      expect(ruleOf(diagnostics, 'selective-without-secondary')).toHaveLength(0);
    });
  });

  describe('rule: never-activatable', () => {
    it('flags an entry with no primary keys', () => {
      const diagnostics = lintBook(makeBook([makeEntry(1)]));
      const dead = singleOf(diagnostics, 'never-activatable');
      expect(dead.severity).toBe('warning');
      expect(dead.entryIds).toEqual([1]);
    });

    it('flags an entry whose keys are all whitespace', () => {
      const diagnostics = lintBook(makeBook([makeEntry(2, { keys: ['   ', ''] })]));
      expect(ruleOf(diagnostics, 'never-activatable')).toHaveLength(1);
    });

    it('does not flag entries with a usable key', () => {
      const diagnostics = lintBook(makeBook([makeEntry(3, { keys: ['rose'] })]));
      expect(ruleOf(diagnostics, 'never-activatable')).toHaveLength(0);
    });

    it('does not flag constant entries — they always activate', () => {
      const diagnostics = lintBook(makeBook([makeEntry(4, { constant: true })]));
      expect(ruleOf(diagnostics, 'never-activatable')).toHaveLength(0);
    });

    describe('honors every alternate activation source', () => {
      const SOURCES: readonly { name: string; extensions: Record<string, unknown> }[] = [
        { name: 'vectorized', extensions: { vectorized: true } },
        { name: 'automation_id', extensions: { automation_id: 'my-automation' } },
        { name: 'triggers', extensions: { triggers: ['normal'] } },
        { name: 'match_persona_description', extensions: { match_persona_description: true } },
        { name: 'match_character_description', extensions: { match_character_description: true } },
        { name: 'match_character_personality', extensions: { match_character_personality: true } },
        {
          name: 'match_character_depth_prompt',
          extensions: { match_character_depth_prompt: true },
        },
        { name: 'match_scenario', extensions: { match_scenario: true } },
        { name: 'match_creator_notes', extensions: { match_creator_notes: true } },
      ];

      for (const source of SOURCES) {
        it(`suppresses the rule for ${source.name}`, () => {
          const diagnostics = lintBook(makeBook([makeEntry(5, { extensions: source.extensions })]));
          expect(ruleOf(diagnostics, 'never-activatable')).toHaveLength(0);
        });
      }
    });

    it('honors the legacy camelCase match flag spellings', () => {
      const diagnostics = lintBook(
        makeBook([makeEntry(6, { extensions: { matchScenario: true } })]),
      );
      expect(ruleOf(diagnostics, 'never-activatable')).toHaveLength(0);
    });

    it('ignores non-boolean match flag values', () => {
      const diagnostics = lintBook(
        makeBook([makeEntry(7, { extensions: { match_scenario: 'yes' } })]),
      );
      expect(ruleOf(diagnostics, 'never-activatable')).toHaveLength(1);
    });

    it('ignores a blank automation_id', () => {
      const diagnostics = lintBook(
        makeBook([makeEntry(8, { extensions: { automation_id: '   ' } })]),
      );
      expect(ruleOf(diagnostics, 'never-activatable')).toHaveLength(1);
    });
  });

  describe('recursion graph', () => {
    it('reports a two-entry cycle once, with the title path in details', () => {
      const diagnostics = lintBook(
        makeBook([
          makeEntry(1, { comment: 'Alpha', keys: ['alpha'], content: 'the beta rises' }),
          makeEntry(2, { comment: 'Beta', keys: ['beta'], content: 'the alpha falls' }),
        ]),
      );
      expect(diagnostics).toHaveLength(1);
      const cycle = singleOf(diagnostics, 'recursion-cycle');
      expect(cycle.severity).toBe('warning');
      expect(cycle.entryIds).toEqual([1, 2]);
      expect(cycle.details).toBe('Alpha → Beta → Alpha');
      // Whole content is scanned — a superset of ST's scan_depth window — so
      // the copy hedges with "may" (plan §3.2 / §7.2).
      expect(cycle.message).toContain('may activate during recursion');
    });

    it('reports a three-entry cycle with the full path', () => {
      const diagnostics = lintBook(
        makeBook([
          makeEntry(1, { comment: 'Alpha', keys: ['alpha'], content: 'the beta rises' }),
          makeEntry(2, { comment: 'Beta', keys: ['beta'], content: 'the gamma sets' }),
          makeEntry(3, { comment: 'Gamma', keys: ['gamma'], content: 'the alpha falls' }),
        ]),
      );
      const cycle = singleOf(diagnostics, 'recursion-cycle');
      expect(cycle.entryIds).toEqual([1, 2, 3]);
      expect(cycle.details).toBe('Alpha → Beta → Gamma → Alpha');
    });

    it('reports a self-loop as self-trigger, never as a recursion cycle', () => {
      const diagnostics = lintBook(
        makeBook([
          makeEntry(1, { comment: 'Alpha', keys: ['alpha'], content: 'alpha knows alpha' }),
        ]),
      );
      expect(ruleOf(diagnostics, 'recursion-cycle')).toHaveLength(0);
      const self = singleOf(diagnostics, 'self-trigger');
      expect(self.severity).toBe('info');
      expect(self.entryIds).toEqual([1]);
      expect(self.details).toBe('alpha');
    });

    it('breaks a would-be cycle when the source sets prevent_recursion', () => {
      const diagnostics = lintBook(
        makeBook([
          makeEntry(1, {
            comment: 'Alpha',
            keys: ['alpha'],
            content: 'the beta rises',
            extensions: { prevent_recursion: true },
          }),
          makeEntry(2, { comment: 'Beta', keys: ['beta'], content: 'the alpha falls' }),
        ]),
      );
      expect(ruleOf(diagnostics, 'recursion-cycle')).toHaveLength(0);
      expect(ruleOf(diagnostics, 'self-trigger')).toHaveLength(0);
    });

    it('breaks a would-be cycle when the target sets exclude_recursion', () => {
      const diagnostics = lintBook(
        makeBook([
          makeEntry(1, { comment: 'Alpha', keys: ['alpha'], content: 'the beta rises' }),
          makeEntry(2, {
            comment: 'Beta',
            keys: ['beta'],
            content: 'the alpha falls',
            extensions: { exclude_recursion: true },
          }),
        ]),
      );
      expect(ruleOf(diagnostics, 'recursion-cycle')).toHaveLength(0);
    });

    it('breaks an edge when an endpoint is disabled', () => {
      const diagnostics = lintBook(
        makeBook([
          makeEntry(1, { comment: 'Alpha', keys: ['alpha'], content: 'the beta rises' }),
          makeEntry(2, {
            comment: 'Beta',
            keys: ['beta'],
            content: 'the alpha falls',
            enabled: false,
          }),
        ]),
      );
      expect(diagnostics).toHaveLength(0);
    });

    it('breaks an edge when the target is constant', () => {
      const diagnostics = lintBook(
        makeBook([
          makeEntry(1, { comment: 'Alpha', keys: ['alpha'], content: 'the beta rises' }),
          makeEntry(2, {
            comment: 'Beta',
            keys: ['beta'],
            content: 'the alpha falls',
            constant: true,
          }),
        ]),
      );
      expect(ruleOf(diagnostics, 'recursion-cycle')).toHaveLength(0);
    });

    it('breaks an edge when the target has no usable keys', () => {
      const diagnostics = lintBook(
        makeBook([
          makeEntry(1, { comment: 'Alpha', keys: ['alpha'], content: 'the beta rises' }),
          makeEntry(2, { comment: 'Beta', content: 'the alpha falls' }),
        ]),
      );
      expect(ruleOf(diagnostics, 'recursion-cycle')).toHaveLength(0);
    });

    it('respects the target case_sensitive option on edges', () => {
      const makePair = (caseSensitive: boolean | undefined): CharacterBook =>
        makeBook([
          makeEntry(1, { comment: 'Alpha', keys: ['alpha'], content: 'the beta rises' }),
          makeEntry(2, {
            comment: 'Beta',
            keys: ['Beta'],
            content: 'the alpha falls',
            case_sensitive: caseSensitive,
          }),
        ]);
      // Case-sensitive target: 'Beta' never matches the lowercase source text.
      expect(ruleOf(lintBook(makePair(true)), 'recursion-cycle')).toHaveLength(0);
      // Default (case-insensitive) target: the folded key matches — the cycle exists.
      expect(ruleOf(lintBook(makePair(undefined)), 'recursion-cycle')).toHaveLength(1);
    });

    it('respects the target match_whole_words option on edges', () => {
      const makePair = (wholeWords: Record<string, unknown>): CharacterBook =>
        makeBook([
          makeEntry(1, { comment: 'Alpha', keys: ['alpha'], content: 'the betamax runs' }),
          makeEntry(2, {
            comment: 'Beta',
            keys: ['beta'],
            content: 'the alpha falls',
            extensions: wholeWords,
          }),
        ]);
      // Whole-word target: 'betamax' is not the word 'beta' — no edge, no cycle.
      expect(
        ruleOf(lintBook(makePair({ match_whole_words: true })), 'recursion-cycle'),
      ).toHaveLength(0);
      // Substring default: 'betamax' contains 'beta' — the cycle exists.
      expect(ruleOf(lintBook(makePair({})), 'recursion-cycle')).toHaveLength(1);
    });

    it('caps matchStKey input content at 5000 characters', () => {
      const makeSource = (content: string): CharacterBook =>
        makeBook([
          makeEntry(1, { comment: 'Alpha', keys: ['alpha'], content }),
          makeEntry(2, { comment: 'Beta', keys: ['beta'], content: 'the alpha falls' }),
        ]);
      // The trigger sits past the cap — no edge, no cycle.
      expect(
        ruleOf(lintBook(makeSource('x'.repeat(5000) + 'beta')), 'recursion-cycle'),
      ).toHaveLength(0);
      // Exactly 5000 characters with the trigger inside — the cycle exists.
      expect(
        ruleOf(lintBook(makeSource('beta' + 'x'.repeat(4996))), 'recursion-cycle'),
      ).toHaveLength(1);
    });

    it('creates edges through valid regex keys, which bypass the match options', () => {
      // Caps and case would defeat plaintext keys here; ST regex keys override
      // every option (world-info.js:338-342).
      const diagnostics = lintBook(
        makeBook([
          makeEntry(1, {
            comment: 'Alpha',
            keys: ['/alpha/'],
            content: 'the BETA rises',
            case_sensitive: true,
            extensions: { match_whole_words: true },
          }),
          makeEntry(2, {
            comment: 'Beta',
            keys: ['/beta/i'],
            content: 'the alpha falls',
            case_sensitive: true,
            extensions: { match_whole_words: true },
          }),
        ]),
      );
      expect(singleOf(diagnostics, 'recursion-cycle').details).toBe('Alpha → Beta → Alpha');
    });

    it('creates a case-sensitive edge when the source text matches exactly', () => {
      const diagnostics = lintBook(
        makeBook([
          makeEntry(1, { comment: 'Alpha', keys: ['alpha'], content: 'the Beta rises' }),
          makeEntry(2, {
            comment: 'Beta',
            keys: ['Beta'],
            content: 'the alpha falls',
            case_sensitive: true,
          }),
        ]),
      );
      expect(singleOf(diagnostics, 'recursion-cycle').details).toBe('Alpha → Beta → Alpha');
    });

    it('finds the cycle path after backtracking through a dead-end branch', () => {
      // Alpha → Bravo branches to Charlie (dead end) before Delta; the DFS
      // pops back and reports the Alpha → Bravo → Delta → Alpha cycle.
      const diagnostics = lintBook(
        makeBook([
          makeEntry(1, { comment: 'Alpha', keys: ['kay-alpha'], content: 'kay-bravo text' }),
          makeEntry(2, {
            comment: 'Bravo',
            keys: ['kay-bravo'],
            content: 'kay-charlie and kay-delta',
          }),
          makeEntry(3, { comment: 'Charlie', keys: ['kay-charlie'], content: 'kay-bravo text' }),
          makeEntry(4, { comment: 'Delta', keys: ['kay-delta'], content: 'kay-alpha text' }),
        ]),
      );
      const cycle = singleOf(diagnostics, 'recursion-cycle');
      expect(cycle.entryIds).toEqual([1, 2, 4]);
      expect(cycle.details).toBe('Alpha → Bravo → Delta → Alpha');
    });

    it('reports a self-trigger without details when a blank key matches first', () => {
      // Oracle quirk ported as-is: an empty plaintext key matches everything
      // via includes (st-key-match.ts), so it is the first self-match.
      const diagnostics = lintBook(
        makeBook([
          makeEntry(1, { comment: 'Alpha', keys: ['', 'alpha'], content: 'alpha knows alpha' }),
        ]),
      );
      const self = singleOf(diagnostics, 'self-trigger');
      expect(self.details).toBeUndefined();
      expect(ruleOf(diagnostics, 'recursion-cycle')).toHaveLength(0);
    });

    describe('requires graph eligibility for self-triggers', () => {
      const SELF_MATCH = { comment: 'Alpha', keys: ['alpha'], content: 'alpha knows alpha' };
      const VARIANTS: readonly { name: string; overrides: Partial<CharacterBookEntry> }[] = [
        { name: 'disabled', overrides: { enabled: false } },
        { name: 'constant', overrides: { constant: true } },
        { name: 'exclude_recursion', overrides: { extensions: { exclude_recursion: true } } },
        { name: 'prevent_recursion', overrides: { extensions: { prevent_recursion: true } } },
      ];

      for (const variant of VARIANTS) {
        it(`is not reported for a ${variant.name} entry`, () => {
          const diagnostics = lintBook(
            makeBook([makeEntry(1, { ...SELF_MATCH, ...variant.overrides })]),
          );
          expect(ruleOf(diagnostics, 'self-trigger')).toHaveLength(0);
        });
      }

      it('is reported for a plain enabled entry', () => {
        const diagnostics = lintBook(makeBook([makeEntry(2, SELF_MATCH)]));
        expect(ruleOf(diagnostics, 'self-trigger')).toHaveLength(1);
      });
    });
  });

  describe('large-book perf guard', () => {
    it('skips the graph rules above LARGE_BOOK_THRESHOLD and notes the skip once', () => {
      const diagnostics = lintBook(makeLargeBook(LARGE_BOOK_THRESHOLD + 1));
      expect(diagnostics).toHaveLength(1);
      const skip = singleOf(diagnostics, 'recursion-cycle');
      expect(skip.severity).toBe('info');
      expect(skip.entryIds).toEqual([]);
      expect(skip.message).toContain('skipped');
      expect(skip.message).toContain(String(LARGE_BOOK_THRESHOLD + 1));
    });

    it('still runs the graph rules at exactly LARGE_BOOK_THRESHOLD', () => {
      const diagnostics = lintBook(makeLargeBook(LARGE_BOOK_THRESHOLD));
      const cycle = singleOf(diagnostics, 'recursion-cycle');
      expect(cycle.severity).toBe('warning');
      expect(cycle.details).toBe('Alpha → Beta → Alpha');
    });

    it('always runs the O(V·k) key rules above the threshold', () => {
      const book = makeLargeBook(LARGE_BOOK_THRESHOLD);
      book.entries.push(makeEntry(9999, { keys: ['/bad[/i'] }));
      const diagnostics = lintBook(book);
      expect(ruleOf(diagnostics, 'invalid-regex')).toHaveLength(1);
      expect(singleOf(diagnostics, 'recursion-cycle').severity).toBe('info');
    });
  });

  describe('sorting', () => {
    it('orders diagnostics error → warning → info', () => {
      const diagnostics = lintBook(
        makeBook([
          makeEntry(10, { comment: 'Gamma', keys: ['gamma'], content: 'gamma knows gamma' }),
          makeEntry(11, { keys: ['/bad[/i'] }),
          makeEntry(12, { comment: 'Paris', keys: ['k'], content: '<Paris>\nlore' }),
          makeEntry(13, { secondary_keys: ['s'] }),
        ]),
      );
      expect(diagnostics.map((d) => d.severity)).toEqual([
        'error',
        'warning',
        'warning',
        'warning',
        'info',
      ]);
      expect(diagnostics.map((d) => d.rule)).toEqual([
        'invalid-regex',
        'malformed-wrapper',
        'secondary-keys-ignored',
        'never-activatable',
        'self-trigger',
      ]);
    });

    it('orders same-severity diagnostics by entry order', () => {
      const diagnostics = lintBook(
        makeBook([
          makeEntry(1),
          makeEntry(2, { comment: 'Paris', keys: ['k'], content: '<Paris>\nlore' }),
        ]),
      );
      expect(diagnostics.map((d) => d.rule)).toEqual(['never-activatable', 'malformed-wrapper']);
    });

    it('anchors multi-entry diagnostics on their first member', () => {
      const diagnostics = lintBook(
        makeBook([
          makeEntry(1),
          makeEntry(2),
          makeEntry(3, { keys: ['rose'] }),
          makeEntry(4, { keys: ['rose'] }),
          makeEntry(5, { keys: ['lily'] }),
          makeEntry(6, { keys: ['lily'] }),
        ]),
      );
      const duplicates = ruleOf(diagnostics, 'duplicate-key');
      expect(duplicates.map((d) => d.details)).toEqual(['rose', 'lily']);
      expect(duplicates.map((d) => d.entryIds)).toEqual([
        [3, 4],
        [5, 6],
      ]);
      // Both duplicate groups sort after the single-entry warnings on 1 and 2.
      expect(diagnostics.slice(0, 2).every((d) => d.rule === 'never-activatable')).toBe(true);
    });
  });

  describe('diagnostic signatures & options (plan 03 §3.6.5)', () => {
    /** A book carrying findings from several rules, for options tests. */
    function makeFindingsBook(): CharacterBook {
      return makeBook([
        makeEntry(1, { keys: ['/bad1[/i'] }),
        makeEntry(2, { keys: ['/bad2[/i', '/bad3[/i'] }),
        makeEntry(3, { keys: ['/bad4[/i'] }),
        makeEntry(4),
        makeEntry(5),
        makeEntry(6, { keys: ['rose'] }),
        makeEntry(7, { keys: ['rose'] }),
      ]);
    }

    describe('lintDiagnosticSignature', () => {
      it('derives the documented `rule|entryIds|details` format', () => {
        expect(
          lintDiagnosticSignature({
            rule: 'duplicate-key',
            severity: 'warning',
            entryIds: [1, 2],
            message: '',
            details: 'rose',
          }),
        ).toBe('duplicate-key|1,2|rose');
        // No details → trailing `|`.
        expect(
          lintDiagnosticSignature({
            rule: 'invalid-regex',
            severity: 'error',
            entryIds: [7],
            message: '',
          }),
        ).toBe('invalid-regex|7|');
      });

      it('gives the book-level perf-guard note the empty entryIds shape', () => {
        const skip = singleOf(lintBook(makeLargeBook(LARGE_BOOK_THRESHOLD + 1)), 'recursion-cycle');
        expect(skip.entryIds).toEqual([]);
        expect(lintDiagnosticSignature(skip)).toBe('recursion-cycle||');
      });

      it('keeps distinct findings distinct', () => {
        const diagnostics = lintBook(makeFindingsBook());
        const signatures = diagnostics.map(lintDiagnosticSignature);
        expect(new Set(signatures).size).toBe(signatures.length);
      });

      it('distinguishes same-entry findings by details', () => {
        const diagnostics = lintBook(makeBook([makeEntry(1, { keys: ['/a[/i', '/b[/i'] })]));
        expect(diagnostics).toHaveLength(2);
        const first = diagnostics[0];
        const second = diagnostics[1];
        assert(first && second);
        expect(lintDiagnosticSignature(first)).toBe('invalid-regex|1|/a[/i');
        expect(lintDiagnosticSignature(second)).toBe('invalid-regex|1|/b[/i');
      });
    });

    describe('option: ignored', () => {
      it('suppresses exactly the diagnostic whose signature matches', () => {
        const book = makeFindingsBook();
        const plain = lintBook(book);
        const target = plain[0];
        assert(target);
        const signature = lintDiagnosticSignature(target);

        const filtered = lintBook(book, { ignored: new Set([signature]) });
        expect(filtered).toHaveLength(plain.length - 1);
        // The remaining diagnostics are exactly the plain output minus the
        // ignored one, in the same order.
        expect(filtered).toEqual(plain.filter((d) => lintDiagnosticSignature(d) !== signature));
      });

      it('keeps near-misses: the same rule on other entries', () => {
        const book = makeBook([
          makeEntry(1, { keys: ['/a[/i'] }),
          makeEntry(2, { keys: ['/b[/i'] }),
        ]);
        const plain = lintBook(book);
        const first = plain[0];
        assert(first);
        const filtered = lintBook(book, {
          ignored: new Set([lintDiagnosticSignature(first)]),
        });
        expect(ruleOf(filtered, 'invalid-regex')).toHaveLength(1);
        expect(singleOf(filtered, 'invalid-regex').entryIds).toEqual([2]);
      });

      it('keeps near-misses: the same entries with different details', () => {
        const book = makeBook([makeEntry(1, { keys: ['/a[/i', '/b[/i'] })]);
        const plain = lintBook(book);
        const first = plain[0];
        assert(first);
        const filtered = lintBook(book, {
          ignored: new Set([lintDiagnosticSignature(first)]),
        });
        const remaining = ruleOf(filtered, 'invalid-regex');
        expect(remaining).toHaveLength(1);
        expect(remaining[0]?.details).toBe('/b[/i');
      });

      it('can suppress the book-level skip note by its signature', () => {
        const book = makeLargeBook(LARGE_BOOK_THRESHOLD + 1);
        const skip = singleOf(lintBook(book), 'recursion-cycle');
        const filtered = lintBook(book, {
          ignored: new Set([lintDiagnosticSignature(skip)]),
        });
        expect(filtered).toHaveLength(0);
      });
    });

    describe('option: mutedRules', () => {
      it('skips a muted rule while the rest still run', () => {
        const diagnostics = lintBook(makeFindingsBook(), {
          mutedRules: new Set<LintRuleId>(['invalid-regex']),
        });
        expect(ruleOf(diagnostics, 'invalid-regex')).toHaveLength(0);
        expect(ruleOf(diagnostics, 'duplicate-key')).toHaveLength(1);
        expect(ruleOf(diagnostics, 'never-activatable')).toHaveLength(2);

        // Mutting every rule at once empties the report without breaking
        // the pass — each rule's mute filter branch fires here.
        const allRules: LintRuleId[] = [
          'invalid-regex',
          'duplicate-key',
          'secondary-keys-ignored',
          'selective-without-secondary',
          'never-activatable',
          'recursion-cycle',
          'self-trigger',
          'malformed-wrapper',
        ];
        expect(lintBook(makeFindingsBook(), { mutedRules: new Set(allRules) })).toEqual([]);
      });

      it('silences the perf-guard skip note when recursion-cycle is muted (pinned interaction)', () => {
        const diagnostics = lintBook(makeLargeBook(LARGE_BOOK_THRESHOLD + 1), {
          mutedRules: new Set<LintRuleId>(['recursion-cycle']),
        });
        expect(diagnostics).toHaveLength(0);
      });

      it('keeps the graph running for self-trigger when only cycles are muted', () => {
        const diagnostics = lintBook(
          makeBook([
            makeEntry(1, { comment: 'Alpha', keys: ['alpha'], content: 'alpha knows alpha' }),
          ]),
          { mutedRules: new Set<LintRuleId>(['recursion-cycle']) },
        );
        expect(ruleOf(diagnostics, 'self-trigger')).toHaveLength(1);
      });

      it('keeps cycles when only self-trigger is muted', () => {
        const diagnostics = lintBook(
          makeBook([
            makeEntry(1, { comment: 'Alpha', keys: ['alpha'], content: 'the beta rises' }),
            makeEntry(2, { comment: 'Beta', keys: ['beta'], content: 'the alpha falls' }),
          ]),
          { mutedRules: new Set<LintRuleId>(['self-trigger']) },
        );
        expect(ruleOf(diagnostics, 'recursion-cycle')).toHaveLength(1);
      });

      it('mutes self-trigger without losing it from an otherwise empty report', () => {
        const diagnostics = lintBook(
          makeBook([
            makeEntry(1, { comment: 'Alpha', keys: ['alpha'], content: 'alpha knows alpha' }),
          ]),
          { mutedRules: new Set<LintRuleId>(['self-trigger']) },
        );
        expect(diagnostics).toHaveLength(0);
      });
    });

    describe('options invariants', () => {
      it('stays identical to the no-options call for {} and empty sets', () => {
        const book = makeFindingsBook();
        const plain = lintBook(book);
        expect(lintBook(book, {})).toEqual(plain);
        expect(
          lintBook(book, { ignored: new Set<string>(), mutedRules: new Set<LintRuleId>() }),
        ).toEqual(plain);
      });

      it('preserves the severity→entry-order sort after filtering', () => {
        const book = makeBook([
          makeEntry(1, { keys: ['/bad[/i'] }), // error
          makeEntry(2), // warning: never-activatable
          makeEntry(3), // warning: never-activatable
        ]);
        const plain = lintBook(book);
        const error = plain[0];
        assert(error);
        const filtered = lintBook(book, {
          ignored: new Set([lintDiagnosticSignature(error)]),
        });
        expect(filtered.map((d) => [d.severity, d.rule, d.entryIds])).toEqual([
          ['warning', 'never-activatable', [2]],
          ['warning', 'never-activatable', [3]],
        ]);
      });

      it('applies ignored and mutedRules together', () => {
        const book = makeFindingsBook();
        const plain = lintBook(book);
        const warning = plain.find((d) => d.rule === 'never-activatable');
        assert(warning);
        const diagnostics = lintBook(book, {
          ignored: new Set([lintDiagnosticSignature(warning)]),
          mutedRules: new Set<LintRuleId>(['invalid-regex']),
        });
        expect(ruleOf(diagnostics, 'invalid-regex')).toHaveLength(0);
        expect(ruleOf(diagnostics, 'never-activatable')).toHaveLength(1);
        expect(ruleOf(diagnostics, 'duplicate-key')).toHaveLength(1);
      });

      it('never mutates a deep-frozen book with options and repeats deterministically', () => {
        const book = deepFreeze(
          makeBook([
            makeEntry(1, { keys: ['/bad[/i'] }),
            makeEntry(2),
            makeEntry(3, { keys: ['rose'] }),
            makeEntry(4, { keys: ['rose'] }),
          ]),
        );
        const before = JSON.stringify(book);
        const options: LintOptions = {
          ignored: new Set([lintDiagnosticSignature(singleOf(lintBook(book), 'invalid-regex'))]),
          mutedRules: new Set<LintRuleId>(['duplicate-key']),
        };

        const firstRun = lintBook(book, options);
        expect(JSON.stringify(book)).toBe(before);
        expect(lintBook(book, options)).toEqual(firstRun);
        // The options object itself is not consumed destructively.
        expect(firstRun.every((d) => d.rule !== 'duplicate-key')).toBe(true);
        expect(options.ignored?.size).toBe(1);
      });
    });
  });

  describe('immutability & determinism', () => {
    it('never mutates a deep-frozen book and is deterministic across runs', () => {
      const book = deepFreeze(
        makeBook([
          makeEntry(1, { comment: 'Alpha', keys: ['alpha'], content: 'the beta rises' }),
          makeEntry(2, { comment: 'Beta', keys: ['beta'], content: 'the alpha falls' }),
          makeEntry(3, { keys: ['/bad[/i'], secondary_keys: ['s'] }),
          makeEntry(4, { comment: 'Paris', keys: ['k'], content: '<Paris>\nlore' }),
          makeEntry(5, { keys: ['rose'], selective: true }),
          makeEntry(6, { keys: ['rose'] }),
        ]),
      );
      const before = JSON.stringify(book);

      const firstRun = lintBook(book);
      expect(JSON.stringify(book)).toBe(before);

      const secondRun = lintBook(book);
      expect(JSON.stringify(secondRun)).toBe(JSON.stringify(firstRun));
      expect(firstRun.length).toBeGreaterThan(0);

      // Spot-check: frozen objects pass through by reference, untouched.
      expect(Object.isFrozen(book)).toBe(true);
      expect(Object.isFrozen(book.entries[2]?.extensions)).toBe(true);
    });

    it('passes a frozen empty book through without diagnostics', () => {
      expect(lintBook(deepFreeze(makeBook([])))).toEqual([]);
    });
  });

  describe('entry id resolution', () => {
    it('resolves entryIds as entry.id ?? array index', () => {
      const withId = makeEntry(42, { keys: ['/bad[/i'] });
      const withoutId: CharacterBookEntry = { ...makeEntry(7, { keys: ['k'] }), id: undefined };
      const diagnostics = lintBook(makeBook([withId, withoutId]));
      expect(singleOf(diagnostics, 'invalid-regex').entryIds).toEqual([42]);
    });
  });
});
