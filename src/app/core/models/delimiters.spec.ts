import {
  DELIMITER_STYLE_OPTIONS,
  delimiterLabel,
  detectDelimiter,
  entryDelimiterName,
  entryDelimiterNameFromKey,
  rewrapContent,
  unwrapContent,
  wrapContent,
} from './delimiters';

const LONDON = 'London is a city full of people.';

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
