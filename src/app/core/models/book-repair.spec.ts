import { CharacterBook, CharacterBookEntry } from './lorebook.model';
import { BookDefect, validateBook } from './book-schema';
import { BookRepair, planBookRepair } from './book-repair';

/**
 * Task 09 §3.6 row 2 — the repair planner pins: one change per flagged field,
 * the duplicate/coercion policies, idempotence, and byte-preservation of
 * every untouched (vendor) field.
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

/** A book whose runtime values may lie about their types (the planner's input domain). */
function rawBook(entries: unknown, bookFields: Record<string, unknown> = {}): CharacterBook {
  return { name: 'Fixture', extensions: {}, entries, ...bookFields } as unknown as CharacterBook;
}

function defect(kind: BookDefect['kind'], entryId: number | null = null): BookDefect {
  return { kind, entryId, entryTitle: null };
}

function plan(book: CharacterBook, defects: readonly BookDefect[]): BookRepair {
  const repair = planBookRepair(book, defects);
  assert(repair, 'expected a repair plan');
  return repair;
}

describe('planBookRepair', () => {
  it('returns null for empty defect lists and degenerate inputs', () => {
    const book = rawBook([goodEntry(0)]);
    expect(planBookRepair(book, [])).toBeNull();
    expect(
      planBookRepair(null as unknown as CharacterBook, [defect('entry-id-not-finite')]),
    ).toBeNull();
    expect(planBookRepair(rawBook({ nope: true }), [defect('entry-id-not-finite')])).toBeNull();
  });

  it('returns null when an unfixable defect is present — alone or beside fixable ones', () => {
    const unfixable: readonly BookDefect['kind'][] = [
      'book-entries-not-array',
      'entry-content-not-string',
      'entry-keys-not-string-array',
      'entry-secondary-keys-not-string-array',
      'entry-extensions-not-object',
    ];
    const book = rawBook([goodEntry(0, { id: NaN }), goodEntry(1, { id: NaN })]);
    for (const kind of unfixable) {
      expect(planBookRepair(book, [defect('entry-id-not-finite'), defect(kind)])).toBeNull();
    }
  });

  it('returns null when no flagged kind is actionable', () => {
    // A fabricated defect list (a caller bug) must not invent changes.
    const book = rawBook([goodEntry(0), goodEntry(1)]);
    expect(planBookRepair(book, [defect('entry-priority-not-finite')])).toBeNull();
    expect(planBookRepair(book, [defect('entry-id-not-finite')])).toBeNull();
  });

  it('returns null for books whose tree cannot be structured-cloned', () => {
    // Functions cannot ride a structured clone — no lossless repair exists.
    const book = rawBook([goodEntry(0, { id: (() => 1) as unknown as number })]);
    expect(planBookRepair(book, [defect('entry-id-not-finite')])).toBeNull();
  });

  it('coerces a parseable string id when the target is free ("7" → 7)', () => {
    const book = rawBook([goodEntry(3), goodEntry(0, { id: '7' as unknown as number })]);
    const repair = plan(book, [defect('entry-id-not-finite')]);

    expect(repair.changes).toEqual([
      { kind: 'coerce-id', entryTitle: 'Entry 0', from: '"7"', to: '7' },
    ]);
    expect(repair.book.entries[1]?.id).toBe(7);
    // The untouched entry rides verbatim.
    expect(repair.book.entries[0]).toEqual(goodEntry(3));
  });

  it('reassigns an unparseable string id ("abc") with a fresh sequential id', () => {
    const book = rawBook([goodEntry(4), goodEntry(0, { id: 'abc' as unknown as number })]);
    const repair = plan(book, [defect('entry-id-not-finite')]);

    expect(repair.changes).toEqual([
      { kind: 'reassign-id', entryTitle: 'Entry 0', from: '"abc"', to: '5' },
    ]);
    expect(repair.book.entries[1]?.id).toBe(5);
  });

  it('keeps the FIRST duplicate and renumbers later occurrences from max(finite ids) + 1', () => {
    const book = rawBook([goodEntry(7), goodEntry(8, { id: 7 }), goodEntry(9, { id: 7 })]);
    const repair = plan(book, [
      defect('entry-id-duplicate'),
      defect('entry-id-duplicate'),
      defect('entry-id-duplicate'),
    ]);

    expect(repair.changes).toEqual([
      { kind: 'reassign-id', entryTitle: 'Entry 8', from: '7', to: '8' },
      { kind: 'reassign-id', entryTitle: 'Entry 9', from: '7', to: '9' },
    ]);
    expect(repair.book.entries.map((entry) => entry.id)).toEqual([7, 8, 9]);
    // Unique after the repair — the validator agrees.
    expect(validateBook(repair.book)).toEqual([]);
  });

  it('renumbers a string duplicate whose coercion target is taken by the keeper', () => {
    // 7 keeps; "7" cannot coerce onto the taken 7 → fresh id.
    const book = rawBook([goodEntry(7), goodEntry(1, { id: '7' as unknown as number })]);
    const repair = plan(book, [defect('entry-id-duplicate'), defect('entry-id-not-finite')]);

    expect(repair.changes).toEqual([
      { kind: 'reassign-id', entryTitle: 'Entry 1', from: '"7"', to: '8' },
    ]);
    expect(repair.book.entries.map((entry) => entry.id)).toEqual([7, 8]);
  });

  it('judges coercion freeness on the post-coercion key, not the raw spelling', () => {
    // " 7 " does not collide with 7 in the uid bag (" 7 " ≠ "7"), but its
    // COERCED value would — so the coercion degrades to a renumber.
    const book = rawBook([goodEntry(7), goodEntry(1, { id: ' 7 ' as unknown as number })]);
    const repair = plan(book, [defect('entry-id-not-finite')]);

    expect(repair.changes).toEqual([
      { kind: 'reassign-id', entryTitle: 'Entry 1', from: '" 7 "', to: '8' },
    ]);
  });

  it('ignores non-finite ids in the max() and counts ids about to be renumbered', () => {
    // max(5) = 5 → fresh ids 6 and 7; the NaN entry (book order first) gets 6.
    const book = rawBook([goodEntry(0, { id: NaN }), goodEntry(5), goodEntry(9, { id: 5 })]);
    const repair = plan(book, [defect('entry-id-not-finite'), defect('entry-id-duplicate')]);

    expect(repair.changes).toEqual([
      { kind: 'reassign-id', entryTitle: 'Entry 0', from: 'NaN', to: '6' },
      { kind: 'reassign-id', entryTitle: 'Entry 9', from: '5', to: '7' },
    ]);
  });

  it('walks fresh ids past taken keys (an approved coercion can sit above the max)', () => {
    // "4" coerces to 4 (free, above max 3); the duplicate 3 then walks past 4.
    const book = rawBook([
      goodEntry(3),
      goodEntry(8, { id: 3 }),
      goodEntry(0, { id: '4' as unknown as number }),
    ]);
    const repair = plan(book, [defect('entry-id-duplicate'), defect('entry-id-not-finite')]);

    expect(repair.changes).toEqual([
      { kind: 'reassign-id', entryTitle: 'Entry 8', from: '3', to: '5' },
      { kind: 'coerce-id', entryTitle: 'Entry 0', from: '"4"', to: '4' },
    ]);
    expect(repair.book.entries.map((entry) => entry.id)).toEqual([3, 5, 4]);
  });

  it('starts fresh ids at 0 when the book has no finite numeric id', () => {
    const book = rawBook([goodEntry(0, { id: 'NaN' as unknown as number })]); // unparseable string
    const repair = plan(book, [defect('entry-id-not-finite')]);
    expect(repair.changes).toEqual([
      { kind: 'reassign-id', entryTitle: 'Entry 0', from: '"NaN"', to: '0' },
    ]);
  });

  it('reassigns nullish, boolean, bigint and object ids with human-readable froms', () => {
    const book = rawBook([
      goodEntry(0, { comment: 'Null', id: null as unknown as number }),
      goodEntry(1, { comment: 'Bool', id: true as unknown as number }),
      goodEntry(2, { comment: 'Big', id: 7n as unknown as number }),
      goodEntry(3, { comment: 'Obj', id: Object.create(null) as unknown as number }),
    ]);
    const repair = plan(book, [defect('entry-id-not-finite')]);

    expect(repair.changes).toEqual([
      { kind: 'reassign-id', entryTitle: 'Null', from: 'null', to: '0' },
      { kind: 'reassign-id', entryTitle: 'Bool', from: 'true', to: '1' },
      { kind: 'reassign-id', entryTitle: 'Big', from: '7n', to: '2' },
      { kind: 'reassign-id', entryTitle: 'Obj', from: '(object)', to: '3' },
    ]);
  });

  it('reassigns an empty-string id ("") with a fresh sequential id', () => {
    // The empty string parses to 0 under bare Number() semantics — the
    // planner rejects it: an empty id is not an id.
    const book = rawBook([goodEntry(4), goodEntry(0, { id: '' as unknown as number })]);
    const repair = plan(book, [defect('entry-id-not-finite')]);
    expect(repair.changes).toEqual([
      { kind: 'reassign-id', entryTitle: 'Entry 0', from: '""', to: '5' },
    ]);
  });

  it('repairs around a non-object entry member instead of throwing on it', () => {
    // A caller bug (no book-entries-not-array defect) must not crash the
    // planner: the non-object member is skipped, the real defects repaired.
    const book = rawBook([goodEntry(0, { id: NaN }), null, goodEntry(2)]);
    const repair = plan(book, [defect('entry-id-not-finite')]);

    expect(repair.changes).toEqual([
      { kind: 'reassign-id', entryTitle: 'Entry 0', from: 'NaN', to: '3' },
    ]);
    expect(repair.book.entries[1]).toBeNull(); // untouched, never fabricated
    expect(
      (repair.book.entries as unknown[]).map((entry) =>
        entry ? (entry as CharacterBookEntry).id : null,
      ),
    ).toEqual([3, null, 2]);
  });

  it('reports a missing id as "(missing)"', () => {
    const book = rawBook([{ keys: ['a'], content: 'x', enabled: true, comment: 'Ghost' }]);
    const repair = plan(book, [defect('entry-id-not-finite')]);
    expect(repair.changes).toEqual([
      { kind: 'reassign-id', entryTitle: 'Ghost', from: '(missing)', to: '0' },
    ]);
  });

  it('defaults a non-finite insertion_order to 100, rendering the prior value readably', () => {
    const book = rawBook([
      goodEntry(0, { comment: 'NaN order', insertion_order: NaN }),
      goodEntry(1, { comment: 'Null order', insertion_order: null as unknown as number }),
      goodEntry(2, { comment: 'Inf order', insertion_order: Number.POSITIVE_INFINITY }),
      goodEntry(3, { comment: 'String order', insertion_order: '5' as unknown as number }),
      goodEntry(4), // present and finite — untouched
      goodEntry(5, { comment: 'No order', insertion_order: undefined }), // absent is legal
    ]);
    const repair = plan(book, [defect('entry-insertion-order-not-finite')]);

    expect(repair.changes).toEqual([
      { kind: 'default-insertion-order', entryTitle: 'NaN order', from: 'NaN', to: '100' },
      { kind: 'default-insertion-order', entryTitle: 'Null order', from: 'null', to: '100' },
      { kind: 'default-insertion-order', entryTitle: 'Inf order', from: '∞', to: '100' },
      { kind: 'default-insertion-order', entryTitle: 'String order', from: '"5"', to: '100' },
    ]);
    expect(repair.book.entries.map((entry) => entry.insertion_order)).toEqual([
      100,
      100,
      100,
      100,
      4,
      undefined,
    ]);
  });

  it('unsets a non-finite priority to undefined, assigning (not deleting) like the house entry shape', () => {
    const book = rawBook([
      goodEntry(0, { comment: 'NaN prio', priority: NaN }),
      goodEntry(1, { comment: 'Neg prio', priority: Number.NEGATIVE_INFINITY }),
      goodEntry(2, { comment: 'Null prio', priority: null as unknown as number }),
      goodEntry(3, { priority: 3 }), // present and finite — untouched
      goodEntry(4, { comment: 'Unset prio', priority: undefined }), // the documented unset — untouched
    ]);
    const repair = plan(book, [defect('entry-priority-not-finite')]);

    expect(repair.changes).toEqual([
      { kind: 'unset-priority', entryTitle: 'NaN prio', from: 'NaN', to: '(unset)' },
      { kind: 'unset-priority', entryTitle: 'Neg prio', from: '-∞', to: '(unset)' },
      { kind: 'unset-priority', entryTitle: 'Null prio', from: 'null', to: '(unset)' },
    ]);
    expect(repair.book.entries.map((entry) => entry.priority)).toEqual([
      undefined,
      undefined,
      undefined,
      3,
      undefined,
    ]);
    // Assigned, not deleted — `createEmptyEntry`'s shape.
    expect(Object.hasOwn(repair.book.entries[0] as object, 'priority')).toBe(true);
  });

  it('emits changes in book order with an entry’s own changes in kind order', () => {
    const book = rawBook([
      goodEntry(0, {
        comment: 'First',
        id: '9' as unknown as number,
        insertion_order: NaN,
        priority: NaN,
      }),
      goodEntry(1, { comment: 'Second', priority: NaN }),
    ]);
    const repair = plan(book, [
      defect('entry-id-not-finite'),
      defect('entry-insertion-order-not-finite'),
      defect('entry-priority-not-finite'),
    ]);

    expect(repair.changes.map((change) => [change.kind, change.entryTitle])).toEqual([
      ['coerce-id', 'First'],
      ['default-insertion-order', 'First'],
      ['unset-priority', 'First'],
      ['unset-priority', 'Second'],
    ]);
  });

  it('falls back through the entryTitle chain: comment, then name, then keys, then Entry <id>', () => {
    const book = rawBook([
      goodEntry(0, { comment: '', name: '', insertion_order: NaN }), // keys join
      goodEntry(1, { comment: '', name: '', keys: [], insertion_order: NaN }), // Entry <id>
      goodEntry(2, { comment: '', name: 'Named only', insertion_order: NaN }), // name
      // An id that is no number still renders: strings quoted, others as '?'.
      goodEntry(3, {
        comment: '',
        name: '',
        keys: [],
        id: 'abc' as unknown as number,
        insertion_order: NaN,
      }),
      goodEntry(4, {
        comment: '',
        name: '',
        keys: [],
        id: null as unknown as number,
        insertion_order: NaN,
      }),
    ]);
    const repair = plan(book, [defect('entry-insertion-order-not-finite')]);
    // The bad ids were NOT flagged, so no id change may be invented — the plan
    // repairs exactly what is broken and nothing else.
    expect(repair.changes.every((change) => change.kind === 'default-insertion-order')).toBe(true);
    expect(repair.changes.map((change) => change.entryTitle)).toEqual([
      'key-0',
      'Entry 1',
      'Named only',
      'Entry "abc"',
      'Entry ?',
    ]);
  });

  it('is idempotent: the repaired book validates clean and re-plans to null', () => {
    const book = rawBook([
      goodEntry(0, { id: '7' as unknown as number, insertion_order: NaN, priority: NaN }),
      goodEntry(7),
      goodEntry(8, { id: 7, priority: null as unknown as number }),
      goodEntry(9, { id: 'abc' as unknown as number }),
    ]);
    const defects = validateBook(book);
    assert(defects.length > 0);

    const repair = plan(book, defects);
    expect(validateBook(repair.book)).toEqual([]);

    const secondPass = validateBook(repair.book);
    expect(planBookRepair(repair.book, secondPass)).toBeNull();
  });

  it('preserves unknown vendor keys byte-for-byte in the repaired copy', () => {
    const vendorEntry = {
      ...goodEntry(0, { id: '5' as unknown as number }), // the one flagged field: a string id
      color: '#ff0000',
      extensions: { position: 4, vendor_plugin: { deep: [1, { keep: true }] } },
    };
    const untouchedEntry = {
      ...goodEntry(1),
      color: 'blue',
      extra_unknown: { nested: 'data' },
    };
    const book = rawBook([vendorEntry, untouchedEntry], {
      stlo: { legacy: true },
      randomExtension: 'ride-along',
    });
    const original = structuredClone(book) as unknown as Record<string, unknown>;

    const repair = plan(book, [defect('entry-id-not-finite')]);
    expect(repair.changes).toEqual([
      { kind: 'coerce-id', entryTitle: 'Entry 0', from: '"5"', to: '5' },
    ]);
    const repaired = repair.book as unknown as Record<string, unknown>;

    // Book-level vendor keys byte-identical.
    expect(JSON.stringify(repaired['extensions'])).toBe(JSON.stringify(original['extensions']));
    expect(JSON.stringify(repaired['stlo'])).toBe(JSON.stringify(original['stlo']));
    expect(JSON.stringify(repaired['randomExtension'])).toBe(
      JSON.stringify(original['randomExtension']),
    );
    // The untouched entry byte-identical, key order included.
    expect(JSON.stringify(repair.book.entries[1])).toBe(
      JSON.stringify((original['entries'] as unknown[])[1]),
    );
    // The repaired entry differs ONLY in `id` — every other byte, in order,
    // survives (assignment keeps the key's position, unlike a rebuild).
    const originalVendorEntry = (original['entries'] as unknown[])[0] as Record<string, unknown>;
    const repairedVendorEntry = repair.book.entries[0] as unknown as Record<string, unknown>;
    expect(repairedVendorEntry['id']).toBe(5);
    const { id: _repairedId, ...repairedRest } = repairedVendorEntry;
    const { id: _originalId, ...originalRest } = originalVendorEntry;
    expect(JSON.stringify(repairedRest)).toBe(JSON.stringify(originalRest));
  });

  it('never mutates the input book', () => {
    const book = rawBook([goodEntry(7), goodEntry(8, { id: 7, insertion_order: NaN })]);
    const before = structuredClone(book);
    plan(book, [defect('entry-id-duplicate'), defect('entry-insertion-order-not-finite')]);
    expect(book).toEqual(before);
  });
});
