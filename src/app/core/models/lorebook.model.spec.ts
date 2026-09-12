import {
  CharacterBook,
  createEmptyBook,
  createEmptyEntry,
  detectLoreFileFormat,
  characterBookToStNative,
  entryTitle,
  estimateTokens,
  stNativeToCharacterBook,
} from './lorebook.model';

/** Representative native entry carrying every field world-info.js defines. */
function nativeEntry(overrides: Record<string, unknown> = {}) {
  return {
    uid: 3,
    key: ['Greater Grail', 'leyline'],
    keysecondary: ['ritual'],
    comment: 'The Greater Holy Grail',
    content: '<greater_grail>\nA wish-granting system.\n</greater_grail>',
    constant: false,
    vectorized: false,
    selective: true,
    selectiveLogic: 1,
    addMemo: true,
    order: 200,
    position: 1,
    disable: false,
    ignoreBudget: true,
    excludeRecursion: true,
    preventRecursion: true,
    delayUntilRecursion: 2,
    probability: 80,
    useProbability: true,
    depth: 6,
    outletName: '',
    group: 'grail',
    groupOverride: false,
    groupWeight: 50,
    scanDepth: 3,
    caseSensitive: true,
    matchWholeWords: false,
    useGroupScoring: 1,
    automationId: 'test-automation',
    role: 0,
    sticky: 5,
    cooldown: 0,
    delay: null,
    triggers: [],
    displayIndex: 7,
    characterFilter: { isExclude: true, names: ['Rin'], tags: [] },
    ...overrides,
  };
}

describe('lorebook model', () => {
  describe('detectLoreFileFormat', () => {
    it('detects a native SillyTavern world-info export', () => {
      expect(detectLoreFileFormat({ stlo: {}, entries: { 0: nativeEntry() } })).toBe(
        'sillytavern_native',
      );
    });

    it('detects a TavernCardV2', () => {
      expect(detectLoreFileFormat({ spec: 'chara_card_v2', spec_version: '2.0', data: {} })).toBe(
        'tavern_card_v2',
      );
    });

    it('detects a LoreStitch project archive', () => {
      expect(
        detectLoreFileFormat({ format: 'lorestitch-project', version: 1, workspace: {} }),
      ).toBe('stproj');
    });

    it('detects a bare CharacterBook', () => {
      expect(
        detectLoreFileFormat({
          name: 'book',
          extensions: {},
          entries: [{ content: 'x', keys: [] }],
        }),
      ).toBe('character_book');
    });

    it('returns null for anything else', () => {
      expect(detectLoreFileFormat({})).toBeNull();
      expect(detectLoreFileFormat('nope')).toBeNull();
      expect(detectLoreFileFormat(null)).toBeNull();
    });
  });

  describe('stNativeToCharacterBook', () => {
    it('maps the core V2 fields from world-info.js names', () => {
      const book = stNativeToCharacterBook({ entries: { 3: nativeEntry() } }, 'Fuyuki');
      expect(book.name).toBe('Fuyuki');
      expect(book.entries).toHaveLength(1);
      const entry = book.entries[0];
      expect(entry.id).toBe(3);
      expect(entry.keys).toEqual(['Greater Grail', 'leyline']);
      expect(entry.secondary_keys).toEqual(['ritual']);
      expect(entry.content).toContain('wish-granting');
      expect(entry.comment).toBe('The Greater Holy Grail');
      expect(entry.enabled).toBe(true);
      expect(entry.insertion_order).toBe(200);
      expect(entry.position).toBe('after_char');
      expect(entry.selective).toBe(true);
      expect(entry.constant).toBe(false);
    });

    it('preserves ST-only values inside extensions', () => {
      const entry = stNativeToCharacterBook({ entries: { 3: nativeEntry() } }).entries[0];
      expect(entry.extensions?.['position']).toBe(1);
      expect(entry.extensions?.['exclude_recursion']).toBe(true);
      expect(entry.extensions?.['prevent_recursion']).toBe(true);
      expect(entry.extensions?.['probability']).toBe(80);
      expect(entry.extensions?.['depth']).toBe(6);
      expect(entry.extensions?.['selectiveLogic']).toBe(1);
      expect(entry.extensions?.['group']).toBe('grail');
      expect(entry.extensions?.['display_index']).toBe(7);
      expect(entry.extensions?.['ignore_budget']).toBe(true);
      expect(entry.extensions?.['characterFilter']).toEqual({
        isExclude: true,
        names: ['Rin'],
        tags: [],
      });
    });

    it('inverts disable into enabled and orders entries by display index', () => {
      const data = {
        entries: {
          '1': nativeEntry({ uid: 1, displayIndex: 9, disable: true }),
          '0': nativeEntry({ uid: 0, displayIndex: 4 }),
        },
      };
      const book = stNativeToCharacterBook(data);
      expect(book.entries.map((e) => e.id)).toEqual([0, 1]);
      expect(book.entries[1].enabled).toBe(false);
    });
  });

  describe('characterBookToStNative round trip', () => {
    it('restores the original native shape from a converted book', () => {
      const original = nativeEntry();
      const book = stNativeToCharacterBook({ entries: { 3: original } });
      const native = characterBookToStNative(book);
      const restored = native.entries['3'];

      expect(restored.uid).toBe(3);
      expect(restored.key).toEqual(original.key);
      expect(restored.keysecondary).toEqual(original.keysecondary);
      expect(restored.comment).toBe(original.comment);
      expect(restored.content).toBe(original.content);
      expect(restored.order).toBe(original.order);
      expect(restored.position).toBe(original.position);
      expect(restored.disable).toBe(original.disable);
      expect(restored.selectiveLogic).toBe(original.selectiveLogic);
      expect(restored.probability).toBe(original.probability);
      expect(restored.depth).toBe(original.depth);
      expect(restored.group).toBe(original.group);
      expect(restored.displayIndex).toBe(original.displayIndex);
      expect(restored.excludeRecursion).toBe(original.excludeRecursion);
      expect(restored['characterFilter']).toEqual(original['characterFilter']);
    });
  });

  describe('helpers', () => {
    it('entryTitle prefers comment, then keys, then id', () => {
      expect(entryTitle({ ...createEmptyEntry(4), comment: 'Grail' })).toBe('Grail');
      expect(entryTitle({ ...createEmptyEntry(4), comment: '', keys: ['a', 'b'] })).toBe('a, b');
      expect(entryTitle(createEmptyEntry(4))).toBe('Entry 4');
    });

    it('estimateTokens uses the length/3.5 heuristic', () => {
      expect(estimateTokens('')).toBe(0);
      expect(estimateTokens('a'.repeat(35))).toBe(10);
    });

    it('createEmptyBook and createEmptyEntry produce sane defaults', () => {
      const book = createEmptyBook('Test');
      expect(book.name).toBe('Test');
      expect(book.entries).toEqual([]);
      const entry = createEmptyEntry(0);
      expect(entry.enabled).toBe(true);
      expect(entry.insertion_order).toBe(100);
      expect(entry.extensions?.['probability']).toBe(100);
    });
  });
});
