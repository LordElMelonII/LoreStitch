import {
  CharacterBook,
  CharacterBookEntry,
  ST_POSITION,
  createEmptyBook,
  createEmptyEntry,
  detectLoreFileFormat,
  characterBookToStNative,
  entryCharacterFilter,
  entryTitle,
  entryTriggerState,
  entryTriggers,
  estimateTokens,
  normalizeBookPositions,
  stNativeToCharacterBook,
  stNumberToPosition,
  toSpecCompliantBook,
  triggerStatePatch,
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

    it('no longer detects character cards (card support was removed)', () => {
      expect(
        detectLoreFileFormat({ spec: 'chara_card_v2', spec_version: '2.0', data: {} }),
      ).toBeNull();
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
    });

    it('normalizes per-entry extensions the editor edits', () => {
      const entry = stNativeToCharacterBook({
        entries: {
          3: nativeEntry({
            matchCharacterDescription: true,
            matchPersonaDescription: false,
            triggers: ['normal', 'quiet'],
            scanDepth: 2,
            matchWholeWords: false,
            sticky: 3,
            automationId: 'qr-run',
            characterFilter: { isExclude: true, names: ['Rin'], tags: ['t1'] },
          }),
        },
      }).entries[0];

      expect(entry.extensions?.['match_character_description']).toBe(true);
      expect(entry.extensions?.['match_persona_description']).toBe(false);
      expect(entry.extensions?.['triggers']).toEqual(['normal', 'quiet']);
      expect(entry.extensions?.['scan_depth']).toBe(2);
      expect(entry.extensions?.['match_whole_words']).toBe(false);
      expect(entry.extensions?.['sticky']).toBe(3);
      expect(entry.extensions?.['automation_id']).toBe('qr-run');
      expect(entry.extensions?.['character_filter']).toEqual({
        is_exclude: true,
        names: ['Rin'],
        tags: ['t1'],
      });
      expect(entryTriggers(entry)).toEqual(['normal', 'quiet']);
      expect(entryCharacterFilter(entry)).toEqual({
        is_exclude: true,
        names: ['Rin'],
        tags: ['t1'],
      });
    });

    it('entryCharacterFilter falls back to the legacy verbatim shape', () => {
      const entry = createEmptyEntry(1);
      entry.extensions = {
        characterFilter: { isExclude: true, names: ['Saber'], tags: [] },
      };
      expect(entryCharacterFilter(entry)).toEqual({
        is_exclude: true,
        names: ['Saber'],
        tags: [],
      });
      // Books created before normalization have neither shape.
      expect(entryCharacterFilter(createEmptyEntry(2))).toEqual({
        is_exclude: false,
        names: [],
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

    it('maps every world_info_position value to a named position', () => {
      expect(stNumberToPosition(0)).toBe('before_char');
      expect(stNumberToPosition(1)).toBe('after_char');
      expect(stNumberToPosition(2)).toBe('before_an');
      expect(stNumberToPosition(3)).toBe('after_an');
      expect(stNumberToPosition(4)).toBe('at_depth');
      expect(stNumberToPosition(5)).toBe('before_em');
      expect(stNumberToPosition(6)).toBe('after_em');
      expect(stNumberToPosition(7)).toBe('outlet');
      expect(stNumberToPosition(99)).toBe('before_char');

      const atDepth = stNativeToCharacterBook({
        entries: { 5: nativeEntry({ uid: 5, position: ST_POSITION.atDepth, depth: 2, role: 1 }) },
      }).entries[0];
      expect(atDepth.position).toBe('at_depth');
      expect(atDepth.extensions?.['position']).toBe(ST_POSITION.atDepth);
      expect(atDepth.extensions?.['depth']).toBe(2);
      expect(atDepth.extensions?.['role']).toBe(1);
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
      expect(restored.scanDepth).toBe(original.scanDepth);
      expect(restored.matchWholeWords).toBe(original.matchWholeWords);
      expect(restored.automationId).toBe(original.automationId);
      expect(restored.sticky).toBe(original.sticky);
      expect(restored.delayUntilRecursion).toBe(original.delayUntilRecursion);
      expect(restored.triggers).toEqual(original.triggers);
      expect(restored.characterFilter).toEqual(original.characterFilter);
      // Match flags round-trip through the normalized extensions.
      const flagged = characterBookToStNative(
        stNativeToCharacterBook({
          entries: { 4: nativeEntry({ uid: 4, matchCharacterDepthPrompt: true }) },
        }),
      ).entries['4'];
      expect(flagged.matchCharacterDepthPrompt).toBe(true);
      expect(flagged.matchCharacterDescription).toBe(false);
    });

    it('exports a string position even without extensions.position', () => {
      const entry = createEmptyEntry(1);
      entry.position = 'at_depth';
      delete (entry.extensions ?? {})['position'];
      const native = characterBookToStNative({ extensions: {}, entries: [entry] });
      expect(native.entries['1'].position).toBe(ST_POSITION.atDepth);
    });
  });

  describe('spec compliance & re-import normalization', () => {
    it('toSpecCompliantBook clamps position to the spec but keeps the numeric value', () => {
      const entry = createEmptyEntry(1);
      entry.position = 'at_depth';
      const book: CharacterBook = { extensions: {}, entries: [entry] };
      const spec = toSpecCompliantBook(book);

      expect(spec.entries[0].position).toBe('after_char');
      expect(spec.entries[0].extensions?.['position']).toBe(ST_POSITION.atDepth);
      // Re-importing the spec-clamped book restores the real position.
      expect(normalizeBookPositions(spec).entries[0].position).toBe('at_depth');
    });

    it('normalizeBookPositions restores the real position from extensions', () => {
      const book: CharacterBook = {
        extensions: {},
        entries: [
          { ...createEmptyEntry(0), position: 'before_char', extensions: { position: 7 } },
          { ...createEmptyEntry(1), position: 'after_char', extensions: {} },
        ],
      };
      const normalized = normalizeBookPositions(book);
      expect(normalized.entries[0].position).toBe('outlet');
      expect(normalized.entries[1].position).toBe('after_char');
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

  describe('trigger strategy (constant / normal / vectorized)', () => {
    it('reads the tri-state the same way as world-info.js', () => {
      expect(entryTriggerState(createEmptyEntry(0))).toBe('normal');
      expect(entryTriggerState({ ...createEmptyEntry(0), constant: true })).toBe('constant');
      expect(entryTriggerState({ ...createEmptyEntry(0), extensions: { vectorized: true } })).toBe(
        'vectorized',
      );
      // Constant wins, mirroring `entry.constant === true ? 'constant' : ...`.
      expect(
        entryTriggerState({
          ...createEmptyEntry(0),
          constant: true,
          extensions: { vectorized: true },
        }),
      ).toBe('constant');
    });

    it('triggerStatePatch makes the states mutually exclusive and keeps extensions', () => {
      const entry: CharacterBookEntry = {
        ...createEmptyEntry(0),
        constant: true,
        extensions: { probability: 80 },
      };

      const toVectorized = { ...entry, ...triggerStatePatch(entry, 'vectorized') };
      expect(toVectorized.constant).toBe(false);
      expect(toVectorized.extensions['vectorized']).toBe(true);
      expect(toVectorized.extensions['probability']).toBe(80);
      expect(entryTriggerState(toVectorized)).toBe('vectorized');

      const toNormal = { ...toVectorized, ...triggerStatePatch(toVectorized, 'normal') };
      expect(toNormal.constant).toBe(false);
      expect(toNormal.extensions['vectorized']).toBe(false);
      expect(entryTriggerState(toNormal)).toBe('normal');

      const toConstant = { ...toNormal, ...triggerStatePatch(toNormal, 'constant') };
      expect(toConstant.constant).toBe(true);
      expect(entryTriggerState(toConstant)).toBe('constant');
    });

    it('vectorized entries survive a native round trip', () => {
      const book = stNativeToCharacterBook({
        entries: { 3: nativeEntry({ vectorized: true }) },
      });
      expect(entryTriggerState(book.entries[0])).toBe('vectorized');
      const native = characterBookToStNative(book).entries['3'];
      expect(native.vectorized).toBe(true);
      expect(native.constant).toBe(false);
    });
  });
});
