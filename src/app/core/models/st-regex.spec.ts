import {
  classifyStKey,
  isRegexShapedKey,
  isValidStRegex,
  matchStRegex,
  parseStRegex,
  type StKeyClass,
} from './st-regex';

describe('st-regex', () => {
  describe('parseStRegex', () => {
    const NON_REGEX_KEYS: readonly string[] = [
      '',
      'plain',
      'rose, lily',
      'a/b',
      '/',
      '//',
      '  /a/  ',
      '\\/foo\\/',
      '/a',
      'a/',
    ];

    for (const key of NON_REGEX_KEYS) {
      it(`returns null for the non-regex key ${JSON.stringify(key)} (world-info.js:2823-2826)`, () => {
        expect(parseStRegex(key)).toBeNull();
      });
    }

    const VALID_KEYS: readonly [key: string, source: string, flags: string][] = [
      ['/rose/', 'rose', ''],
      ['/rose/i', 'rose', 'i'],
      ['/x/gimsuy', 'x', 'gimsuy'],
      ['/x/ugims', 'x', 'ugims'],
      ['/a[0-9]+/', 'a[0-9]+', ''],
      ['/ /', ' ', ''],
      ['/foo\nbar/', 'foo\nbar', ''],
      ['/a\\/b/', 'a/b', ''],
      ['/a\\//', 'a/', ''],
    ];

    for (const [key, source, flags] of VALID_KEYS) {
      it(`parses ${JSON.stringify(key)} to body ${JSON.stringify(source)} with raw flags ${JSON.stringify(flags)} (world-info.js:2828)`, () => {
        const parsed = parseStRegex(key);
        expect(parsed).not.toBeNull();
        expect(parsed?.source).toBe(source);
        expect(parsed?.flags).toBe(flags);
      });
    }

    it('compiles a working RegExp from the unescaped body', () => {
      const parsed = parseStRegex('/a\\/b/');
      expect(parsed).not.toBeNull();
      expect(parsed?.regex.test('x a/b y')).toBe(true);
      expect(parsed?.regex.test('x a y')).toBe(false);
    });

    it('unescapes only the first \\/, exactly like String#replace in the oracle (world-info.js:2838)', () => {
      const parsed = parseStRegex('/a\\/b\\/c/');
      expect(parsed?.source).toBe('a/b\\/c');
      expect(parsed?.regex.test('a/b/c')).toBe(true);
    });

    const UNESCAPED_SLASH_KEYS: readonly string[] = ['/a/b/', '/a//', '///', '/a[/]/'];

    for (const key of UNESCAPED_SLASH_KEYS) {
      it(`rejects the unescaped inner slash in ${JSON.stringify(key)} (world-info.js:2830-2835)`, () => {
        expect(parseStRegex(key)).toBeNull();
      });
    }

    const UNACCEPTED_FLAG_KEYS: readonly string[] = ['/a/d', '/a/v', '/a/l', '/a/dgimuy'];

    for (const key of UNACCEPTED_FLAG_KEYS) {
      it(`rejects the ST-unaccepted flags of ${JSON.stringify(key)} (world-info.js:2823)`, () => {
        expect(parseStRegex(key)).toBeNull();
        expect(isRegexShapedKey(key)).toBe(false);
      });
    }

    const UNCOMPILABLE_KEYS: readonly string[] = ['/a[/i', '/a\\/', '/(a/', '/a/ii', '/a/gimsuyg'];

    for (const key of UNCOMPILABLE_KEYS) {
      it(`returns null when the body of ${JSON.stringify(key)} does not compile (world-info.js:2841-2845)`, () => {
        expect(parseStRegex(key)).toBeNull();
      });
    }

    it('treats a slash after an escaped backslash as an escaped delimiter (oracle quirk, world-info.js:2833)', () => {
      const parsed = parseStRegex('/a\\\\/b/');
      expect(parsed).not.toBeNull();
      expect(parsed?.regex.test('a/b')).toBe(true);
    });

    it('returns a fresh RegExp per parse, never a cached one (world-info.js:339)', () => {
      const first = parseStRegex('/a/g');
      const second = parseStRegex('/a/g');
      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(first?.regex).not.toBe(second?.regex);
    });
  });

  describe('isRegexShapedKey', () => {
    const SHAPED_KEYS: readonly string[] = [
      '/a/',
      '/a[/i',
      '/a/ii',
      '///',
      '/foo\nbar/',
      '/a\\/b/',
      '/(a/',
    ];

    for (const key of SHAPED_KEYS) {
      it(`accepts the delimiter shape of ${JSON.stringify(key)} even when it would not compile (world-info.js:2823)`, () => {
        expect(isRegexShapedKey(key)).toBe(true);
      });
    }

    const NOT_SHAPED_KEYS: readonly string[] = [
      '',
      'plain',
      'a/b',
      '/',
      '//',
      '/a',
      'a/',
      '\\/foo\\/',
      // '/a/d' and '/a/v' are pinned in the UNACCEPTED_FLAG_KEYS loop above,
      // which also shows their parseStRegex outcome.
    ];

    for (const key of NOT_SHAPED_KEYS) {
      it(`rejects ${JSON.stringify(key)} as missing the ST delimiter shape`, () => {
        expect(isRegexShapedKey(key)).toBe(false);
      });
    }
  });

  describe('isValidStRegex', () => {
    // st-regex.ts implements isValidStRegex as `parseStRegex(key) !== null`,
    // so the parse tables above already pin every classification case; only
    // the public delegation contract is pinned here.
    it('delegates to parseStRegex success', () => {
      expect(isValidStRegex('/a/')).toBe(true);
      expect(isValidStRegex('/a[/i')).toBe(false);
      expect(isValidStRegex('plain')).toBe(false);
    });
  });

  describe('matchStRegex', () => {
    const MATCH_CASES: readonly [key: string, text: string, expected: boolean][] = [
      ['/rose/i', 'ROSES are red', true],
      ['/rose/i', 'LILIES are red', false],
      ['/^rose/', 'roses', true],
      ['/^rose/', 'a rose', false],
      ['/a\\d+/', 'a42', true],
      ['/a\\d+/', 'axy', false],
      // ST applies regexes raw: case/whole-word options never fold the haystack.
      ['/rose/', 'ROSE', false],
      ['/ROSE/', 'rose', false],
    ];

    for (const [key, text, expected] of MATCH_CASES) {
      it(`matches ${JSON.stringify(key)} against ${JSON.stringify(text)} -> ${expected}`, () => {
        expect(matchStRegex(key, text)).toBe(expected);
      });
    }

    it('returns false for invalid or non-regex keys (ST then treats them as plaintext)', () => {
      expect(matchStRegex('/a[/i', '/a[/')).toBe(false);
      expect(matchStRegex('rose', 'rose')).toBe(false);
      expect(matchStRegex('', '')).toBe(false);
    });

    it('is stateless across calls even for stateful flags (fresh parse per call, world-info.js:339)', () => {
      for (let i = 0; i < 3; i++) {
        expect(matchStRegex('/o/g', 'foo')).toBe(true);
        // Sticky anchors at lastIndex, which starts at 0 on every fresh parse.
        expect(matchStRegex('/f/y', 'foo')).toBe(true);
      }
    });
  });

  describe('classifyStKey (Task 04 Tier 1 truth table)', () => {
    const CLASS_CASES: readonly [key: string, expected: StKeyClass][] = [
      // Plain text: no delimiter shape at all.
      ['', 'text'],
      ['plain', 'text'],
      ['rose, lily', 'text'],
      ['a/b', 'text'],
      ['  /a/  ', 'text'],
      // Shaped and compiling.
      ['/rose/', 'regex'],
      ['/rose/i', 'regex'],
      ['/a[0-9]+/', 'regex'],
      ['/a\\/b/', 'regex'],
      ['/x/gimsuy', 'regex'],
      // Shaped but dead: uncompilable body (world-info.js:2841-2845).
      ['/(saber/', 'invalid-regex'],
      ['/a[/i', 'invalid-regex'],
      ['/a/ii', 'invalid-regex'],
      // Shaped but dead: unescaped inner slash (world-info.js:2830-2835).
      ['/a/b/', 'invalid-regex'],
      ['///', 'invalid-regex'],
      ['/a//', 'invalid-regex'],
      // ST-unaccepted flags fail the shape gate itself — the flag class is
      // [gimsuy]* (world-info.js:2823) — so ST never even parses them as
      // regexes and matchKeys falls to plaintext like any unshaped key.
      ['/x/d', 'text'],
      ['/x/v', 'text'],
      ['/x/dgimuy', 'text'],
    ];

    for (const [key, expected] of CLASS_CASES) {
      it(`classifies ${JSON.stringify(key)} -> ${JSON.stringify(expected)}`, () => {
        expect(classifyStKey(key)).toBe(expected);
      });
    }
  });
});
