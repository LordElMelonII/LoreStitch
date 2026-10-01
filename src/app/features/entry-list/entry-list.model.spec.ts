import { entrySearchHaystack } from '../../core/services/entry-memo';
import {
  applyRangeSelection,
  matchesQuery,
  type EntryListItem,
} from './entry-list.model';

describe('entrySearchHaystack', () => {
  const title = 'Crimson Dragon';
  const keys = ['Wyrm', 'Fire'];
  const tags = ['boss', 'main-quest'];
  const content = 'Guards the western pass.';
  const haystack = entrySearchHaystack(title, keys, tags, content);

  it('joins title, keys, tags and content on newline, folded once', () => {
    expect(haystack).toBe('crimson dragon\nwyrm\nfire\nboss\nmain-quest\nguards the western pass.');
  });

  it('handles entries with no keys or tags', () => {
    expect(entrySearchHaystack('Title', [], [], 'Body')).toBe('title\nbody');
  });

  it('folds case for title, key, tag and content hits alike', () => {
    expect(matchesQuery(haystack, 'crimson')).toBe(true); // title
    expect(matchesQuery(haystack, 'wyrm')).toBe(true); // key
    expect(matchesQuery(haystack, 'boss')).toBe(true); // tag
    expect(matchesQuery(haystack, 'western pass')).toBe(true); // content
    // The caller folds the query once; a raw uppercase query is not folded
    // again per entry.
    expect(matchesQuery(haystack, 'CRIMSON')).toBe(false);
  });

  it('matches multi-word queries within a single field only', () => {
    // A phrase contained in one field is a hit...
    expect(matchesQuery(haystack, 'crimson dragon')).toBe(true);
    expect(matchesQuery(haystack, 'western pass')).toBe(true);
    // ...but a phrase spread across two fields is not: the '\n' separator
    // sits between them, and the folded haystack keeps it.
    const split = entrySearchHaystack('Crimson', [], [], 'Dragon');
    expect(matchesQuery(split, 'crimson dragon')).toBe(false);
    expect(matchesQuery(split, 'crimson\ndragon')).toBe(true); // untypable: inputs sanitize newlines
  });

  it('matches exactly the same queries as the previous per-field scan', () => {
    // The predicate entry-list.ts ran before the haystack: each field
    // lowercased and checked separately. A single-line input cannot produce
    // a query containing '\n', and a '\n'-free query that is a substring of
    // the join must lie wholly inside one field — so both scans agree on
    // every typable query. This pins the Task 07 equivalence argument.
    const legacyScan = (query: string): boolean =>
      title.toLowerCase().includes(query) ||
      keys.some((k) => k.toLowerCase().includes(query)) ||
      tags.some((tag) => tag.toLowerCase().includes(query)) ||
      content.toLowerCase().includes(query);
    const queries = [
      '', 'crimson', 'dragon', 'wyrm', 'fire', 'boss', 'quest', 'main',
      'western pass', 'crimson dragon', 'guards', 'the', 'ss.', 'm dragon',
      'zzz', 'w', 'dragon wyrm', 'fire boss',
    ];
    for (const query of queries) {
      expect(matchesQuery(haystack, query)).toBe(legacyScan(query));
    }
  });
});

describe('applyRangeSelection', () => {
  /** Minimal row fixture — the range math only reads `id`. */
  function viewItem(id: number): EntryListItem {
    return {
      id,
      title: `Entry ${id}`,
      keys: [],
      enabled: true,
      state: 'normal',
      dirty: false,
      content: '',
      tokens: 0,
      tags: [],
      search: `entry ${id}`,
    };
  }

  function view(...ids: number[]): EntryListItem[] {
    return ids.map(viewItem);
  }

  it('selects the inclusive slice in either direction, preserving ids outside it', () => {
    const current = new Set([5]);
    // Anchor before the gesture row...
    expect(applyRangeSelection(current, view(1, 2, 3, 4, 5), 2, 4, true)).toEqual(
      new Set([2, 3, 4, 5]),
    );
    // ...and after it (either direction, same inclusive slice).
    expect(applyRangeSelection(current, view(1, 2, 3, 4, 5), 4, 2, true)).toEqual(
      new Set([2, 3, 4, 5]),
    );
    // A single-row range when both endpoints meet.
    expect(applyRangeSelection(current, view(1, 2, 3), 2, 2, true)).toEqual(new Set([2, 5]));
  });

  it('deselects the slice when the target is false, preserving the rest', () => {
    const current = new Set([1, 2, 3, 4, 9]);
    expect(applyRangeSelection(current, view(1, 2, 3, 4, 5), 3, 1, false)).toEqual(new Set([4, 9]));
    expect(applyRangeSelection(current, view(1, 2, 3, 4, 5), 1, 3, false)).toEqual(new Set([4, 9]));
    // A partially selected set still gets the full slice added: the
    // component computes the target from the gesture row, not per id.
    expect(applyRangeSelection(new Set([2]), view(1, 2, 3, 4, 5), 1, 4, true)).toEqual(
      new Set([1, 2, 3, 4]),
    );
  });

  it('returns the same reference when either endpoint is missing from the view', () => {
    const current = new Set([1, 2]);
    const entries = view(1, 2, 3);
    // The component reads the by-reference result as its degradation signal
    // (plain single toggle of the gesture row), so identity is the contract.
    expect(applyRangeSelection(current, entries, 9, 2, true)).toBe(current);
    expect(applyRangeSelection(current, entries, 1, 9, true)).toBe(current);
    expect(applyRangeSelection(current, [], 1, 1, true)).toBe(current);
  });
});
