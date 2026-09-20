import { HIGHLIGHT_CLAMP, highlightSegments } from './highlight-segments';

/** Shorthand builders keeping the truth tables readable. */
const primary = (ranges: [number, number][]) => ({
  tone: 'primary' as const,
  ranges: ranges.map(([start, end]) => ({ start, end })),
});
const secondary = (ranges: [number, number][]) => ({
  tone: 'secondary' as const,
  ranges: ranges.map(([start, end]) => ({ start, end })),
});

/** Renders the segments back to a `<tone>[<text>]` fingerprint. */
function paint(segments: ReturnType<typeof highlightSegments>): string[] {
  return segments.map((s) => `${s.tone}[${s.text}]`);
}

describe('highlightSegments', () => {
  it('paints disjoint ranges and keeps the gaps readable as none', () => {
    const segments = highlightSegments('saber and excalibur', [
      primary([[0, 5]]),
      secondary([[10, 19]]),
    ]);

    expect(paint(segments)).toEqual([
      'primary[saber]',
      'none[ and ]',
      'secondary[excalibur]',
    ]);
  });

  it('merges adjacent ranges of one tone into a single span', () => {
    const segments = highlightSegments('saberartoria', [
      primary([
        [0, 5],
        [5, 12],
      ]),
    ]);

    expect(paint(segments)).toEqual(['primary[saberartoria]']);
  });

  it('lets the outermost range win over a nested one', () => {
    const segments = highlightSegments('the holy grail awakens', [
      primary([[4, 14]]),
      secondary([[8, 12]]),
    ]);

    expect(paint(segments)).toEqual(['none[the ]', 'primary[holy grail]', 'none[ awakens]']);
  });

  it('gives the earlier start the overlap of two equal-length partial ranges', () => {
    // Neither range contains the other and lengths tie, so the tie rule
    // decides: the earlier start paints its whole span, the later candidate
    // keeps only the untouched tail.
    const segments = highlightSegments('XXABABYY', [
      primary([[2, 6]]),
      secondary([[0, 4]]),
    ]);

    expect(paint(segments)).toEqual(['secondary[XXAB]', 'primary[AB]', 'none[YY]']);
  });

  it('prefers primary over secondary on equal spans', () => {
    const segments = highlightSegments('excalibur', [
      secondary([[0, 9]]),
      primary([[0, 9]]),
    ]);

    expect(paint(segments)).toEqual(['primary[excalibur]']);
  });

  it('is deterministic for duplicate equal spans of one tone (key list order)', () => {
    const segments = highlightSegments('saber', [secondary([[0, 5]]), secondary([[0, 5]])]);

    // Both keys claim the same span; the first in the list wins the paint and
    // the output is the same shape on every evaluation.
    expect(paint(segments)).toEqual(['secondary[saber]']);
    expect(highlightSegments('saber', [secondary([[0, 5]]), secondary([[0, 5]])])).toEqual(segments);
  });

  it('keeps only the first 200 matches and drops the rest unpainted', () => {
    // 250 disjoint 5-char matches with 1-char gaps: 'saber saber ...'.
    const text = Array.from({ length: 250 }, () => 'saber').join(' ');
    const ranges: [number, number][] = [];
    for (let i = 0; i < 250; i += 1) {
      ranges.push([i * 6, i * 6 + 5]);
    }

    const segments = highlightSegments(text, [primary(ranges)]);
    const painted = segments.filter((s) => s.tone === 'primary');

    expect(painted).toHaveLength(HIGHLIGHT_CLAMP);
    // The unpainted tail stays in the output as 'none' spans.
    expect(segments.at(-1)?.tone).toBe('none');
    // Exactly the first 200 ranges painted: the 201st is untouched text.
    const firstDropped = ranges[HIGHLIGHT_CLAMP];
    assert(firstDropped);
    expect(text.slice(firstDropped[0], firstDropped[1])).toBe('saber');
    expect(segments.some((s) => s.tone === 'none' && s.text.includes('saber'))).toBe(true);
  });

  it('applies the clamp in discovery order, before the overlap rules', () => {
    // The first key floods the 200-candidate budget; the second key's range
    // never even becomes a candidate — this is clamping, not overlap loss.
    const many: [number, number][] = Array.from({ length: HIGHLIGHT_CLAMP }, () => [0, 1]);
    const segments = highlightSegments('aaaa bbbb', [primary(many), secondary([[0, 9]])]);

    expect(paint(segments)).toEqual(['primary[a]', 'none[aaa bbbb]']);
  });

  it('clamps out-of-bounds ranges defensively and paints empty text to nothing', () => {
    expect(highlightSegments('', [primary([[0, 5]])])).toEqual([]);
    expect(paint(highlightSegments('ab', [primary([[5, 9]])]))).toEqual(['none[ab]']);
    expect(paint(highlightSegments('ab', [primary([[-3, 1]])]))).toEqual(['primary[a]', 'none[b]']);
  });
});
