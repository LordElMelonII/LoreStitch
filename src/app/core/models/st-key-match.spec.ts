import { matchStKey, type StMatchOptions } from './st-key-match';

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
    const CASES: readonly [key: string, text: string, caseSensitive: boolean | null, expected: boolean][] = [
      ['rose', 'the Rose grew', true, false],
      ['Rose', 'the Rose grew', true, true],
      ['ROSE', 'the ROSE grew', true, true],
      ['rose', 'the ROSE grew', null, true],
      ['rose', 'the rose grew', false, true],
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
      expect(matchStKey('KING', 'long live the king', { caseSensitive: true, matchWholeWords: true })).toBe(false);
      expect(matchStKey('KING', 'long live the KING', { caseSensitive: true, matchWholeWords: true })).toBe(true);
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
      expect(matchStKey('Silver Chair', 'the Silver Chair', { caseSensitive: true, matchWholeWords: true })).toBe(true);
      expect(matchStKey('Silver Chair', 'the silver chair', { caseSensitive: true, matchWholeWords: true })).toBe(false);
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

    it('an empty plaintext key matches everything via includes when whole words are off', () => {
      expect(matchStKey('', 'anything', { matchWholeWords: false })).toBe(true);
      expect(matchStKey('', '', {})).toBe(true);
    });

    it('an empty key fails the whole-word boundary pattern (world-info.js:356)', () => {
      expect(matchStKey('', 'anything', { matchWholeWords: true })).toBe(false);
    });

    it('null options behave exactly like unset options (ST defaults false, world-info.js:77-78)', () => {
      expect(matchStKey('rose', 'the ROSE grew', { caseSensitive: null, matchWholeWords: null })).toBe(true);
      expect(matchStKey('king', "it's not to my liking", { caseSensitive: null, matchWholeWords: null })).toBe(true);
      expect(matchStKey('king', "it's not to my liking", { caseSensitive: null, matchWholeWords: true })).toBe(false);
    });
  });

  describe('regex keys override the options (world-info.js:338-342)', () => {
    const CASES: readonly [key: string, text: string, options: StMatchOptions, expected: boolean][] = [
      // Regex wins even when case-sensitive/whole-word would reject the text.
      ['/rose/i', 'ROSE', { caseSensitive: true, matchWholeWords: true }, true],
      // Whole-word plaintext would reject 'kingdom'; the raw regex still hits.
      ['/king/', 'kingdom', { matchWholeWords: true }, true],
      // Regex flags govern case; the case option is never applied to the haystack.
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

    it('tests regex keys before any case folding of the haystack', () => {
      // 'ROSE' folded would be 'rose'; the raw /rose/ without the i flag
      // must still fail -> the haystack was never folded.
      expect(matchStKey('/rose/', 'ROSE', { caseSensitive: false, matchWholeWords: false })).toBe(false);
    });
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
});
