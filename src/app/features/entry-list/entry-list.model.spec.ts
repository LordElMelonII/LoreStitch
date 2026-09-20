import { entrySearchHaystack, matchesQuery } from './entry-list.model';

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
