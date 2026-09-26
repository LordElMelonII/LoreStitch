import {
  DELIMITER_STYLE_OPTIONS,
  delimiterLabel,
  delimiterNameMatches,
  detectDelimiter,
  detectMalformedWrapper,
  entryDelimiterName,
  entryDelimiterNameFromKey,
  malformedWrapperLabel,
  rewrapContent,
  sanitizeDelimiterName,
  stripMalformedWrapper,
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
const WRAPPING_STYLES = ['tag', 'bracket', 'markdown', 'separator'] as const;

/** Every style, including the strip-only `'none'`. */
const ALL_STYLES: readonly DelimiterStyle[] = ['tag', 'bracket', 'markdown', 'separator', 'none'];

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
  '## N\n\nprose',
  '## N\nprose',
  '## N\n\nprose\n\n---',
  '## Old\n\nprose',
  '## Old\n\nprose\n\n---',
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

    // --- Task-01 deferral migration -------------------------------------
    // Task 01 deferred the markdown style and treated header-led content as
    // ordinary payload under the nested-collisions rules
    // (next_tasks/archive/01-delimiters-edge-cases.md §3.1). These pins
    // migrate that deferral to the §4.2 contract: a well-formed ATX header
    // classifies `markdown` instead of `none`, and header-led content with a
    // trailing `---` classifies `markdown` instead of `separator`.

    it('recognizes a canonical ## heading wrapper', () => {
      // Old (task-01 deferral): `{ style: 'none', name: '' }`, label `''`.
      expect(detectDelimiter(`## London\n\n${LONDON}`)).toEqual({
        style: 'markdown',
        name: 'London',
        level: 2,
      });
    });

    it('recognizes a tight heading wrapper (no structural blank line)', () => {
      expect(detectDelimiter(`## London\n${LONDON}`)).toEqual({
        style: 'markdown',
        name: 'London',
        level: 2,
      });
    });

    it('recognizes CRLF heading wrappers like LF ones', () => {
      expect(detectDelimiter(`## London\r\n\r\n${LONDON}`)).toEqual({
        style: 'markdown',
        name: 'London',
        level: 2,
      });
    });

    it('recognizes every heading level 1-6', () => {
      for (const level of [1, 2, 3, 4, 5, 6] as const) {
        const hashes = '#'.repeat(level);
        expect(detectDelimiter(`${hashes} London\n\n${LONDON}`)).toEqual({
          style: 'markdown',
          name: 'London',
          level,
        });
      }
    });

    it('classifies header-led content with a trailing --- as markdown (order pin)', () => {
      // Old: `{ style: 'separator', name: '' }`, label `---` — checkpoint
      // 12-1(a): the badge now reads the header instead of the marker.
      expect(detectDelimiter(`## London\n\n${LONDON}\n\n---`)).toEqual({
        style: 'markdown',
        name: 'London',
        level: 2,
      });
    });

    it('classifies `## Name\\n\\n---` alone as a separator, not markdown', () => {
      // Blank payload: the header is the marker's payload. The markdown
      // check runs before `separator`, so a toggled markdown wrapper stays
      // markdown while a marker with nothing under it stays a separator.
      expect(detectDelimiter('## London\n\n---')).toEqual({ style: 'separator', name: '' });
    });

    it('keeps a 7+ hash line as payload', () => {
      expect(detectDelimiter(`####### London\n\n${LONDON}`)).toEqual({ style: 'none', name: '' });
    });

    it('does not detect a glue-typed #Name header (hint-gated malformed)', () => {
      expect(detectDelimiter(`#London\n\n${LONDON}`)).toEqual({ style: 'none', name: '' });
    });

    it('does not detect a header on any line but the first', () => {
      expect(detectDelimiter(`Intro text\n## London\n\n${LONDON}`)).toEqual({
        style: 'none',
        name: '',
      });
    });

    it('does not detect an empty header text or a lone header line', () => {
      expect(detectDelimiter(`##\n\n${LONDON}`)).toEqual({ style: 'none', name: '' });
      expect(detectDelimiter('## London')).toEqual({ style: 'none', name: '' });
    });

    it('rejects header text over 80 code points', () => {
      expect(detectDelimiter(`## ${'a'.repeat(81)}\n\n${LONDON}`)).toEqual({
        style: 'none',
        name: '',
      });
      expect(detectDelimiter(`## ${'a'.repeat(80)}\n\n${LONDON}`).style).toBe('markdown');
    });

    it('caps the header text by code points, not UTF-16 units', () => {
      expect(detectDelimiter(`## ${'😀'.repeat(80)}\n\n${LONDON}`).style).toBe('markdown');
      expect(detectDelimiter(`## ${'😀'.repeat(81)}\n\n${LONDON}`).style).toBe('none');
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

    it('wraps in a markdown heading at every level 1-6', () => {
      for (const level of [1, 2, 3, 4, 5, 6] as const) {
        const hashes = '#'.repeat(level);
        const wrapped = wrapContent(LONDON, 'markdown', 'London', { level });
        expect(wrapped).toBe(`${hashes} London\n\n${LONDON}`);
        expect(unwrapContent(wrapped, { expectedNames: ['London'] })).toBe(LONDON);
      }
    });

    it('defaults the markdown level to ## and omits the toggle marker', () => {
      expect(wrapContent(LONDON, 'markdown', 'London')).toBe(`## London\n\n${LONDON}`);
    });

    it('appends exactly one --- when the markdown toggle is on', () => {
      expect(wrapContent(LONDON, 'markdown', 'London', { trailingSeparator: true })).toBe(
        `## London\n\n${LONDON}\n\n---`,
      );
    });

    it('keeps spaces in markdown header text (header text is prose)', () => {
      expect(wrapContent(LONDON, 'markdown', 'River Thames')).toBe(`## River Thames\n\n${LONDON}`);
    });

    it('sanitizes markdown header text and falls back to entry', () => {
      expect(wrapContent(LONDON, 'markdown', 'a\nb')).toBe(`## a b\n\n${LONDON}`);
      expect(wrapContent(LONDON, 'markdown', '')).toBe(`## entry\n\n${LONDON}`);
    });

    it('keeps a bare --- marker unchanged for markdown (D1 family)', () => {
      // Heading it would emit `## N\n\n---`, which classifies as a separator
      // with the header as payload and would double the header on re-apply.
      expect(wrapContent('---', 'markdown', 'N')).toBe('---');
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

    it('strips a markdown header only when the name matches (D7)', () => {
      expect(unwrapContent('## N\n\nprose', { expectedNames: ['N'] })).toBe('prose');
      expect(unwrapContent('## n\n\nprose', { expectedNames: ['N'] })).toBe('prose');
      expect(unwrapContent('## a=b\n\nprose', { expectedNames: ['a[b'] })).toBe('prose');
      expect(unwrapContent('## Old\n\nprose', { expectedNames: ['N'] })).toBe('## Old\n\nprose');
    });

    it('strips a detected markdown header in the legacy path (no names)', () => {
      expect(unwrapContent('## N\n\nprose')).toBe('prose');
    });

    it('captures markdown payload verbatim through a name-matched strip', () => {
      for (const input of ['  padded  ', 'line\nbreak', 'crlf\r\nline', '\tlead', 'trailing\n\n']) {
        expect(unwrapContent(wrapContent(input, 'markdown', 'N'), { expectedNames: ['N'] })).toBe(
          input,
        );
      }
    });

    it('falls back to separator handling when the markdown name gate fails (§4.3)', () => {
      // Regression-critical: without the fallback, re-wrapping foreign-header
      // content that already ends in `---` to `separator` would emit a second
      // marker (today that re-apply is idempotent).
      expect(
        unwrapContent('## Old\n\nprose\n\n---', { expectedNames: ['N'], stripSeparator: true }),
      ).toBe('## Old\n\nprose');
      expect(unwrapContent('## Old\n\nprose\n\n---', { expectedNames: ['N'] })).toBe(
        '## Old\n\nprose\n\n---',
      );
    });

    it('does not claim a byte round-trip when a markdown payload ends in ---', () => {
      // Same documented ambiguity as `separator`: a payload ending in a
      // marker line is indistinguishable from the toggle marker. The legacy
      // strip consumes it; the name-matched strip keeps it verbatim.
      expect(unwrapContent(wrapContent('prose\n\n---', 'markdown', 'N'))).toBe('prose');
      expect(
        unwrapContent(wrapContent('prose\n\n---', 'markdown', 'N'), { expectedNames: ['N'] }),
      ).toBe('prose\n\n---');
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

    it('normalizes markdown level and spacing on re-apply (never nests)', () => {
      expect(rewrapContent('#### London\n\nlore', 'markdown', 'London', ['London'])).toBe(
        '## London\n\nlore',
      );
      expect(rewrapContent('## London\nlore', 'markdown', 'London', ['London'])).toBe(
        '## London\n\nlore',
      );
      expect(
        rewrapContent('## London\n\nlore', 'markdown', 'London', ['London'], { level: 3 }),
      ).toBe('### London\n\nlore');
    });

    it('consumes the old toggle marker: off removes it, on re-emits one', () => {
      const toggled = '## N\n\nprose\n\n---';
      expect(rewrapContent(toggled, 'markdown', 'N', ['N'])).toBe('## N\n\nprose');
      expect(rewrapContent(toggled, 'markdown', 'N', ['N'], { trailingSeparator: true })).toBe(
        '## N\n\nprose\n\n---',
      );
      expect(
        rewrapContent('## N\n\nprose', 'markdown', 'N', ['N'], { trailingSeparator: true }),
      ).toBe('## N\n\nprose\n\n---');
    });

    it('consumes a marker surfacing from a stripped tag wrapper for markdown', () => {
      // §4.4: a markdown target consumes a trailing `---` in both toggle
      // states; re-applying stays a fixed point instead of shuffling markers.
      const once = rewrapContent('<N>\nprose\n\n---\n</N>', 'markdown', 'N', ['N']);
      expect(once).toBe('## N\n\nprose');
      expect(rewrapContent(once, 'markdown', 'N', ['N'], { trailingSeparator: true })).toBe(
        '## N\n\nprose\n\n---',
      );
    });

    it('consumes the markdown toggle marker when re-wrapping markdown to tag/bracket', () => {
      // User-reported (post-12-1 amendment): the trailing `---` belongs to the
      // markdown wrapper, not the payload — a switch must not carry it into
      // the new shell.
      expect(rewrapContent('## N\n\nprose\n\n---', 'tag', 'N', ['N'])).toBe('<N>\nprose\n</N>');
      expect(rewrapContent('## N\n\nprose\n\n---', 'bracket', 'N', ['N'])).toBe('[N=\nprose]');
      // Idempotent: the wrapped result re-applies as a fixed point.
      const once = rewrapContent('## N\n\nprose\n\n---', 'tag', 'N', ['N']);
      expect(rewrapContent(once, 'tag', 'N', ['N'])).toBe(once);
    });

    it('consumes a foreign markdown toggle marker but keeps the header (D7)', () => {
      expect(rewrapContent('## Old\n\nprose\n\n---', 'tag', 'N', ['N'])).toBe(
        '<N>\n## Old\n\nprose\n</N>',
      );
    });

    it('keeps a scene-break --- when re-wrapping separator-detected content to tag (D4)', () => {
      // No wrapper shape claims the trailing marker on bare prose — the
      // Phase-1 guard holds: the switch stays additive there.
      expect(rewrapContent('prose\n\n---', 'tag', 'N', ['N'])).toBe('<N>\nprose\n\n---\n</N>');
    });

    it('wraps additively around a foreign-named markdown header (D4)', () => {
      expect(rewrapContent('## Old\n\nprose', 'markdown', 'N', ['N'])).toBe(
        '## N\n\n## Old\n\nprose',
      );
    });

    it('never emits a second --- after a foreign-named markdown header (§4.3)', () => {
      const foreign = '## Old\n\nprose\n\n---';
      const once = rewrapContent(foreign, 'separator', 'N', ['N']);
      expect(once).toBe(foreign);
      expect(rewrapContent(once, 'separator', 'N', ['N'])).toBe(once);
    });

    it('strips a matching markdown header and its marker for none', () => {
      expect(rewrapContent('## N\n\nprose\n\n---', 'none', 'N', ['N'])).toBe('prose');
    });

    it('wraps malformed markup additively without truncating', () => {
      expect(rewrapContent('<foo>x</bar>', 'tag', 'N', ['N'])).toBe('<N>\n<foo>x</bar>\n</N>');
      expect(rewrapContent('<tag>unclosed', 'tag', 'N', ['N'])).toBe('<N>\n<tag>unclosed\n</N>');
    });

    it('matches wrapper names after sanitization', () => {
      // `delimiterNameMatches` sanitization itself is pinned in its own
      // describe above; this test covers it through unwrap/rewrap.
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
      // Checkpoint 12-1: header-led content that used to read `---` (or no
      // badge at all) now reads the header text.
      expect(delimiterLabel({ style: 'markdown', name: 'London', level: 2 })).toBe('## London');
      expect(delimiterLabel({ style: 'markdown', name: 'London', level: 3 })).toBe('### London');
      expect(delimiterLabel({ style: 'separator', name: '' })).toBe('---');
      expect(delimiterLabel({ style: 'none', name: '' })).toBe('');
    });

    it('exposes every style as a selectable option', () => {
      // Migrated pin: 'markdown' slots in after 'bracket' (named-wrapper
      // family), before 'separator' — §4.1.
      expect(DELIMITER_STYLE_OPTIONS.map((o) => o.value)).toEqual([
        'tag',
        'bracket',
        'markdown',
        'separator',
        'none',
      ]);
    });
  });
});

describe('detectMalformedWrapper', () => {
  describe('mismatched pairs', () => {
    it('classifies a whole-content mismatched pair without hints', () => {
      expect(detectMalformedWrapper('<test>\nlore\n</universe>')).toEqual({
        kind: 'mismatched',
        openingName: 'test',
        closingName: 'universe',
      });
    });

    it('classifies the reverse mismatch direction', () => {
      expect(detectMalformedWrapper('<universe>\nlore\n</test>')).toEqual({
        kind: 'mismatched',
        openingName: 'universe',
        closingName: 'test',
      });
    });

    it('classifies case-difference names the well-formed backreference hides', () => {
      const content = '<Test>\nlore\n</test>';
      expect(detectDelimiter(content)).toEqual({ style: 'none', name: '' });
      expect(detectMalformedWrapper(content)).toEqual({
        kind: 'mismatched',
        openingName: 'Test',
        closingName: 'test',
      });
    });

    it('classifies a single-line mismatched pair (structural newlines optional)', () => {
      expect(detectMalformedWrapper('<test>lore</universe>')).toEqual({
        kind: 'mismatched',
        openingName: 'test',
        closingName: 'universe',
      });
    });

    it('tolerates padding and CRLF like the well-formed tag shape', () => {
      expect(detectMalformedWrapper('\n  <test>\nlore\n</universe>')).toEqual({
        kind: 'mismatched',
        openingName: 'test',
        closingName: 'universe',
      });
      expect(detectMalformedWrapper('<test>\nlore\n</universe>   ')).toEqual({
        kind: 'mismatched',
        openingName: 'test',
        closingName: 'universe',
      });
      expect(detectMalformedWrapper('<test>\r\nlore\r\n</universe>')).toEqual({
        kind: 'mismatched',
        openingName: 'test',
        closingName: 'universe',
      });
    });

    it('ignores hints: a mismatched pair fires regardless of the name chain', () => {
      expect(detectMalformedWrapper('<test>\nlore\n</universe>', ['universe'])).toEqual({
        kind: 'mismatched',
        openingName: 'test',
        closingName: 'universe',
      });
      expect(detectMalformedWrapper('<test>\nlore\n</universe>', ['unrelated'])).toEqual({
        kind: 'mismatched',
        openingName: 'test',
        closingName: 'universe',
      });
    });

    it('returns null for names over 80 characters on either side', () => {
      expect(detectMalformedWrapper(`<${'a'.repeat(81)}>\nlore\n</universe>`)).toBeNull();
      expect(detectMalformedWrapper(`<test>\nlore\n</${'a'.repeat(81)}>`)).toBeNull();
    });

    it('accepts names of exactly 80 characters', () => {
      expect(detectMalformedWrapper(`<${'a'.repeat(80)}>\nlore\n</universe>`)).toEqual({
        kind: 'mismatched',
        openingName: 'a'.repeat(80),
        closingName: 'universe',
      });
    });

    it('returns null for a blank payload', () => {
      expect(detectMalformedWrapper('<test>\n\n</universe>')).toBeNull();
      expect(detectMalformedWrapper('<test>   </universe>')).toBeNull();
      expect(detectMalformedWrapper('<test></universe>')).toBeNull();
    });

    it('returns null when a captured name would sanitize away', () => {
      expect(detectMalformedWrapper('<  >\nlore\n</universe>')).toBeNull();
      expect(detectMalformedWrapper('<test>\nlore\n</  >')).toBeNull();
    });

    it('returns null for well-formed wrappers and separators', () => {
      expect(detectMalformedWrapper('<b>\nx\n</b>')).toBeNull();
      expect(detectMalformedWrapper('<b>x</b>')).toBeNull();
      expect(detectDelimiter('<b>\nx\n</b>')).toEqual({ style: 'tag', name: 'b' });
      expect(detectMalformedWrapper('[b=\nx]')).toBeNull();
      expect(detectMalformedWrapper('lore\n\n---')).toBeNull();
    });
  });

  describe('orphan openers and closers', () => {
    it('fires for an orphan opener only with a matching hint', () => {
      expect(detectMalformedWrapper('<universe>\nlore')).toBeNull();
      expect(detectMalformedWrapper('<universe>\nlore', [])).toBeNull();
      expect(detectMalformedWrapper('<universe>\nlore', ['universe'])).toEqual({
        kind: 'orphan-open',
        name: 'universe',
      });
      expect(detectMalformedWrapper('<universe>\nlore', ['UNIVERSE'])).toEqual({
        kind: 'orphan-open',
        name: 'universe',
      });
    });

    it('tolerates padding and CRLF on the opener line', () => {
      expect(detectMalformedWrapper('  <universe>  \r\nlore', ['universe'])).toEqual({
        kind: 'orphan-open',
        name: 'universe',
      });
    });

    it('keeps a lone non-matching tag in code-ish prose as payload', () => {
      expect(detectMalformedWrapper('<div>\ncode sample', ['universe'])).toBeNull();
    });

    it('keeps an opener with payload on the same line unclassified', () => {
      expect(detectMalformedWrapper('<tag>unclosed', ['tag'])).toBeNull();
    });

    it('fires for an orphan closer only with a matching hint', () => {
      expect(detectMalformedWrapper('lore\n</universe>')).toBeNull();
      expect(detectMalformedWrapper('lore\n</universe>', [])).toBeNull();
      expect(detectMalformedWrapper('lore\n</universe>', ['universe'])).toEqual({
        kind: 'orphan-close',
        name: 'universe',
      });
      expect(detectMalformedWrapper('lore\n</universe>', ['UNIVERSE'])).toEqual({
        kind: 'orphan-close',
        name: 'universe',
      });
    });

    it('keeps a lone closer without preceding payload unclassified', () => {
      expect(detectMalformedWrapper('</universe>', ['universe'])).toBeNull();
      expect(detectMalformedWrapper('\n</universe>', ['universe'])).toBeNull();
    });

    it('fires for an unclosed bracket orphan with a matching hint', () => {
      expect(detectMalformedWrapper('[Name=\nlore')).toBeNull();
      expect(detectMalformedWrapper('[Name=\nlore', ['Name'])).toEqual({
        kind: 'orphan-open',
        name: 'Name',
      });
      expect(detectMalformedWrapper('[Name=\nlore', ['name'])).toEqual({
        kind: 'orphan-open',
        name: 'Name',
      });
    });

    it('returns null when a closed shape belongs to the well-formed guards', () => {
      expect(detectMalformedWrapper('<universe>\nlore\n</universe>', ['universe'])).toBeNull();
      expect(detectMalformedWrapper('[Name=\nlore]', ['Name'])).toBeNull();
    });
  });

  describe('empty and glue-typed markdown headers', () => {
    it('fires for an empty header without hints', () => {
      expect(detectMalformedWrapper('##\n\nlore')).toEqual({ kind: 'empty-header', level: 2 });
      expect(detectMalformedWrapper('#\n\nlore', [])).toEqual({ kind: 'empty-header', level: 1 });
      expect(detectMalformedWrapper('##\n\nlore', ['unrelated'])).toEqual({
        kind: 'empty-header',
        level: 2,
      });
    });

    it('tolerates a tight empty header, trailing spaces and CRLF', () => {
      expect(detectMalformedWrapper('##  \nlore')).toEqual({ kind: 'empty-header', level: 2 });
      expect(detectMalformedWrapper('##\r\n\r\nlore')).toEqual({ kind: 'empty-header', level: 2 });
    });

    it('returns null for a blank payload or a marker-only payload below an empty header', () => {
      expect(detectMalformedWrapper('##\n\n')).toBeNull();
      expect(detectMalformedWrapper('##\n\n   ')).toBeNull();
      // `##\n\n---` classifies as a separator with the header as payload.
      expect(detectMalformedWrapper('##\n\n---')).toBeNull();
      expect(detectMalformedWrapper('##')).toBeNull();
    });

    it('fires for a glue-typed header only with a matching hint', () => {
      expect(detectMalformedWrapper('#London\n\nlore')).toBeNull();
      expect(detectMalformedWrapper('#London\n\nlore', [])).toBeNull();
      expect(detectMalformedWrapper('#London\n\nlore', ['London'])).toEqual({
        kind: 'no-space-header',
        name: 'London',
      });
      expect(detectMalformedWrapper('#London\n\nlore', ['LONDON'])).toEqual({
        kind: 'no-space-header',
        name: 'London',
      });
    });

    it('matches glue-typed names after sanitization', () => {
      expect(detectMalformedWrapper('#a=b\n\nlore', ['a[b'])).toEqual({
        kind: 'no-space-header',
        name: 'a=b',
      });
    });

    it('keeps a #hashtag line in prose as payload', () => {
      expect(detectMalformedWrapper('#hashtag\n\nlore', ['London'])).toBeNull();
    });

    it('keeps a 7+ hash line as payload even with a matching hint', () => {
      expect(detectMalformedWrapper('####### London\n\nlore', ['London'])).toBeNull();
    });

    it('returns null for well-formed markdown and header-only content', () => {
      expect(detectMalformedWrapper(`## London\n\n${LONDON}`, ['London'])).toBeNull();
      expect(detectMalformedWrapper(`## London\n\n${LONDON}\n\n---`, ['London'])).toBeNull();
      expect(detectMalformedWrapper('#London', ['London'])).toBeNull();
    });

    it('returns null when a glue-typed capture is unstrippable', () => {
      // Marker-only payload below the header: the shell has nothing to free.
      expect(detectMalformedWrapper('#Name\n\n---', ['Name'])).toBeNull();
      // Header text over the 80-code-point cap.
      expect(detectMalformedWrapper(`#${'a'.repeat(81)}\n\nlore`, ['aaa'])).toBeNull();
    });
  });
});

describe('malformedWrapperLabel', () => {
  it('labels a mismatched pair with both names', () => {
    expect(
      malformedWrapperLabel({ kind: 'mismatched', openingName: 'test', closingName: 'universe' }),
    ).toBe('<test> ? </universe>');
  });

  it('labels an orphan opener with its name', () => {
    expect(malformedWrapperLabel({ kind: 'orphan-open', name: 'universe' })).toBe('<universe> ?');
  });

  it('labels an orphan closer with its name', () => {
    expect(malformedWrapperLabel({ kind: 'orphan-close', name: 'universe' })).toBe('? </universe>');
  });

  it('labels an empty header with its heading level', () => {
    expect(malformedWrapperLabel({ kind: 'empty-header', level: 2 })).toBe('## ?');
    expect(malformedWrapperLabel({ kind: 'empty-header', level: 1 })).toBe('# ?');
  });

  it('labels a glue-typed header with its name', () => {
    expect(malformedWrapperLabel({ kind: 'no-space-header', name: 'London' })).toBe('#London ?');
  });
});

describe('stripMalformedWrapper', () => {
  it('strips one mismatched shell in either direction', () => {
    expect(stripMalformedWrapper('<test>\nlore\n</universe>')).toBe('lore');
    expect(stripMalformedWrapper('<universe>\nlore\n</test>')).toBe('lore');
  });

  it('keeps the payload byte-for-byte (padding, CRLF, wrapper syntax)', () => {
    expect(stripMalformedWrapper('  <test>\n  lore  \n</universe>  ')).toBe('  lore  ');
    expect(stripMalformedWrapper('\n  <test>\nlore\n</universe>')).toBe('lore');
    expect(stripMalformedWrapper('<test>\r\nlore\r\n</universe>')).toBe('lore');
    expect(stripMalformedWrapper('<test>\na\r\nb\n</universe>')).toBe('a\r\nb');
    expect(stripMalformedWrapper('<test>\n<a> [b=] =c\n</universe>')).toBe('<a> [b=] =c');
  });

  it('strips orphan shells structurally, without hints', () => {
    // Detection without hints returns null, but stripping is hint-free by
    // design: callers strip only rows that classified.
    expect(detectMalformedWrapper('<universe>\nlore')).toBeNull();
    expect(stripMalformedWrapper('<universe>\nlore')).toBe('lore');
    expect(stripMalformedWrapper('lore\n</universe>')).toBe('lore');
    expect(stripMalformedWrapper('[Name=\nlore')).toBe('lore');
  });

  it('keeps orphan payloads verbatim (no trim)', () => {
    expect(stripMalformedWrapper('<universe>\n  lore  ')).toBe('  lore  ');
    expect(stripMalformedWrapper('[Name=\n  lore  ')).toBe('  lore  ');
    expect(stripMalformedWrapper('  lore  \n  </universe>  ')).toBe('  lore  ');
  });

  it('strips markdown shells: first line plus one structural blank line', () => {
    expect(stripMalformedWrapper('##\n\n  lore  ')).toBe('  lore  ');
    expect(stripMalformedWrapper('#Name\n\nlore')).toBe('lore');
    // Tight form: the single newline is the structural one.
    expect(stripMalformedWrapper('#Name\nlore')).toBe('lore');
    // Detection without hints returns null, but stripping is hint-free by
    // design: callers strip only rows that classified.
    expect(detectMalformedWrapper('#Name\n\nlore')).toBeNull();
    expect(stripMalformedWrapper('#Name\n\nlore')).toBe('lore');
  });

  it('removes only the outer markdown shell around a nested wrapper', () => {
    const stripped = stripMalformedWrapper('##\n\n## London\n\nlore');
    expect(stripped).toBe('## London\n\nlore');
    expect(detectDelimiter(stripped)).toEqual({ style: 'markdown', name: 'London', level: 2 });
  });

  it('is identity for well-formed markdown wrappers', () => {
    expect(stripMalformedWrapper(`## London\n\n${LONDON}`)).toBe(`## London\n\n${LONDON}`);
    expect(stripMalformedWrapper(`## London\n\n${LONDON}\n\n---`)).toBe(
      `## London\n\n${LONDON}\n\n---`,
    );
  });

  it('removes only the outer shell around a nested well-formed wrapper', () => {
    const stripped = stripMalformedWrapper('<test>\n<Universe>\nlore\n</Universe>\n</universe>');
    expect(stripped).toBe('<Universe>\nlore\n</Universe>');
    expect(detectDelimiter(stripped)).toEqual({ style: 'tag', name: 'Universe' });
  });

  it('is idempotent for the matrix shapes', () => {
    const CASES: readonly string[] = [
      '<test>\nlore\n</universe>',
      '<test>\r\nlore\r\n</universe>',
      '  <test>\n  lore  \n</universe>  ',
      '<universe>\nlore',
      'lore\n</universe>',
      '[Name=\nlore',
      '##\n\nlore',
      '#Name\nlore',
      '<test>\n<Universe>\nlore\n</Universe>\n</universe>',
    ];
    for (const input of CASES) {
      const once = stripMalformedWrapper(input);
      expect(stripMalformedWrapper(once)).toBe(once);
    }
  });

  it('is identity for nullish input, well-formed delimiters and prose', () => {
    expect(stripMalformedWrapper(null as unknown as string)).toBe('');
    expect(stripMalformedWrapper(undefined as unknown as string)).toBe('');
    expect(stripMalformedWrapper('<b>\nx\n</b>')).toBe('<b>\nx\n</b>');
    expect(stripMalformedWrapper('[b=\nx]')).toBe('[b=\nx]');
    expect(stripMalformedWrapper('lore\n\n---')).toBe('lore\n\n---');
    expect(stripMalformedWrapper('plain prose')).toBe('plain prose');
  });
});

describe('malformed delimiters U1 regression', () => {
  it('detects the blind spot and rewraps into a single clean wrapper', () => {
    const malformed = '<test>\nlore\n</universe>';
    // U1: the mismatched pair is invisible to the well-formed detector and
    // used to be silently nested inside a fresh wrapper.
    expect(detectDelimiter(malformed)).toEqual({ style: 'none', name: '' });
    expect(detectMalformedWrapper(malformed)).toEqual({
      kind: 'mismatched',
      openingName: 'test',
      closingName: 'universe',
    });
    // Strip + rewrap yields exactly one wrapper pair, zero nesting.
    expect(rewrapContent(stripMalformedWrapper(malformed), 'tag', 'Universe')).toBe(
      '<Universe>\nlore\n</Universe>',
    );
  });
});
