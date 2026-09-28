import { digitsOf, fitKeyChips } from './entry-keys.model';

/** Digit-sensitive counter width, in px: "+9" is narrower than "+10". */
const counterWidth = (hidden: number): number => 24 + 7 * (digitsOf(hidden) - 1);

describe('digitsOf', () => {
  it('counts decimal digits, reading 0 as one digit', () => {
    expect(digitsOf(0)).toBe(1);
    expect(digitsOf(9)).toBe(1);
    expect(digitsOf(10)).toBe(2);
    expect(digitsOf(99)).toBe(2);
    expect(digitsOf(100)).toBe(3);
  });
});

describe('fitKeyChips', () => {
  interface FitCase {
    name: string;
    width: number;
    widths: number[];
    expected: number;
  }

  // Widths in px, 4px gaps; the counter's width follows its digit count.
  const cases: FitCase[] = [
    {
      name: 'shows only the chips that fit whole and counts the rest',
      width: 100,
      widths: [40, 40, 40, 40],
      expected: 1, // 40 + 4 + 24 = 68; a second chip needs 112
    },
    {
      name: 'takes the most chips the row fits, not the first that fits',
      width: 140,
      widths: [40, 40, 40, 40, 40],
      expected: 2, // 3 chips + counter = 152 over; 2 + counter = 108
    },
    {
      name: 'renders every chip when they all fit',
      width: 172,
      widths: [40, 40, 40, 40],
      expected: 4, // span(4) = 172 exactly
    },
    {
      name: 'holds the exactly-fits boundary',
      width: 84,
      widths: [40, 40],
      expected: 2,
    },
    {
      name: 'drops to one chip plus the counter just past that boundary',
      width: 83,
      widths: [40, 40],
      expected: 1,
    },
    {
      name: 'resolves a digit jump exactly: two chips survive beside a wider +10',
      width: 99,
      widths: Array<number>(12).fill(30),
      expected: 2, // 30+4+30+4+31 = 99 exactly, counter "+10"
    },
    {
      name: 'hides a chip when the wider +10 no longer fits',
      width: 97,
      widths: Array<number>(12).fill(30),
      expected: 1, // 30 + 4 + 31 = 65; two chips + "+10" = 99 over
    },
    {
      name: 'lets the counter lead the row when even chip 0 does not fit',
      width: 54,
      widths: [30, 30],
      expected: 0, // chip + counter = 58 over; counter alone = 24
    },
    {
      name: 'returns 0 when the strip is narrower than the counter itself',
      width: 10,
      widths: [30, 30],
      expected: 0, // degenerate: the clipped counter still names all keys
    },
    {
      name: 'counts every key when no chip can show',
      width: 100,
      widths: Array<number>(12).fill(120),
      expected: 0,
    },
  ];

  for (const fitCase of cases) {
    it(`fits ${fitCase.name}`, () => {
      expect(fitKeyChips(fitCase.width, fitCase.widths, 4, counterWidth)).toBe(
        fitCase.expected,
      );
    });
  }

  it('never consults the counter width when everything fits', () => {
    const counter = vi.fn(() => 24);
    expect(fitKeyChips(200, [40, 40, 40], 4, counter)).toBe(3);
    expect(counter).not.toHaveBeenCalled();
  });

  it('counts gaps between chips, never after the last one', () => {
    // span(3) = 3*40 + 2*4 = 128: a 128px strip takes all three chips with no
    // counter; one pixel narrower, three chips + a counter no longer fit and
    // the scan settles on two chips + counter (112).
    expect(fitKeyChips(128, [40, 40, 40], 4, counterWidth)).toBe(3);
    expect(fitKeyChips(127, [40, 40, 40], 4, counterWidth)).toBe(2);
  });

  it('honors a caller-supplied gap', () => {
    // Zero-gap layout: 3*30 = 90 of chips — one pixel narrower than the
    // chips alone, and the trailing gap to the counter decides the boundary.
    expect(fitKeyChips(89, [30, 30, 30], 0, () => 24)).toBe(2); // 60 + 24 = 84
    expect(fitKeyChips(83, [30, 30, 30], 0, () => 24)).toBe(1); // 30 + 24 = 54
  });

  it('returns 0 for degenerate inputs', () => {
    expect(fitKeyChips(0, [40, 40], 4, counterWidth)).toBe(0);
    expect(fitKeyChips(-5, [40, 40], 4, counterWidth)).toBe(0);
    expect(fitKeyChips(200, [], 4, counterWidth)).toBe(0);
  });

  it('checks each candidate against its own counter (total - count hidden)', () => {
    // Scan order pinned through a recording spy: candidates descend from
    // total - 1, each consulting the hidden count it would leave behind, and
    // the first fitting row stops the scan (40px chips, 140px strip: count 4
    // → hidden 1 fails, count 3 → hidden 2 fails, count 2 → hidden 3 fits).
    const consulted: number[] = [];
    const visible = fitKeyChips(140, [40, 40, 40, 40, 40], 4, (hidden) => {
      consulted.push(hidden);
      return 24;
    });
    expect(visible).toBe(2);
    expect(consulted).toEqual([1, 2, 3]);
  });
});
