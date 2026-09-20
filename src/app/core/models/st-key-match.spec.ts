import { findStKeyMatches, matchStKey, type StKeyMatchRange, type StMatchOptions } from './st-key-match';

/** Runs `matchStKey` with the default ST settings (both options unset -> false). */
function matchDefault(key: string, text: string): boolean {
  return matchStKey(key, text, {});
}

describe('st-key-match', () => {
  describe('plaintext substring matching (defaults, world-info.js:362)', () => {
    const CASES: readonly [key: string, text: string, expected: boolean][] = [
      ['rose', 'the Rose grew', true],
      ['rose', 'the ROSE grew', true],
      ['rose', 'the rosehip', true],
      ['ROSE', 'the rose grew', true],
      ['rose', 'the lily grew', false],
      ['rose', '', false],
      ['', 'the rose grew', true],
      ['', '', true],
      ['a/b', 'x a/b y', true],
      ['/a//', 'x /a// y', true],
    ];

    for (const [key, text, expected] of CASES) {
      it(`matches ${JSON.stringify(key)} against ${JSON.stringify(text)} -> ${expected}`, () => {
        expect(matchDefault(key, text)).toBe(expected);
      });
    }
  });

  describe('caseSensitive option (world-info.js:268-270, default false)', () => {
    const CASES: readonly [
      key: string,
      text: string,
      caseSensitive: boolean | null,
      expected: boolean,
    ][] = [
      ['rose', 'the Rose grew', true, false],
      ['Rose', 'the Rose grew', true, true],
      ['ROSE', 'the ROSE grew', true, true],
      ['rose', 'the ROSE grew', null, true],
      // Explicit false must behave like unset — not like "option present":
      // an implementation branching on `!= null` instead of `=== true` fails
      // only this row.
      ['rose', 'the ROSE grew', false, true],
    ];

    for (const [key, text, caseSensitive, expected] of CASES) {
      it(`matches ${JSON.stringify(key)} against ${JSON.stringify(text)} (caseSensitive: ${caseSensitive}) -> ${expected}`, () => {
        expect(matchStKey(key, text, { caseSensitive })).toBe(expected);
      });
    }

    it('does not transform the haystack when case-sensitive (exact toLowerCase contract)', () => {
      // Turkish dotted-I style case folds are out of scope: ST folds with
      // String#toLowerCase on both sides, so both sides shift identically.
      expect(matchStKey('STRASSE', 'strasse', { caseSensitive: false })).toBe(true);
      expect(matchStKey('STRASSE', 'straße', { caseSensitive: false })).toBe(false);
    });
  });

  describe('matchWholeWords single-word boundaries (world-info.js:355-359)', () => {
    const KING = 'king';
    const OPTIONS: StMatchOptions = { matchWholeWords: true };

    it('matches the worldinfo.md:450 example: "long live the king"', () => {
      expect(matchStKey(KING, 'long live the king', OPTIONS)).toBe(true);
    });

    it('rejects the worldinfo.md:450 example: "it\'s not to my liking"', () => {
      expect(matchStKey(KING, "it's not to my liking", OPTIONS)).toBe(false);
    });

    it('matches substring occurrences when whole words are off (world-info.js:362)', () => {
      expect(matchStKey(KING, "it's not to my liking", { matchWholeWords: false })).toBe(true);
      expect(matchStKey(KING, 'kingdom', { matchWholeWords: false })).toBe(true);
    });

    const BOUNDARY_CASES: readonly [text: string, expected: boolean][] = [
      ['king', true],
      ['king rules', true],
      ['the king', true],
      ['the king!', true],
      ['!king,', true],
      ['the king.', true],
      ['kingdom', false],
      ['my_king', false],
      ['king_size', false],
      ['v2king', false],
      ['the flamingo', false],
    ];

    for (const [text, expected] of BOUNDARY_CASES) {
      it(`matches ${JSON.stringify(text)} -> ${expected} (JS \\W: underscore is a word character)`, () => {
        expect(matchStKey(KING, text, OPTIONS)).toBe(expected);
      });
    }

    it('case-folds both sides before the boundary test (world-info.js:345-346)', () => {
      expect(matchStKey('KING', 'long live the KING', OPTIONS)).toBe(true);
      expect(matchStKey('KING', 'long live the king', OPTIONS)).toBe(true);
      expect(
        matchStKey('KING', 'long live the king', { caseSensitive: true, matchWholeWords: true }),
      ).toBe(false);
      expect(
        matchStKey('KING', 'long live the KING', { caseSensitive: true, matchWholeWords: true }),
      ).toBe(true);
    });

    it('escapes regex metacharacters in the key (world-info.js:356)', () => {
      expect(matchStKey('a.b', 'x a.b y', OPTIONS)).toBe(true);
      expect(matchStKey('a.b', 'x axb y', OPTIONS)).toBe(false);
      expect(matchStKey('a+b', 'x a+b y', OPTIONS)).toBe(true);
      expect(matchStKey('a+b', 'x aaab y', OPTIONS)).toBe(false);
      expect(matchStKey('[x]', 'call [x] now', OPTIONS)).toBe(true);
      expect(matchStKey('[x]', 'call x now', OPTIONS)).toBe(false);
      expect(matchStKey('(a)', 'call (a) now', OPTIONS)).toBe(true);
      expect(matchStKey('$5', 'pay $5 now', OPTIONS)).toBe(true);
      expect(matchStKey("it's", "well it's here", OPTIONS)).toBe(true);
    });

    it('matches punctuation-adjacent literals exactly once around the key', () => {
      expect(matchStKey('a.b', 'a.b', OPTIONS)).toBe(true);
      expect(matchStKey('a.b', 'a.b.', OPTIONS)).toBe(true);
      expect(matchStKey('a.b', 'xa.by', OPTIONS)).toBe(false);
    });
  });

  describe('matchWholeWords multi-word keys stay substring (world-info.js:350-353)', () => {
    const OPTIONS: StMatchOptions = { matchWholeWords: true };

    const CASES: readonly [key: string, text: string, expected: boolean][] = [
      ['silver chair', 'the silver chair', true],
      ['silver chair', 'the silver-chair', false],
      ['silver chair', 'silver and chair', false],
      ['silver chair', 'the SILVER CHAIR', true],
      ['silver chair', 'the silver chair, indeed', true],
      ['silver chair', 'silverchair', false],
    ];

    for (const [key, text, expected] of CASES) {
      it(`matches ${JSON.stringify(key)} against ${JSON.stringify(text)} -> ${expected}`, () => {
        expect(matchStKey(key, text, OPTIONS)).toBe(expected);
      });
    }

    it('keeps substring semantics for multi-word keys even when case-sensitive', () => {
      expect(
        matchStKey('Silver Chair', 'the Silver Chair', {
          caseSensitive: true,
          matchWholeWords: true,
        }),
      ).toBe(true);
      expect(
        matchStKey('Silver Chair', 'the silver chair', {
          caseSensitive: true,
          matchWholeWords: true,
        }),
      ).toBe(false);
    });

    it('splits on any whitespace run for the word count (world-info.js:350)', () => {
      // 'silver\tchair' splits into two words -> includes path.
      expect(matchStKey('silver\tchair', 'the silver chair', OPTIONS)).toBe(false);
      expect(matchStKey('silver\tchair', 'the silver\tchair', OPTIONS)).toBe(true);
    });
  });

  describe('oracle quirks ported as-is', () => {
    it('keys with surrounding whitespace split into >1 word and go through includes (world-info.js:350)', () => {
      // ' king '.split(/\s+/) === ['', 'king', ''] -> includes(' king ').
      expect(matchStKey(' king ', 'long live the king ', { matchWholeWords: true })).toBe(true);
      expect(matchStKey(' king ', 'long live the king', { matchWholeWords: true })).toBe(false);
    });

    it('an empty key fails the whole-word boundary pattern (world-info.js:356)', () => {
      expect(matchStKey('', 'anything', { matchWholeWords: true })).toBe(false);
    });

    it('null options behave exactly like unset options (ST defaults false, world-info.js:77-78)', () => {
      expect(
        matchStKey('rose', 'the ROSE grew', { caseSensitive: null, matchWholeWords: null }),
      ).toBe(true);
      expect(
        matchStKey('king', "it's not to my liking", { caseSensitive: null, matchWholeWords: null }),
      ).toBe(true);
      expect(
        matchStKey('king', "it's not to my liking", { caseSensitive: null, matchWholeWords: true }),
      ).toBe(false);
    });
  });

  describe('regex keys override the options (world-info.js:338-342)', () => {
    const CASES: readonly [
      key: string,
      text: string,
      options: StMatchOptions,
      expected: boolean,
    ][] = [
      // Regex wins even when case-sensitive/whole-word would reject the text.
      ['/rose/i', 'ROSE', { caseSensitive: true, matchWholeWords: true }, true],
      // Whole-word plaintext would reject 'kingdom'; the raw regex still hits.
      ['/king/', 'kingdom', { matchWholeWords: true }, true],
      // Regex flags govern case; the case option is never applied to the
      // haystack — 'ROSE' folded would be 'rose', so these rows also prove
      // the raw regex runs before any case folding.
      ['/rose/', 'ROSE', { caseSensitive: false }, false],
      ['/ROSE/', 'rose', { caseSensitive: false }, false],
      // Anchors behave as written.
      ['/^rose$/', 'rose', {}, true],
      ['/^rose$/', 'a rose', {}, false],
      ['/^rose$/', 'a rose', { caseSensitive: false }, false],
    ];

    for (const [key, text, options, expected] of CASES) {
      it(`matches ${JSON.stringify(key)} against ${JSON.stringify(text)} -> ${expected}`, () => {
        expect(matchStKey(key, text, options)).toBe(expected);
      });
    }
  });

  describe('regex-shaped keys that fail to parse fall back to plaintext (world-info.js:339-345)', () => {
    const CASES: readonly [key: string, text: string, expected: boolean][] = [
      ['/a[/i', 'the /a[/i key', true],
      ['/a[/i', 'plain prose', false],
      ['/a//', 'value /a// here', true],
      ['//', 'an // empty body', true],
    ];

    for (const [key, text, expected] of CASES) {
      it(`matches ${JSON.stringify(key)} as plaintext against ${JSON.stringify(text)} -> ${expected}`, () => {
        expect(matchStKey(key, text, {})).toBe(expected);
      });
    }

    it('still applies case folding and whole-word options to the plaintext fallback', () => {
      expect(matchStKey('/a[/i', 'THE /A[/I KEY', {})).toBe(true);
      expect(matchStKey('/a[/i', 'THE /A[/I KEY', { caseSensitive: true })).toBe(false);
      // Single word after split -> boundary pattern applies.
      expect(matchStKey('/a[/i', 'x/a[/y', { matchWholeWords: true })).toBe(false);
      expect(matchStKey('/a[/i', 'x /a[/i y', { matchWholeWords: true })).toBe(true);
    });
  });

  describe('findStKeyMatches (Task 04 Tier 1)', () => {
    describe('regex keys: every occurrence with g, first only without (world-info.js:338-342)', () => {
      it('returns every occurrence for a g-flagged key', () => {
        expect(findStKeyMatches('/o/g', 'foo bar oooh', {})).toEqual([
          { start: 1, end: 2 },
          { start: 2, end: 3 },
          { start: 8, end: 9 },
          { start: 9, end: 10 },
          { start: 10, end: 11 },
        ]);
      });

      it('returns the first match only without the g flag', () => {
        expect(findStKeyMatches('/o/', 'foo bar oooh', {})).toEqual([{ start: 1, end: 2 }]);
      });

      it('repeats the full result on every call (fresh parse per evaluation, world-info.js:339)', () => {
        const first = findStKeyMatches('/o/g', 'foo', {});
        expect(first).toEqual([
          { start: 1, end: 2 },
          { start: 2, end: 3 },
        ]);
        expect(findStKeyMatches('/o/g', 'foo', {})).toEqual(first);
      });

      it('ignores case and whole-word options — regex flags govern (world-info.js:338-342)', () => {
        expect(
          findStKeyMatches('/rose/ig', 'x ROSE rose', {
            caseSensitive: true,
            matchWholeWords: true,
          }),
        ).toEqual([
          { start: 2, end: 6 },
          { start: 7, end: 11 },
        ]);
        // Without the g flag the same key yields its first match only; the
        // case option is never applied to the haystack either way.
        expect(findStKeyMatches('/rose/i', 'x ROSE rose', {})).toEqual([{ start: 2, end: 6 }]);
        expect(findStKeyMatches('/rose/', 'x ROSE rose', {})).toEqual([{ start: 7, end: 11 }]);
      });

      it('returns no ranges when the regex does not match', () => {
        expect(findStKeyMatches('/z/g', 'foo', {})).toEqual([]);
      });
    });

    describe('zero-length regex matches are skipped (no hang on /(?:)/g)', () => {
      it('advances past zero-length matches in a global scan', () => {
        expect(findStKeyMatches('/(?:)/g', 'abc', {})).toEqual([]);
      });

      it('reports nothing when the only (first) match is zero-length', () => {
        expect(findStKeyMatches('/(?:)/', 'abc', {})).toEqual([]);
      });

      it('keeps earlier ranges when zero-length candidates trail the scan', () => {
        // /a*/g on 'aa': 'aa' at 0, then only zero-length candidates remain —
        // each is skipped with lastIndex advanced, and the scan terminates.
        expect(findStKeyMatches('/a*/g', 'aa', {})).toEqual([{ start: 0, end: 2 }]);
      });

      it('returns no ranges when exec throws (defensive try/catch)', () => {
        const originalExec = RegExp.prototype.exec;
        // Only the key's own regex throws — parseStRegex's shape and slash
        // gates must keep working under the spy.
        const execSpy = vi
          .spyOn(RegExp.prototype, 'exec')
          .mockImplementation(function (this: RegExp, input: string) {
            if (this.source === 'needle') {
              throw new Error('synthetic exec failure');
            }
            return originalExec.call(this, input);
          });
        try {
          expect(findStKeyMatches('/needle/g', 'a needle', {})).toEqual([]);
        } finally {
          execSpy.mockRestore();
        }
      });
    });

    describe('whole-word single-word keys return the key span, not the boundaries (world-info.js:356)', () => {
      const OPTIONS: StMatchOptions = { matchWholeWords: true };

      it('excludes the consumed boundary characters from the span', () => {
        expect(findStKeyMatches('king', 'the king!', OPTIONS)).toEqual([{ start: 4, end: 8 }]);
        expect(findStKeyMatches('king', '!king,', OPTIONS)).toEqual([{ start: 1, end: 5 }]);
      });

      it('anchors at the text edges without inventing boundary characters', () => {
        expect(findStKeyMatches('king', 'king rules', OPTIONS)).toEqual([{ start: 0, end: 4 }]);
        expect(findStKeyMatches('king', 'king', OPTIONS)).toEqual([{ start: 0, end: 4 }]);
      });

      it('finds every whole-word occurrence', () => {
        expect(findStKeyMatches('king', 'king, a king; a kingdom', OPTIONS)).toEqual([
          { start: 0, end: 4 },
          { start: 8, end: 12 },
        ]);
      });

      it('returns no ranges when only substring occurrences exist', () => {
        expect(findStKeyMatches('king', 'kingdom my_king v2king', OPTIONS)).toEqual([]);
      });

      it('escapes regex metacharacters in the key (world-info.js:356)', () => {
        expect(findStKeyMatches('a.b', 'x a.b y', OPTIONS)).toEqual([{ start: 2, end: 5 }]);
        expect(findStKeyMatches('a.b', 'x axb y', OPTIONS)).toEqual([]);
      });

      it('case-folds before the boundary scan (world-info.js:345-346)', () => {
        expect(findStKeyMatches('KING', 'long live the KING!', OPTIONS)).toEqual([
          { start: 14, end: 18 },
        ]);
        expect(
          findStKeyMatches('KING', 'long live the king!', {
            caseSensitive: true,
            matchWholeWords: true,
          }),
        ).toEqual([]);
      });

      it('ports the empty-key/empty-haystack boundary quirk as a zero-length range', () => {
        // The oracle's `.test` accepts the zero-length boundary match, so the
        // boolean contract keeps it and the range view must agree.
        expect(findStKeyMatches('', '', { matchWholeWords: true })).toEqual([{ start: 0, end: 0 }]);
        expect(matchStKey('', '', { matchWholeWords: true })).toBe(true);
      });
    });

    describe('multi-word keys keep substring ranges (world-info.js:350-353)', () => {
      const OPTIONS: StMatchOptions = { matchWholeWords: true };

      it('returns every occurrence, including the inter-word space', () => {
        expect(findStKeyMatches('silver chair', 'the silver chair, indeed', OPTIONS)).toEqual([
          { start: 4, end: 16 },
        ]);
        expect(findStKeyMatches('a b', 'a b a b', OPTIONS)).toEqual([
          { start: 0, end: 3 },
          { start: 4, end: 7 },
        ]);
      });

      it('case-folds before scanning (world-info.js:345-346)', () => {
        expect(findStKeyMatches('Silver Chair', 'the SILVER CHAIR here', OPTIONS)).toEqual([
          { start: 4, end: 16 },
        ]);
      });
    });

    describe('default path: every substring occurrence (world-info.js:362)', () => {
      it('exposes half-open [start, end) spans', () => {
        const ranges: readonly StKeyMatchRange[] = findStKeyMatches('rose', 'a rose', {});
        const first: StKeyMatchRange | undefined = ranges[0];
        expect(first).toEqual({ start: 2, end: 6 });
      });

      it('returns exact-case spans only when case-sensitive', () => {
        expect(findStKeyMatches('Rose', 'a Rose and a rose', { caseSensitive: true })).toEqual([
          { start: 2, end: 6 },
        ]);
      });

      it('case-folds both sides by default (world-info.js:345-346)', () => {
        expect(findStKeyMatches('rose', 'a Rose and a ROSE', {})).toEqual([
          { start: 2, end: 6 },
          { start: 13, end: 17 },
        ]);
        expect(findStKeyMatches('ROSE', 'a Rose and a ROSE', {})).toEqual([
          { start: 2, end: 6 },
          { start: 13, end: 17 },
        ]);
      });

      it('null options resolve to ST defaults like matchStKey (world-info.js:77-78)', () => {
        expect(
          findStKeyMatches('rose', 'a ROSE', { caseSensitive: null, matchWholeWords: null }),
        ).toEqual([{ start: 2, end: 6 }]);
      });

      it('treats an empty key as matching at every index, like includes(\'\')', () => {
        expect(findStKeyMatches('', 'ab', {})).toEqual([
          { start: 0, end: 0 },
          { start: 1, end: 1 },
          { start: 2, end: 2 },
        ]);
      });

      it('returns no ranges when nothing matches', () => {
        expect(findStKeyMatches('rose', 'a lily', {})).toEqual([]);
      });
    });

    describe('invalid-regex keys fall back to plaintext ranges (world-info.js:339-345)', () => {
      it('matches the raw key string, slashes included', () => {
        expect(findStKeyMatches('/(saber/', 'the /(saber/ key', {})).toEqual([
          { start: 4, end: 12 },
        ]);
        expect(findStKeyMatches('/a/b/', 'x /a/b/ y', {})).toEqual([{ start: 2, end: 7 }]);
      });

      it('honors case and whole-word options on the fallback, like matchStKey', () => {
        expect(findStKeyMatches('/(saber/', 'THE /(SABER/ KEY', {})).toEqual([
          { start: 4, end: 12 },
        ]);
        expect(findStKeyMatches('/(saber/', 'THE /(SABER/ KEY', { caseSensitive: true })).toEqual(
          [],
        );
        expect(findStKeyMatches('/(saber/', 'x /(saber/ y', { matchWholeWords: true })).toEqual([
          { start: 2, end: 10 },
        ]);
      });

      it('returns no ranges when the literal key is absent', () => {
        expect(findStKeyMatches('/(saber/', 'saber appears without delimiters', {})).toEqual([]);
      });
    });

    describe('caps (Task 04 §3.1: 5,000-char text cap, 500-range cap)', () => {
      it('caps the evaluated text at 5,000 characters — matches past the cap vanish', () => {
        const inside = 'needle'.repeat(100); // 600 chars
        const beyond = 'x'.repeat(5000) + 'needle';
        expect(findStKeyMatches('needle', inside, {}).length).toBe(100);
        expect(findStKeyMatches('needle', beyond, {})).toEqual([]);
        expect(findStKeyMatches('/needle/g', inside, {}).length).toBe(100);
        expect(findStKeyMatches('/needle/g', beyond, {})).toEqual([]);
      });

      it('still reports a match that ends exactly at the cap', () => {
        const text = 'x'.repeat(4994) + 'needle'; // ends at index 5,000
        expect(findStKeyMatches('needle', text, {})).toEqual([{ start: 4994, end: 5000 }]);
      });

      it('caps plaintext ranges at 500 per key', () => {
        const ranges = findStKeyMatches('ab', 'ab'.repeat(600), {});
        expect(ranges.length).toBe(500);
        expect(ranges[0]).toEqual({ start: 0, end: 2 });
        expect(ranges[499]).toEqual({ start: 998, end: 1000 });
      });

      it('caps regex ranges at 500 per key', () => {
        const ranges = findStKeyMatches('/ab/g', 'ab'.repeat(600), {});
        expect(ranges.length).toBe(500);
        expect(ranges[0]).toEqual({ start: 0, end: 2 });
        expect(ranges[499]).toEqual({ start: 998, end: 1000 });
      });

      it('caps whole-word ranges at 500 per key', () => {
        // Two-space separators: each boundary match consumes the leading and
        // trailing spaces, so occurrences land every 4 characters — 501 fit
        // in 2004 chars, one past the cap.
        const ranges = findStKeyMatches('ab', 'ab  '.repeat(501), { matchWholeWords: true });
        expect(ranges.length).toBe(500);
        expect(ranges[0]).toEqual({ start: 0, end: 2 });
        expect(ranges[499]).toEqual({ start: 1996, end: 1998 });
      });

      it('does not cap when the text holds exactly 500 occurrences', () => {
        expect(findStKeyMatches('ab', 'ab'.repeat(500), {}).length).toBe(500);
      });
    });

    it('agrees with matchStKey: ranges exist exactly when the key matches', () => {
      // Divergence is documented and intended only for zero-length matches.
      const CASES: readonly [key: string, text: string, options: StMatchOptions][] = [
        ['king', 'the king!', { matchWholeWords: true }],
        ['king', 'kingdom', { matchWholeWords: true }],
        ['rose', 'a ROSE', { caseSensitive: true }],
        ['/(saber/', 'the /(saber/ key', {}],
        ['/rose/i', 'a ROSE', {}],
        ['/z/', 'a rose', {}],
      ];
      for (const [key, text, options] of CASES) {
        expect(findStKeyMatches(key, text, options).length > 0).toBe(matchStKey(key, text, options));
      }
    });
  });
});
