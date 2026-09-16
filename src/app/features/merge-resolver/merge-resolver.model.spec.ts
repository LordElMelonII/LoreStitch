import { createEmptyEntry } from '../../core/models/lorebook.model';
import { findMergeMatch, mergeEntriesIdentical } from './merge-resolver.model';

describe('merge matching', () => {
  function local(id: number, keys: string[], comment = '') {
    const entry = createEmptyEntry(id);
    entry.keys = keys;
    entry.comment = comment;
    return entry;
  }

  describe('findMergeMatch', () => {
    it('matches by uid first', () => {
      const current = [local(1, ['a']), local(2, ['b'])];
      const incoming = local(2, ['zzz']);
      expect(findMergeMatch(incoming, current)?.id).toBe(2);
    });

    it('matches by overlapping activation key when uids differ', () => {
      const current = [local(1, ['Greater Grail'])];
      const incoming = local(99, ['leyline', 'Greater Grail']);
      expect(findMergeMatch(incoming, current)?.id).toBe(1);
    });

    it('normalizes keys (case / whitespace) for the key match', () => {
      const current = [local(1, ['greater grail'])];
      const incoming = local(99, ['  Greater Grail ']);
      expect(findMergeMatch(incoming, current)?.id).toBe(1);
    });

    it('falls back to the identical normalized name', () => {
      const current = [local(1, ['unrelated'], 'Saber (Artoria)')];
      const incoming = local(99, ['no-overlap'], 'saber (artoria)');
      expect(findMergeMatch(incoming, current)?.id).toBe(1);
    });

    it('never matches an incoming entry with no name or key overlap', () => {
      const current = [local(1, ['a'], 'Named')];
      expect(findMergeMatch(local(99, ['b']), current)).toBeNull();
      expect(findMergeMatch(local(99, ['b'], 'Other'), current)).toBeNull();
    });
  });

  describe('mergeEntriesIdentical', () => {
    it('is true for same keys and byte-identical content', () => {
      const a = local(1, ['k']);
      const b = local(2, ['k']);
      a.content = b.content = '<lore>';
      expect(mergeEntriesIdentical(a, b)).toBe(true);
    });

    it('is false when the content differs', () => {
      const a = local(1, ['k']);
      const b = local(2, ['k']);
      a.content = '<lore>';
      b.content = '<other lore>';
      expect(mergeEntriesIdentical(a, b)).toBe(false);
    });
  });
});
