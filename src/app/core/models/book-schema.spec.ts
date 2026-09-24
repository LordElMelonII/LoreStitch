import { CharacterBook, CharacterBookEntry } from './lorebook.model';
import { BookDefect, BookDefectKind, validateBook } from './book-schema';

/**
 * Task 09 §3.6 row 1 — the pre-flight validator pins: every defect kind is
 * reachable, clean books (vendor noise included) never false-positive, and
 * the result order is stable (book order, then kind per entry).
 */

/** A clean, fully-populated entry in the house shape. */
function goodEntry(id: number, overrides: Partial<CharacterBookEntry> = {}): CharacterBookEntry {
  return {
    id,
    keys: [`key-${id}`],
    secondary_keys: [],
    content: `content ${id}`,
    comment: `Entry ${id}`,
    enabled: true,
    insertion_order: id,
    extensions: {},
    ...overrides,
  };
}

/**
 * A book whose runtime values may lie about their types — exactly the input
 * domain the validator exists for, hence the deliberate boundary cast.
 */
function rawBook(entries: unknown, bookFields: Record<string, unknown> = {}): CharacterBook {
  return { name: 'Fixture', extensions: {}, entries, ...bookFields } as unknown as CharacterBook;
}

/** Compact defect fingerprint for order assertions. */
function fingerprint(defects: readonly BookDefect[]): string[] {
  return defects.map((defect) => `${defect.kind}#${String(defect.entryId)}`);
}

function defectOfKind(defects: readonly BookDefect[], kind: BookDefectKind): BookDefect {
  const match = defects.find((defect) => defect.kind === kind);
  assert(match, `expected a ${kind} defect`);
  return match;
}

describe('validateBook', () => {
  it('returns no defects for a clean book', () => {
    const book: CharacterBook = {
      name: 'Clean',
      description: 'fine',
      scan_depth: 4,
      token_budget: 2048,
      recursive_scanning: false,
      extensions: {},
      entries: [
        goodEntry(0, { priority: undefined }),
        goodEntry(1, { secondary_keys: ['night'], priority: 3 }),
      ],
    };
    expect(validateBook(book)).toEqual([]);
  });

  it('returns no defects for a book loaded with unknown vendor keys at every level', () => {
    // The never-false-positive pin (plan 09 risk 1): an unknown key can never
    // make a book invalid — at the book root, on entries, inside extensions,
    // and inside nested vendor payloads.
    const book = rawBook(
      [
        {
          ...goodEntry(0),
          color: '#ff0000', // unknown entry-level vendor key
          extensions: {
            position: 4,
            vendor_plugin: { nested: { unknown: true } }, // unknown nested payload
            lorestash_tags: ['a', 'b'],
          },
        },
        goodEntry(1, { name: 'named not commented' }),
      ],
      { stlo: { legacy: [1, 2, 3] }, randomExtension: 'vendor-data' }, // unknown book-level keys
    );
    expect(validateBook(book)).toEqual([]);
  });

  it('accepts every documented-legal shape of the "when present" fields', () => {
    // position is NOT a rule (legacy values coerce downstream); absent
    // optional scalars and explicit-undefined are legal; absent-or-null
    // secondary_keys/extensions are legal (the converters nullish-handle
    // them, world-info.js:5511/:5548).
    const book = rawBook([
      {
        id: 0,
        keys: [],
        content: 'x',
        enabled: true,
        position: 'outlet', // legacy position value — never validated
        secondary_keys: null, // tolerated by both converters
        extensions: null, // tolerated by both converters
      },
      {
        id: 1,
        keys: ['a'],
        content: 'y',
        enabled: true,
        insertion_order: 7, // present and finite
        priority: undefined, // the documented unset
      },
    ]);
    expect(validateBook(book)).toEqual([]);
  });

  it('flags each defect kind exactly once on a minimal fixture', () => {
    const cases: readonly [BookDefectKind, CharacterBook][] = [
      ['entry-id-not-finite', rawBook([goodEntry(0, { id: NaN })])],
      ['entry-id-duplicate', rawBook([goodEntry(7), goodEntry(8, { id: 7 })])],
      ['entry-content-not-string', rawBook([goodEntry(0, { content: 5 as unknown as string })])],
      [
        'entry-keys-not-string-array',
        rawBook([goodEntry(0, { keys: 'a' as unknown as string[] })]),
      ],
      [
        'entry-secondary-keys-not-string-array',
        rawBook([goodEntry(0, { secondary_keys: 'x' as unknown as string[] })]),
      ],
      ['entry-insertion-order-not-finite', rawBook([goodEntry(0, { insertion_order: NaN })])],
      ['entry-priority-not-finite', rawBook([goodEntry(0, { priority: NaN })])],
      [
        'entry-extensions-not-object',
        rawBook([goodEntry(0, { extensions: [] as unknown as Record<string, unknown> })]),
      ],
      ['book-entries-not-array', rawBook({ not: 'an array' })],
    ];
    for (const [kind, book] of cases) {
      const defects = validateBook(book);
      expect(defects.some((defect) => defect.kind === kind)).toBe(true);
      expect(defects.every((defect) => defect.kind === kind)).toBe(true);
    }
  });

  it('reports BOTH positions of a duplicate id', () => {
    const defects = validateBook(rawBook([goodEntry(7), goodEntry(1, { id: 7 })]));
    const duplicates = defects.filter((defect) => defect.kind === 'entry-id-duplicate');
    expect(duplicates).toHaveLength(2);
    assert(duplicates[0] && duplicates[1]);
    // Each occurrence is identified by its own title, same id as found.
    expect(duplicates[0].entryId).toBe(7);
    expect(duplicates[0].entryTitle).toBe('Entry 7');
    expect(duplicates[1].entryId).toBe(7);
    expect(duplicates[1].entryTitle).toBe('Entry 1');
  });

  it('flags a numeric id and a string spelling of it as duplicates (they collapse in the uid bag)', () => {
    // The native export keys entries by String(id): `7` and `"7"` land on the
    // same bag key, so both positions report.
    const defects = validateBook(
      rawBook([goodEntry(7), goodEntry(1, { id: '7' as unknown as number })]),
    );
    expect(fingerprint(defects)).toEqual([
      'entry-id-duplicate#7',
      'entry-id-not-finite#null', // the string id is also not a finite number
      'entry-id-duplicate#null',
    ]);
  });

  it('reports a numeric id as found (NaN and Infinity included) and a non-numeric id as null', () => {
    const nan = defectOfKind(
      validateBook(rawBook([goodEntry(0, { id: NaN })])),
      'entry-id-not-finite',
    );
    expect(nan.entryId).toBeNaN(); // the id as found
    expect(nan.entryTitle).toBe('Entry 0');

    const infinite = defectOfKind(
      validateBook(rawBook([goodEntry(0, { id: Number.POSITIVE_INFINITY })])),
      'entry-id-not-finite',
    );
    expect(infinite.entryId).toBe(Number.POSITIVE_INFINITY);

    // A string id cannot honestly fill `entryId: number | null` — null, and
    // the title carries the identification.
    const stringId = defectOfKind(
      validateBook(rawBook([goodEntry(0, { id: '7' as unknown as number })])),
      'entry-id-not-finite',
    );
    expect(stringId.entryId).toBeNull();
    expect(stringId.entryTitle).toBe('Entry 0');
  });

  it('flags an absent id (rule 2) — split exports silently drop id-less entries', () => {
    const defects = validateBook(rawBook([{ keys: ['a'], content: 'x', enabled: true }]));
    expect(fingerprint(defects)).toEqual(['entry-id-not-finite#null']);
    expect(defects[0]?.entryTitle).toBeNull(); // no comment, no name
  });

  it('treats null insertion_order and null priority as defects but null secondary_keys/extensions as absent', () => {
    const defects = validateBook(
      rawBook([
        {
          id: 0,
          keys: ['a'],
          content: 'x',
          enabled: true,
          insertion_order: null, // ST's conversion takes order verbatim (world-info.js:5516)
          priority: null, // the documented unset is `undefined`, not null
        },
      ]),
    );
    expect(fingerprint(defects)).toEqual([
      'entry-insertion-order-not-finite#0',
      'entry-priority-not-finite#0',
    ]);
  });

  it('rejects arrays with non-string members in keys and secondary_keys', () => {
    expect(
      fingerprint(validateBook(rawBook([goodEntry(0, { keys: ['a', 2] as unknown as string[] })]))),
    ).toEqual(['entry-keys-not-string-array#0']);
    expect(
      fingerprint(
        validateBook(
          rawBook([goodEntry(0, { secondary_keys: ['a', null] as unknown as string[] })]),
        ),
      ),
    ).toEqual(['entry-secondary-keys-not-string-array#0']);
  });

  it('rejects non-plain-object extensions (arrays are not plain objects)', () => {
    const defects = validateBook(
      rawBook([goodEntry(0, { extensions: [] as unknown as Record<string, unknown> })]),
    );
    expect(fingerprint(defects)).toEqual(['entry-extensions-not-object#0']);
  });

  it('emits defects in book order, then a fixed kind order per entry', () => {
    // Entry 0: id-not-finite before content; entry 1: clean; entry 2: keys.
    const defects = validateBook(
      rawBook([
        goodEntry(0, { id: NaN, content: 5 as unknown as string }),
        goodEntry(1),
        goodEntry(2, { keys: 'a' as unknown as string[] }),
      ]),
    );
    expect(fingerprint(defects)).toEqual([
      'entry-id-not-finite#NaN',
      // The NaN id is this entry's id "as found" — every defect of the entry
      // reports it, even the ones about other fields.
      'entry-content-not-string#NaN',
      'entry-keys-not-string-array#2',
    ]);
  });

  it('orders an entry’s id defects: not-finite before duplicate', () => {
    const defects = validateBook(rawBook([goodEntry(0, { id: NaN }), goodEntry(1, { id: NaN })]));
    expect(fingerprint(defects)).toEqual([
      'entry-id-not-finite#NaN',
      'entry-id-duplicate#NaN',
      'entry-id-not-finite#NaN',
      'entry-id-duplicate#NaN',
    ]);
  });

  it('reports a non-object entry member as a malformed entries collection, at its book position', () => {
    const defects = validateBook(
      rawBook([goodEntry(0), null, goodEntry(2, { keys: 'a' as unknown as string[] })]),
    );
    expect(fingerprint(defects)).toEqual([
      'book-entries-not-array#null',
      'entry-keys-not-string-array#2',
    ]);
  });

  it('never throws on degenerate inputs', () => {
    expect(validateBook(null as unknown as CharacterBook)).toEqual([
      { kind: 'book-entries-not-array', entryId: null, entryTitle: null },
    ]);
    expect(validateBook(undefined as unknown as CharacterBook)).toEqual([
      { kind: 'book-entries-not-array', entryId: null, entryTitle: null },
    ]);
    expect(validateBook(rawBook('not an array'))).toEqual([
      { kind: 'book-entries-not-array', entryId: null, entryTitle: null },
    ]);
  });

  it('groups symbol ids under one throwaway key instead of throwing', () => {
    const symbol = Symbol('uid');
    const defects = validateBook(
      rawBook([
        goodEntry(0, { id: symbol as unknown as number }),
        goodEntry(1, { id: symbol as unknown as number }),
      ]),
    );
    // Both entries flag (not-finite each, duplicate both) — the ids are
    // non-numbers, and the validator must stay total.
    expect(fingerprint(defects)).toEqual([
      'entry-id-not-finite#null',
      'entry-id-duplicate#null',
      'entry-id-not-finite#null',
      'entry-id-duplicate#null',
    ]);
  });

  it('keys null-prototype object ids under one throwaway key instead of throwing', () => {
    // String() on a null-prototype object throws (no primitive conversion) —
    // the canonical-key helper absorbs it, and the pair still reports as
    // mutually duplicate rather than crashing the pre-flight.
    const defects = validateBook(
      rawBook([
        goodEntry(0, { id: Object.create(null) as unknown as number }),
        goodEntry(1, { id: Object.create(null) as unknown as number }),
      ]),
    );
    expect(fingerprint(defects)).toEqual([
      'entry-id-not-finite#null',
      'entry-id-duplicate#null',
      'entry-id-not-finite#null',
      'entry-id-duplicate#null',
    ]);
  });

  it('prefers comment, then name, as the defect title — null when neither is usable', () => {
    const defects = validateBook(
      rawBook([
        goodEntry(0, { comment: '  Castle gates  ', insertion_order: NaN }),
        goodEntry(1, { comment: '', name: 'Tavern', insertion_order: NaN }),
        goodEntry(2, { comment: '   ', name: '', insertion_order: NaN }),
      ]),
    );
    expect(defects.map((defect) => defect.entryTitle)).toEqual([
      '  Castle gates  ',
      'Tavern',
      null,
    ]);
  });
});
