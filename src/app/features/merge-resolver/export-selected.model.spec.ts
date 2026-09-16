import { createEmptyEntry } from '../../core/models/lorebook.model';
import { checkExportDependencies } from './export-selected.model';

describe('checkExportDependencies', () => {
  function selectiveEntry(id: number, keys: string[], secondary: string[]) {
    const entry = createEmptyEntry(id);
    entry.keys = keys;
    entry.secondary_keys = secondary;
    return entry;
  }

  it('flags a secondary key whose only targets are not exported', () => {
    const saber = selectiveEntry(0, ['Saber'], ['Artoria']);
    const artoria = selectiveEntry(1, ['Artoria'], []);

    const warnings = checkExportDependencies([saber, artoria], new Set([0]));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      entryId: 0,
      key: 'Artoria',
      targetCount: 1,
    });
  });

  it('stays silent when the referenced entry is exported too', () => {
    const saber = selectiveEntry(0, ['Saber'], ['Artoria']);
    const artoria = selectiveEntry(1, ['Artoria'], []);
    expect(checkExportDependencies([saber, artoria], new Set([0, 1]))).toEqual([]);
  });

  it('stays silent when a secondary key matches no entry (chat-text key)', () => {
    const saber = selectiveEntry(0, ['Saber'], ['holy grail war']);
    expect(checkExportDependencies([saber], new Set([0]))).toEqual([]);
  });

  it('matches keys case-insensitively and reports the first target title', () => {
    const saber = selectiveEntry(0, ['Saber'], [' ARTORIA ']);
    const a = selectiveEntry(1, ['artoria'], []);
    const b = selectiveEntry(2, ['Artoria Pendragon', 'artoria'], []);
    b.comment = 'King of Knights';

    const warnings = checkExportDependencies([saber, a, b], new Set([0]));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.targetCount).toBe(2);
    // First target in book order; entry `a` has no comment, so its keys
    // double as the title.
    expect(warnings[0]?.targetTitle).toBe('artoria');
  });

  it('ignores entries without secondary keys and blank keys', () => {
    const plain = selectiveEntry(0, ['Saber'], []);
    const blanks = selectiveEntry(1, ['X'], ['', '  ']);
    expect(checkExportDependencies([plain, blanks], new Set([0, 1]))).toEqual([]);
  });

  it('does not flag a self-reference', () => {
    const recursive = selectiveEntry(0, ['Saber'], ['saber']);
    expect(checkExportDependencies([recursive], new Set([0]))).toEqual([]);
  });
});
