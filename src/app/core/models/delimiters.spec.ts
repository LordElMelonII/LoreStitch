import {
  DELIMITER_STYLE_OPTIONS,
  delimiterLabel,
  delimiterNameMatches,
  detectDelimiter,
  entryDelimiterName,
  entryDelimiterNameFromKey,
  rewrapContent,
  sanitizeDelimiterName,
  unwrapContent,
  wrapContent,
  type DelimiterStyle,
} from './delimiters';
import {
  characterBookToStNative,
  createEmptyBook,
  createEmptyEntry,
  stNativeToCharacterBook,
  type SillyTavernWorldInfo,
} from './lorebook.model';
import {
  computeTokenFootprint,
  estimateEntryTokens,
  estimateTokens,
} from '../services/token-estimator';

const LONDON = 'London is a city full of people.';

/** Styles that emit a wrapper. */
const WRAPPING_STYLES = ['tag', 'bracket', 'separator'] as const;

/** Every style, including the strip-only `'none'`. */
const ALL_STYLES: readonly DelimiterStyle[] = ['tag', 'bracket', 'separator', 'none'];

/** Inputs a blank-payload no-op must return unchanged. */
const BLANK_INPUTS: readonly string[] = ['', '   ', '\n', '\r\n \t'];

/**
 * Payloads that must survive `wrap -> unwrap` byte-for-byte, including
 * padding, CRLF, quotes, wrapper syntax, regex metacharacters and
 * Unicode/emoji/CJK. Payloads ending in newlines are style-specific and are
 * covered separately below.
 */
const ROUND_TRIP_INPUTS: readonly string[] = [
  'plain prose',
  '  leading and trailing  ',
  '\ttabs\t',
  'line\nbreak',
  'crlf\r\nline',
  'cr\rline',
  'leading newline\nlead',
  '"quotes" and \'apostrophes\'',
  '<angle> [bracket] =equals=',
  'regex *+?|{}()^$\\',
  '<!-- lore -->',
  '---',
  '日本語のテキスト',
  'emoji 😀🧪',
];

const ROUND_TRIP_NAME = 'London';

/** Inputs for which re-applying a rewrap is a fixed point in every style. */
const IDEMPOTENCE_INPUTS: readonly string[] = [
  'plain prose',
  '  padded  ',
  '---',
  'prose\n---',
  'prose\n\n---',
  '<N>\nprose\n</N>',
  '<N>\r\nprose\r\n</N>',
  '  <N>prose</N>  ',
  '[N=\nprose]',
  '<Old>\nprose\n</Old>',
  '<foo>x</bar>',
  '<tag>unclosed',
];

describe('delimiters', () => {
  describe('detectDelimiter', () => {
    it('recognizes plain content as none', () => {
      expect(detectDelimiter(LONDON)).toEqual({ style: 'none', name: '' });
    });

    it('recognizes <Name> tags', () => {
      const content = `<London>\n${LONDON}\n</London>`;
      expect(detectDelimiter(content)).toEqual({ style: 'tag', name: 'London' });
    });

    it('recognizes single-line tags', () => {
      expect(detectDelimiter('<London>London</London>')).toEqual({
        style: 'tag',
        name: 'London',
      });
    });

    it('trims the detected name', () => {
      expect(detectDelimiter('< London >content</ London >')).toEqual({
        style: 'tag',
        name: 'London',
      });
    });

    it('recognizes [Name=… brackets', () => {
      const content = `[London=\n${LONDON}]`;
      expect(detectDelimiter(content)).toEqual({ style: 'bracket', name: 'London' });
    });

    it('recognizes a trailing --- separator', () => {
      expect(detectDelimiter(`${LONDON}\n\n---`)).toEqual({ style: 'separator', name: '' });
      expect(detectDelimiter(`${LONDON}\n---`)).toEqual({ style: 'separator', name: '' });
    });

    it('does not mistake a mid-text --- for a trailing separator', () => {
      expect(detectDelimiter(`${LONDON}\n---\nMore text`)).toEqual({ style: 'none', name: '' });
    });

    it('does not treat a bare separator as a wrapper', () => {
      expect(detectDelimiter('---')).toEqual({ style: 'none', name: '' });
    });

    it('does not detect mismatched or unclosed tags', () => {
      expect(detectDelimiter('<foo>x</bar>')).toEqual({ style: 'none', name: '' });
      expect(detectDelimiter('<tag>unclosed')).toEqual({ style: 'none', name: '' });
    });
  });

  describe('sanitizeDelimiterName', () => {
    const SANITIZE_CASES: readonly [input: string, expected: string][] = [
      ['', ''],
      ['London', 'London'],
      ['  London  ', 'London'],
      ['<River> = [Thames]', 'River Thames'],
      ['a\nb\rc', 'a b c'],
      ['a\t\t b', 'a b'],
      ['"quoted"', '"quoted"'],
      ["'quoted'", "'quoted'"],
      ['a*+?|{}()^$.\\', 'a*+?|{}()^$.\\'],
      ['日本語', '日本語'],
      ['😀🧪', '😀🧪'],
    ];

    for (const [input, expected] of SANITIZE_CASES) {
      it(`normalizes ${JSON.stringify(input)}`, () => {
        expect(sanitizeDelimiterName(input)).toBe(expected);
      });
    }

    it('caps names at 80 code points', () => {
      expect(sanitizeDelimiterName('a'.repeat(85))).toBe('a'.repeat(80));
    });

    it('does not split a surrogate pair at the 80 code point cap', () => {
      const sanitized = sanitizeDelimiterName(`${'a'.repeat(79)}😀-tail`);
      expect(sanitized).toBe(`${'a'.repeat(79)}😀`);
      expect([...sanitized]).toHaveLength(80);
    });

    it('caps emoji names by code points, not UTF-16 units', () => {
      expect(sanitizeDelimiterName('😀'.repeat(100))).toBe('😀'.repeat(80));
    });
  });

  describe('wrapContent', () => {
    it('wraps in tags using the user example format', () => {
      expect(wrapContent(LONDON, 'tag', 'London')).toBe(`<London>\n${LONDON}\n</London>`);
    });

    it('wraps in brackets using the user example format', () => {
      expect(wrapContent(LONDON, 'bracket', 'London')).toBe(`[London=\n${LONDON}]`);
    });

    it('appends a dashed separator', () => {
      expect(wrapContent(LONDON, 'separator')).toBe(`${LONDON}\n\n---`);
    });

    it('falls back to a generic name when none is given', () => {
      expect(wrapContent(LONDON, 'tag')).toBe(`<entry>\n${LONDON}\n</entry>`);
    });

    it('keeps blank payloads unchanged for every style (D5)', () => {
      for (const style of WRAPPING_STYLES) {
        for (const blank of BLANK_INPUTS) {
          expect(wrapContent(blank, style, 'N')).toBe(blank);
        }
      }
    });

    it('never emits phantom wrappers for blank payloads', () => {
      expect(wrapContent('   ', 'tag', 'N')).not.toContain('<');
      expect(wrapContent('   ', 'separator', 'N')).not.toContain('---');
    });

    it('keeps a bare separator marker unchanged (D1)', () => {
      expect(wrapContent('---', 'separator', 'N')).toBe('---');
      expect(wrapContent('  ---  ', 'separator', 'N')).toBe('  ---  ');
    });

    it('embeds the payload verbatim (no trim)', () => {
      expect(wrapContent('  hi  ', 'tag', 'N')).toBe('<N>\n  hi  \n</N>');
      expect(wrapContent('  hi  ', 'bracket', 'N')).toBe('[N=\n  hi  ]');
      expect(wrapContent('  hi  ', 'separator', 'N')).toBe('  hi  \n\n---');
    });

    it('sanitizes wrapper names that would break the syntax (D3)', () => {
      expect(wrapContent('x', 'tag', 'a<b>')).toBe('<a b>\nx\n</a b>');
      expect(wrapContent('x', 'bracket', 'a=b]')).toBe('[a b=\nx]');
      expect(wrapContent('x', 'tag', '<<>>')).toBe('<entry>\nx\n</entry>');
    });

    it('passes quotes, regex metacharacters and Unicode names through', () => {
      expect(wrapContent('x', 'tag', '"a*+?"')).toBe('<"a*+?">\nx\n</"a*+?">');
      expect(wrapContent('x', 'tag', '日本語')).toBe('<日本語>\nx\n</日本語>');
    });

    it('treats comment-only prose as payload', () => {
      expect(wrapContent('<!-- lore -->', 'tag', 'N')).toBe('<N>\n<!-- lore -->\n</N>');
    });
  });

  describe('unwrapContent', () => {
    it('returns the inner content for every style', () => {
      expect(unwrapContent(`<London>\n${LONDON}\n</London>`)).toBe(LONDON);
      expect(unwrapContent(`[London=\n${LONDON}]`)).toBe(LONDON);
      expect(unwrapContent(`${LONDON}\n\n---`)).toBe(LONDON);
    });

    it('leaves undelimited content untouched', () => {
      expect(unwrapContent(LONDON)).toBe(LONDON);
    });

    it('returns blank input unchanged', () => {
      for (const blank of BLANK_INPUTS) {
        expect(unwrapContent(blank)).toBe(blank);
      }
    });

    it('does not treat a bare separator as a wrapper', () => {
      expect(unwrapContent('---')).toBe('---');
    });

    it('captures the payload verbatim (no trim, D2)', () => {
      expect(unwrapContent('<N>\n  hi  \n</N>')).toBe('  hi  ');
      expect(unwrapContent('[N=\n  hi  ]')).toBe('  hi  ');
      expect(unwrapContent('  hi  \n\n---')).toBe('  hi  ');
    });

    it('unwraps asymmetric bracket syntax verbatim', () => {
      expect(unwrapContent('[London=\nCity text]')).toBe('City text');
      expect(unwrapContent('[London=City text]')).toBe('City text');
    });

    it('unwraps suffix-only separators', () => {
      expect(unwrapContent('prose\n---')).toBe('prose');
      expect(unwrapContent('prose\n\n---')).toBe('prose');
    });

    it('leaves mismatched and unclosed tags untouched', () => {
      expect(unwrapContent('<foo>x</bar>')).toBe('<foo>x</bar>');
      expect(unwrapContent('<tag>unclosed')).toBe('<tag>unclosed');
    });

    it('strips only a name-matching wrapper when expectedNames is given (D4)', () => {
      expect(unwrapContent('<note>prose</note>', { expectedNames: ['N'] })).toBe(
        '<note>prose</note>',
      );
      expect(unwrapContent('<N>prose</N>', { expectedNames: ['N'] })).toBe('prose');
      expect(unwrapContent('<london>x</london>', { expectedNames: ['London'] })).toBe('x');
      expect(unwrapContent('[London=\nx]', { expectedNames: ['london'] })).toBe('x');
    });

    it('keeps a trailing separator when the caller names wrappers', () => {
      expect(unwrapContent('prose\n\n---', { expectedNames: ['N'] })).toBe('prose\n\n---');
      expect(unwrapContent('prose\n\n---', { expectedNames: ['N'], stripSeparator: true })).toBe(
        'prose',
      );
    });

    it('keeps a separator when stripSeparator is explicitly false', () => {
      expect(unwrapContent('prose\n\n---', { stripSeparator: false })).toBe('prose\n\n---');
    });

    it('strips a separator by default when no names are given (legacy)', () => {
      expect(unwrapContent('prose\n\n---')).toBe('prose');
    });

    it('strips only the outermost wrapper in a single pass', () => {
      expect(unwrapContent('<N>\nprose\n\n---\n</N>', { expectedNames: ['N'] })).toBe(
        'prose\n\n---',
      );
    });
  });

  describe('delimiterNameMatches', () => {
    it('matches names case-insensitively', () => {
      expect(delimiterNameMatches('london', ['London'])).toBe(true);
      expect(delimiterNameMatches('London', ['london', 'Paris'])).toBe(true);
    });

    it('matches names after sanitization', () => {
      expect(delimiterNameMatches('a=b', ['a[b'])).toBe(true);
      expect(delimiterNameMatches('<River>=', ['River'])).toBe(true);
    });

    it('rejects names that do not match', () => {
      expect(delimiterNameMatches('note', ['N'])).toBe(false);
      expect(delimiterNameMatches('note', [])).toBe(false);
    });
  });

  describe('rewrapContent', () => {
    it('changes between styles, stripping the old wrapper', () => {
      const tagged = `<London>\n${LONDON}\n</London>`;
      expect(rewrapContent(tagged, 'bracket', 'London')).toBe(`[London=\n${LONDON}]`);
      expect(rewrapContent(tagged, 'separator')).toBe(`${LONDON}\n\n---`);
    });

    it('removes delimiters with none', () => {
      expect(rewrapContent(`[London=\n${LONDON}]`, 'none')).toBe(LONDON);
    });

    it('is idempotent when re-applying the same style', () => {
      const tagged = `<London>\n${LONDON}\n</London>`;
      expect(rewrapContent(tagged, 'tag', 'London')).toBe(tagged);
    });

    it('keeps blank payloads unchanged for every style', () => {
      for (const style of ALL_STYLES) {
        for (const blank of BLANK_INPUTS) {
          expect(rewrapContent(blank, style, 'N', ['N'])).toBe(blank);
        }
      }
      expect(rewrapContent('   ', 'separator')).toBe('   ');
    });

    it('keeps a bare separator marker unchanged (D1 regression)', () => {
      expect(rewrapContent('---', 'separator')).toBe('---');
      expect(rewrapContent('---', 'separator', 'N', ['N'])).toBe('---');
    });

    it('keeps canonical separator content byte-identical', () => {
      expect(rewrapContent('prose\n\n---', 'separator', 'N', ['N'])).toBe('prose\n\n---');
    });

    it('canonicalizes a suffix-only separator exactly once', () => {
      expect(rewrapContent('prose\n---', 'separator', 'N', ['N'])).toBe('prose\n\n---');
    });

    it('keeps a matching tag wrapper byte-identical', () => {
      expect(rewrapContent('<N>\nprose\n</N>', 'tag', 'N', ['N'])).toBe('<N>\nprose\n</N>');
    });

    it('strips a tag wrapper case-insensitively and re-wraps canonically', () => {
      expect(rewrapContent('<london>x</london>', 'tag', 'London', ['London'])).toBe(
        '<London>\nx\n</London>',
      );
    });

    it('wraps additively around a non-matching wrapper (D4)', () => {
      expect(rewrapContent('<Old>\nprose\n</Old>', 'tag', 'N', ['N'])).toBe(
        '<N>\n<Old>\nprose\n</Old>\n</N>',
      );
    });

    it('does not strip a non-matching wrapper for none (D4)', () => {
      expect(rewrapContent('<note>prose</note>', 'none', 'N', ['N'])).toBe('<note>prose</note>');
    });

    it('strips a matching tag wrapper for none', () => {
      expect(rewrapContent('<N>\nprose\n</N>', 'none', 'N', ['N'])).toBe('prose');
    });

    it('strips a detected separator for none (explicit removal)', () => {
      expect(rewrapContent('prose\n\n---', 'none', 'N', ['N'])).toBe('prose');
    });

    it('preserves a trailing separator as payload when wrapping', () => {
      expect(rewrapContent('prose\n\n---', 'tag', 'N', ['N'])).toBe('<N>\nprose\n\n---\n</N>');
      expect(rewrapContent('prose\n\n---', 'bracket', 'N', ['N'])).toBe('[N=\nprose\n\n---]');
    });

    it('strips only the outer tag in a single pass', () => {
      expect(rewrapContent('<N>\nprose\n\n---\n</N>', 'none', 'N', ['N'])).toBe('prose\n\n---');
      expect(rewrapContent('<N>\nprose\n\n---\n</N>', 'tag', 'N', ['N'])).toBe(
        '<N>\nprose\n\n---\n</N>',
      );
    });

    it('wraps malformed markup additively without truncating', () => {
      expect(rewrapContent('<foo>x</bar>', 'tag', 'N', ['N'])).toBe('<N>\n<foo>x</bar>\n</N>');
      expect(rewrapContent('<tag>unclosed', 'tag', 'N', ['N'])).toBe('<N>\n<tag>unclosed\n</N>');
    });

    it('keeps a padded payload byte-for-byte', () => {
      expect(rewrapContent('  hi  ', 'tag', 'N', ['N'])).toBe('<N>\n  hi  \n</N>');
    });

    it('matches wrapper names after sanitization', () => {
      expect(delimiterNameMatches('a=b', ['a[b'])).toBe(true);
      expect(unwrapContent('<a=b>x</a=b>', { expectedNames: ['a=b'] })).toBe('x');
      // The re-wrapped name is the sanitized target (`a[b` -> `a b`) while the
      // payload itself stays byte-identical.
      expect(rewrapContent('<a=b>x</a=b>', 'tag', 'a[b', ['a=b'])).toBe('<a b>\nx\n</a b>');
    });

    it('canonicalizes CRLF and padded already-wrapped content', () => {
      expect(rewrapContent('<N>\r\nprose\r\n</N>', 'tag', 'N', ['N'])).toBe('<N>\nprose\n</N>');
      expect(rewrapContent('  <N>prose</N>  ', 'tag', 'N', ['N'])).toBe('<N>\nprose\n</N>');
      expect(rewrapContent('<N>prose</N>', 'tag', 'N', ['N'])).toBe('<N>\nprose\n</N>');
    });

    it('treats undelimited content as identity for none', () => {
      expect(rewrapContent('plain prose', 'none', 'N', ['N'])).toBe('plain prose');
    });

    it('removes a separator explicitly when no names are given (legacy)', () => {
      expect(rewrapContent('prose\n\n---', 'none')).toBe('prose');
    });

    it('separator round-trips bodies without a trailing blank line', () => {
      for (const input of ['plain prose', '  padded  ', 'line\nbreak']) {
        expect(unwrapContent(wrapContent(input, 'separator'))).toBe(input);
      }
      // A bare separator marker is already canonical; it stays as-is rather
      // than being unwrapped (D1).
      expect(wrapContent('---', 'separator')).toBe('---');
      expect(unwrapContent(wrapContent('---', 'separator'))).toBe('---');
    });

    it('does not claim a byte round-trip for bodies ending in a blank line', () => {
      // A payload that itself ends with a blank line merges with the separator
      // marker (`body\n\n` + `\n\n---` cannot be told apart from a single
      // separator run). The ambiguity is pinned, not silent: the marker is
      // consumed and one trailing blank line survives.
      expect(unwrapContent(wrapContent('trailing blank\n\n', 'separator'))).toBe(
        'trailing blank\n\n',
      );
    });

    for (const style of ALL_STYLES) {
      it(`is a fixed point when re-applied twice for '${style}'`, () => {
        for (const input of IDEMPOTENCE_INPUTS) {
          const once = rewrapContent(input, style, 'N', ['N']);
          expect(rewrapContent(once, style, 'N', ['N'])).toBe(once);
        }
      });
    }

    it('keeps rewrap a fixed point when the payload ends with a separator', () => {
      const input = '<N>\nprose\n\n---\n</N>';
      for (const style of WRAPPING_STYLES) {
        const once = rewrapContent(input, style, 'N', ['N']);
        expect(rewrapContent(once, style, 'N', ['N'])).toBe(once);
      }
    });
  });

  describe('wrap -> unwrap round trip', () => {
    for (const style of WRAPPING_STYLES) {
      it(`preserves hostile payloads byte-for-byte with '${style}'`, () => {
        for (const input of ROUND_TRIP_INPUTS) {
          const wrapped = wrapContent(input, style, ROUND_TRIP_NAME);
          if (style === 'separator') {
            // `separator` appends a marker, so unwrapping with a name (which
            // keeps separators) is intentionally not a round trip; the
            // canonical separator round-trip tests cover this style.
            expect(unwrapContent(wrapped)).toBe(input);
            continue;
          }
          expect(unwrapContent(wrapped, { expectedNames: [ROUND_TRIP_NAME] })).toBe(input);
        }
      });
    }

    it('preserves payloads ending in newlines for tag', () => {
      // A trailing lone `\r` is indistinguishable from a CRLF wrapper newline
      // under the pinned regexes; only CRLF/`\n` suffixes are claimed here.
      for (const input of ['trailing newline\n', 'trailing crlf\r\n', 'trailing blank\n\n']) {
        const wrapped = wrapContent(input, 'tag', ROUND_TRIP_NAME);
        expect(unwrapContent(wrapped, { expectedNames: [ROUND_TRIP_NAME] })).toBe(input);
      }
    });

    it('round-trips the tag cycle around a bare separator marker', () => {
      expect(unwrapContent('---', { expectedNames: [ROUND_TRIP_NAME] })).toBe('---');
      expect(rewrapContent('---', 'tag', ROUND_TRIP_NAME, [ROUND_TRIP_NAME])).toBe(
        '<London>\n---\n</London>',
      );
      expect(unwrapContent('<London>\n---\n</London>', { expectedNames: [ROUND_TRIP_NAME] })).toBe(
        '---',
      );
    });

    it('round-trips blank payloads as-is', () => {
      for (const style of WRAPPING_STYLES) {
        for (const blank of BLANK_INPUTS) {
          const wrapped = wrapContent(blank, style, ROUND_TRIP_NAME);
          expect(unwrapContent(wrapped, { expectedNames: [ROUND_TRIP_NAME] })).toBe(blank);
        }
      }
    });
  });

  describe('nested collisions', () => {
    it('does not strip wrapper-syntax prose unless the name matches', () => {
      expect(unwrapContent('<note>x</note>', { expectedNames: ['N'] })).toBe('<note>x</note>');
      expect(unwrapContent('<note>x</note>', { expectedNames: ['note'] })).toBe('x');
      expect(rewrapContent('<note>x</note>', 'none', 'N', ['N'])).toBe('<note>x</note>');
    });

    it('preserves [x=] inside a matching bracket wrapper', () => {
      expect(unwrapContent('[N=\na[x=]b]', { expectedNames: ['N'] })).toBe('a[x=]b');
      expect(rewrapContent('[N=\na[x=]b]', 'bracket', 'N', ['N'])).toBe('[N=\na[x=]b]');
    });

    it('preserves a trailing --- inside a tag payload', () => {
      expect(unwrapContent('<N>\nprose\n\n---\n</N>', { expectedNames: ['N'] })).toBe(
        'prose\n\n---',
      );
      expect(rewrapContent('<N>\nprose\n\n---\n</N>', 'tag', 'N', ['N'])).toBe(
        '<N>\nprose\n\n---\n</N>',
      );
    });
  });

  describe('token accounting sync', () => {
    const body = 'A'.repeat(400);
    const wrapped = wrapContent(body, 'tag', 'London');

    it('counts the baked wrapper overhead in estimateTokens', () => {
      expect(estimateTokens(body)).toBe(100);
      expect(wrapped).toBe(`<London>\n${body}\n</London>`);
      expect(estimateTokens(wrapped)).toBe(105);
      expect(estimateTokens(wrapped) - estimateTokens(body)).toBe(5);
    });

    it('counts baked delimiters in the always-active footprint', () => {
      const entry = createEmptyEntry(1);
      entry.content = wrapped;
      entry.constant = true;
      const book = createEmptyBook('Footprint');
      book.entries = [entry];

      const footprint = computeTokenFootprint(book);
      expect(footprint.constantCount).toBe(1);
      expect(footprint.totalTokens).toBe(estimateTokens(wrapped));
      expect(footprint.items[0]?.tokens).toBe(estimateTokens(wrapped));
    });

    it('estimateEntryTokens equals the estimate of the stored content', () => {
      const entry = createEmptyEntry(1);
      entry.content = wrapped;
      expect(estimateEntryTokens(entry)).toBe(estimateTokens(entry.content));
      expect(estimateEntryTokens(entry)).toBe(105);
    });
  });

  describe('converter round trip', () => {
    const ORIGINAL = '  City <london> [note=] --- 😀  ';

    function buildBook() {
      const entry = createEmptyEntry(1, 0);
      entry.comment = 'London';
      entry.keys = ['london'];
      entry.constant = true;
      entry.content = wrapContent(ORIGINAL, 'tag', 'London');
      entry.extensions = { ...entry.extensions, vendor_extra: { a: 1 } };
      const book = createEmptyBook('Round trip');
      book.entries = [entry];
      return book;
    }

    it('preserves wrapped content and vendor extensions through the uid-keyed bag', () => {
      const native = characterBookToStNative(buildBook());
      const parsed = JSON.parse(JSON.stringify(native)) as SillyTavernWorldInfo;
      const reimported = stNativeToCharacterBook(parsed);
      const entry = reimported.entries[0];
      assert(entry);
      expect(entry.content).toBe(wrapContent(ORIGINAL, 'tag', 'London'));
      expect(unwrapContent(entry.content, { expectedNames: ['London'] })).toBe(ORIGINAL);
      expect(entry.extensions['vendor_extra']).toEqual({ a: 1 });
      expect(characterBookToStNative(reimported).entries['1']?.['vendor_extra']).toEqual({ a: 1 });
    });

    it('preserves wrapped content through the bare-array native shape', () => {
      const native = characterBookToStNative(buildBook());
      const bare = { ...native, entries: Object.values(native.entries) };
      const parsed = JSON.parse(JSON.stringify(bare)) as SillyTavernWorldInfo;
      const reimported = stNativeToCharacterBook(parsed, 'Bare');
      const entry = reimported.entries[0];
      assert(entry);
      expect(unwrapContent(entry.content, { expectedNames: ['London'] })).toBe(ORIGINAL);
      expect(entry.extensions['vendor_extra']).toEqual({ a: 1 });
    });

    it('parks unknown native import keys in extensions and writes them back', () => {
      const native = characterBookToStNative(buildBook());
      const exported = native.entries['1'];
      assert(exported);
      exported['color'] = '#ff00ff';

      const reimported = stNativeToCharacterBook(native);
      const entry = reimported.entries[0];
      assert(entry);
      expect(entry.extensions['color']).toBe('#ff00ff');
      expect(characterBookToStNative(reimported).entries['1']?.['color']).toBe('#ff00ff');
    });
  });

  describe('entryDelimiterName', () => {
    it('prefers comment, then name, then first key', () => {
      expect(entryDelimiterName({ comment: 'London', keys: ['london'] })).toBe('London');
      expect(entryDelimiterName({ comment: ' ', name: 'Fuyuki', keys: ['fuyuki'] })).toBe('Fuyuki');
      expect(entryDelimiterName({ keys: ['fuyuki', 'city'] })).toBe('fuyuki');
    });

    it('sanitizes characters that would break the wrapper', () => {
      expect(entryDelimiterName({ comment: '<River> = [Thames]' })).toBe('River Thames');
      expect(entryDelimiterName({ comment: '' })).toBe('entry');
    });

    it('applies the 80-code-point sanitizer cap', () => {
      expect(entryDelimiterName({ comment: '😀'.repeat(100) })).toBe('😀'.repeat(80));
    });
  });

  describe('entryDelimiterNameFromKey', () => {
    it('uses the first non-empty primary key', () => {
      expect(entryDelimiterNameFromKey({ comment: 'London', keys: ['fuyuki', 'city'] })).toBe(
        'fuyuki',
      );
      expect(entryDelimiterNameFromKey({ keys: ['', 'city'] })).toBe('city');
    });

    it('falls back to the default name resolution when there are no keys', () => {
      expect(entryDelimiterNameFromKey({ comment: 'London', keys: [] })).toBe('London');
      expect(entryDelimiterNameFromKey({ comment: '' })).toBe('entry');
    });

    it('sanitizes keys that would break the wrapper', () => {
      expect(entryDelimiterNameFromKey({ keys: ['<River>'] })).toBe('River');
    });
  });

  describe('metadata', () => {
    it('labels detected delimiters for badges', () => {
      expect(delimiterLabel({ style: 'tag', name: 'London' })).toBe('<London>');
      expect(delimiterLabel({ style: 'bracket', name: 'London' })).toBe('[London=…]');
      expect(delimiterLabel({ style: 'separator', name: '' })).toBe('---');
      expect(delimiterLabel({ style: 'none', name: '' })).toBe('');
    });

    it('exposes every style as a selectable option', () => {
      expect(DELIMITER_STYLE_OPTIONS.map((o) => o.value)).toEqual([
        'tag',
        'bracket',
        'separator',
        'none',
      ]);
    });
  });
});
