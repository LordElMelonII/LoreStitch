import {
  CharacterBook,
  CharacterBookEntry,
  ST_POSITION,
  WI_POSITION_TO_ST,
  createEmptyBook,
  createEmptyEntry,
  detectLoreFileFormat,
  characterBookToStNative,
  entryCharacterFilter,
  entryStPosition,
  entryTitle,
  entryTriggerState,
  entryTriggers,
  entryTags,
  extractSubBook,
  withEntryTags,
  isCharacterBook,
  isLintRuleId,
  isProjectWorkspace,
  isSillyTavernWorldInfo,
  normalizeBookPositions,
  normalizeImportedBook,
  sanitizeLintPrefs,
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
      assert(entry);
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
      assert(entry);
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
      assert(entry);

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
      assert(book.entries[1]);
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
      assert(atDepth);
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
      assert(restored);

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
      assert(flagged);
      expect(flagged.matchCharacterDepthPrompt).toBe(true);
      expect(flagged.matchCharacterDescription).toBe(false);
    });

    it('exports a string position even without extensions.position', () => {
      const entry = createEmptyEntry(1);
      entry.position = 'at_depth';
      delete (entry.extensions ?? {})['position'];
      const native = characterBookToStNative({ extensions: {}, entries: [entry] });
      assert(native.entries['1']);
      expect(native.entries['1'].position).toBe(ST_POSITION.atDepth);
    });
  });

  describe('spec compliance & re-import normalization', () => {
    it('toSpecCompliantBook clamps position to the spec but keeps the numeric value', () => {
      const entry = createEmptyEntry(1);
      // Mirror the app's edit flow (EntryUpdatesService.setPosition): the spec
      // string and the numeric extensions mirror change together.
      entry.position = 'at_depth';
      entry.extensions = { ...entry.extensions, position: ST_POSITION.atDepth };
      const book: CharacterBook = { extensions: {}, entries: [entry] };
      const spec = toSpecCompliantBook(book);
      assert(spec.entries[0]);
      expect(spec.entries[0].position).toBe('after_char');
      expect(spec.entries[0].extensions?.['position']).toBe(ST_POSITION.atDepth);
      // Re-importing the spec-clamped book restores the real position.
      const reimported = normalizeBookPositions(spec);
      assert(reimported.entries[0]);
      expect(reimported.entries[0].position).toBe('at_depth');
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
      assert(normalized.entries[0]);
      assert(normalized.entries[1]);
      expect(normalized.entries[0].position).toBe('outlet');
      expect(normalized.entries[1].position).toBe('after_char');
    });
  });

  describe('numeric position fidelity', () => {
    /** Applies a position edit the way `EntryUpdatesService.setPosition` does. */
    function setPosition(entry: CharacterBookEntry, value: keyof typeof WI_POSITION_TO_ST): void {
      entry.position = value;
      entry.extensions = { ...entry.extensions, position: WI_POSITION_TO_ST[value] };
    }

    it('round-trips an out-of-enum numeric position (99) untouched', () => {
      const book = stNativeToCharacterBook({
        entries: { 9: nativeEntry({ uid: 9, position: 99 }) },
      });
      const entry = book.entries[0];
      assert(entry);
      // The unmapped number falls back to the spec string but stays parked raw.
      expect(entry.position).toBe('before_char');
      expect(entry.extensions?.['position']).toBe(99);

      const native = characterBookToStNative(book);
      assert(native.entries['9']);
      expect(native.entries['9'].position).toBe(99);
    });

    it('keeps 99 through a V2 export and a re-import', () => {
      const book = stNativeToCharacterBook({
        entries: { 9: nativeEntry({ uid: 9, position: 99 }) },
      });
      const spec = toSpecCompliantBook(book);
      assert(spec.entries[0]);
      const reimported = normalizeBookPositions(spec);
      assert(reimported.entries[0]);
      const exported = characterBookToStNative(reimported);
      assert(exported.entries['9']);
      expect(spec.entries[0].extensions?.['position']).toBe(99);
      expect(reimported.entries[0].extensions?.['position']).toBe(99);
      expect(exported.entries['9'].position).toBe(99);
    });

    it('a synced in-app position edit is authoritative on export', () => {
      const book = stNativeToCharacterBook({
        entries: { 9: nativeEntry({ uid: 9, position: 99 }) },
      });
      const entry = book.entries[0];
      assert(entry);
      setPosition(entry, 'at_depth');
      expect(entryStPosition(entry)).toBe(ST_POSITION.atDepth);
      const native = characterBookToStNative(book);
      assert(native.entries['9']);
      expect(native.entries['9'].position).toBe(ST_POSITION.atDepth);
    });

    it('in-enum positions keep their existing mapping', () => {
      const book = stNativeToCharacterBook({
        entries: { 9: nativeEntry({ uid: 9, position: 1 }) },
      });
      assert(book.entries[0]);
      expect(book.entries[0].position).toBe('after_char');
      expect(entryStPosition(book.entries[0])).toBe(1);
      const native = characterBookToStNative(book);
      assert(native.entries['9']);
      expect(native.entries['9'].position).toBe(1);
    });

    it('the numeric mirror outranks a stale spec string on legacy books', () => {
      const entry = createEmptyEntry(1);
      entry.position = 'at_depth'; // stale — the mirror still says before_char (0)
      expect(entryStPosition(entry)).toBe(ST_POSITION.before);
    });
  });

  describe('addMemo fidelity', () => {
    it('captures the original addMemo flag at import', () => {
      const entry = stNativeToCharacterBook({
        entries: { 3: nativeEntry({ addMemo: false }) },
      }).entries[0];
      assert(entry);
      expect(entry.extensions?.['native_add_memo']).toBe(false);
    });

    it('addMemo:false with a non-empty comment stays false on export', () => {
      const book = stNativeToCharacterBook({
        entries: { 3: nativeEntry({ addMemo: false }) },
      });
      assert(book.entries[0]);
      expect(book.entries[0].comment).toContain('Holy Grail');
      const native = characterBookToStNative(book);
      assert(native.entries['3']);
      expect(native.entries['3'].addMemo).toBe(false);
    });

    it('addMemo:true with an empty comment stays true on export', () => {
      const book = stNativeToCharacterBook({
        entries: { 3: nativeEntry({ addMemo: true, comment: '' }) },
      });
      const native = characterBookToStNative(book);
      assert(native.entries['3']);
      expect(native.entries['3'].addMemo).toBe(true);
    });

    it('fresh in-app entries still derive addMemo from comment presence', () => {
      const plain = createEmptyEntry(0);
      const commented = { ...createEmptyEntry(1), comment: 'A memo' };
      const native = characterBookToStNative({ extensions: {}, entries: [plain, commented] });
      assert(native.entries['0']);
      assert(native.entries['1']);
      expect(plain.extensions?.['native_add_memo']).toBeUndefined();
      expect(native.entries['0'].addMemo).toBe(false);
      expect(native.entries['1'].addMemo).toBe(true);
    });

    it('native_add_memo never leaks as a loose native key', () => {
      const native = characterBookToStNative(
        stNativeToCharacterBook({ entries: { 3: nativeEntry() } }),
      );
      assert(native.entries['3']);
      expect(Object.keys(native.entries['3'])).not.toContain('native_add_memo');
    });
  });

  describe('import validation guards', () => {
    it('isCharacterBook enforces string content and string[] keys per entry', () => {
      // Raw JSON: the guard must accept books that miss normalizable scalars.
      const valid: unknown = {
        extensions: {},
        entries: [{ keys: ['a'], content: 'x', extensions: {} }],
      };
      expect(isCharacterBook(valid)).toBe(true);
      // The entryTitle crash: keys missing or wrong-typed.
      expect(
        isCharacterBook({ extensions: {}, entries: [{ content: 'x' }] }),
      ).toBe(false);
      expect(
        isCharacterBook({ extensions: {}, entries: [{ keys: 'a', content: 'x' }] }),
      ).toBe(false);
      expect(
        isCharacterBook({ extensions: {}, entries: [{ keys: [1], content: 'x' }] }),
      ).toBe(false);
      // Wrong-typed critical scalar.
      expect(
        isCharacterBook({ extensions: {}, entries: [{ keys: [], content: 5 }] }),
      ).toBe(false);
      expect(isCharacterBook({ entries: 'nope' })).toBe(false);
      expect(isCharacterBook(null)).toBe(false);
    });

    it('isProjectWorkspace accepts the structure the workspace/VCS code indexes', () => {
      const workspace = {
        id: 'p1',
        title: 'Project',
        createdAt: 1,
        updatedAt: 2,
        targetType: 'standalone_lorebook',
        activeBook: { name: 'Book', entries: [{ keys: ['a'], content: 'x' }] },
        headCommitId: 'c1',
        commits: [
          {
            id: 'c1',
            parentId: null,
            timestamp: 3,
            message: 'Initial commit',
            snapshot: { entries: [{ keys: ['a'], content: 'x' }] },
          },
        ],
      };
      expect(isProjectWorkspace(workspace)).toBe(true);
    });

    it('isProjectWorkspace rejects malformed archives', () => {
      expect(isProjectWorkspace({})).toBe(false);
      // Missing commits (the VCS spreads and searches the array).
      expect(
        isProjectWorkspace({
          id: 'p1',
          title: 'Project',
          createdAt: 1,
          updatedAt: 2,
          activeBook: { entries: [] },
          headCommitId: null,
        }),
      ).toBe(false);
      // Commit timestamp wrong-typed (rendered by the history list).
      expect(
        isProjectWorkspace({
          id: 'p1',
          title: 'Project',
          createdAt: 1,
          updatedAt: 2,
          activeBook: { entries: [] },
          headCommitId: null,
          commits: [
            { id: 'c1', parentId: null, timestamp: 'x', message: 'm', snapshot: { entries: [] } },
          ],
        }),
      ).toBe(false);
      // activeBook entry without keys (the entryTitle crash).
      expect(
        isProjectWorkspace({
          id: 'p1',
          title: 'Project',
          createdAt: 1,
          updatedAt: 2,
          activeBook: { entries: [{ content: 'x' }] },
          headCommitId: null,
          commits: [],
        }),
      ).toBe(false);
    });

    it('isSillyTavernWorldInfo requires object entries', () => {
      expect(isSillyTavernWorldInfo({ entries: { '0': { uid: 0 } } })).toBe(true);
      expect(isSillyTavernWorldInfo({ entries: [{ uid: 0 }] })).toBe(true);
      expect(isSillyTavernWorldInfo({ entries: { '0': 'nope' } })).toBe(false);
      expect(isSillyTavernWorldInfo({ entries: [null] })).toBe(false);
      expect(isSillyTavernWorldInfo({})).toBe(false);
    });

    it('normalizeImportedBook fills defaults without dropping keys', () => {
      const book = {
        entries: [{ keys: ['a'], content: 'x', vendor_color: '#0f0' }],
      } as unknown as CharacterBook;
      const normalized = normalizeImportedBook(book);
      assert(normalized.entries[0]);
      expect(normalized.extensions).toEqual({});
      expect(normalized.entries[0].enabled).toBe(true);
      expect(normalized.entries[0].insertion_order).toBe(100);
      expect(normalized.entries[0].extensions).toEqual({});
      // Unknown vendor keys ride along untouched.
      expect(
        (normalized.entries[0] as unknown as Record<string, unknown>)['vendor_color'],
      ).toBe('#0f0');
    });
  });

  describe('workspace lintPrefs (plan 03 §3.6.5)', () => {
    const WELL_SHAPED = {
      ignoredSignatures: ['duplicate-key|1,2|rose', 'invalid-regex|7|/bad[/i'],
      mutedRules: ['never-activatable', 'self-trigger'],
    };

    it('isProjectWorkspace accepts a workspace carrying well-shaped lintPrefs', () => {
      expect(
        isProjectWorkspace({
          id: 'p1',
          title: 'Project',
          createdAt: 1,
          updatedAt: 2,
          activeBook: { entries: [] },
          headCommitId: null,
          commits: [],
          lintPrefs: WELL_SHAPED,
        }),
      ).toBe(true);
    });

    it('isProjectWorkspace still accepts malformed lintPrefs — sanitize, never reject', () => {
      // A hand-edited archive must keep loading; the malformed field is
      // sanitized on import instead of failing the guard.
      expect(
        isProjectWorkspace({
          id: 'p1',
          title: 'Project',
          createdAt: 1,
          updatedAt: 2,
          activeBook: { entries: [] },
          headCommitId: null,
          commits: [],
          lintPrefs: 'garbage',
        }),
      ).toBe(true);
    });

    describe('isLintRuleId', () => {
      it('accepts every rule id and rejects everything else', () => {
        for (const id of [
          'invalid-regex',
          'duplicate-key',
          'secondary-keys-ignored',
          'selective-without-secondary',
          'never-activatable',
          'recursion-cycle',
          'self-trigger',
          'malformed-wrapper',
        ]) {
          expect(isLintRuleId(id)).toBe(true);
        }
        expect(isLintRuleId('bogus-rule')).toBe(false);
        expect(isLintRuleId('toString')).toBe(false); // prototype member, not a rule
        expect(isLintRuleId(42)).toBe(false);
        expect(isLintRuleId(null)).toBe(false);
      });
    });

    describe('sanitizeLintPrefs', () => {
      it('returns undefined for a missing or non-object value', () => {
        expect(sanitizeLintPrefs(undefined)).toBeUndefined();
        expect(sanitizeLintPrefs(null)).toBeUndefined();
        expect(sanitizeLintPrefs('nope')).toBeUndefined();
        expect(sanitizeLintPrefs(5)).toBeUndefined();
        expect(sanitizeLintPrefs(['x'])).toBeUndefined();
      });

      it('keeps well-shaped values verbatim (order and duplicates preserved)', () => {
        const value = {
          ignoredSignatures: ['sig-b', 'sig-a', 'sig-b'],
          mutedRules: ['self-trigger', 'never-activatable'],
        };
        expect(sanitizeLintPrefs(value)).toEqual(value);
      });

      it('drops empty-string and non-string signature entries, keeping order', () => {
        expect(
          sanitizeLintPrefs({
            ignoredSignatures: ['sig-a', '', '   ', 42, null, 'sig-b'],
            mutedRules: [],
          }),
        ).toEqual({ ignoredSignatures: ['sig-a', 'sig-b'], mutedRules: [] });
      });

      it('drops unknown or non-string muted rule ids, keeping valid ones in order', () => {
        expect(
          sanitizeLintPrefs({
            ignoredSignatures: [],
            mutedRules: ['never-activatable', 'bogus-rule', 7, 'recursion-cycle'],
          }),
        ).toEqual({ ignoredSignatures: [], mutedRules: ['never-activatable', 'recursion-cycle'] });
      });

      it('fills missing or wrong-typed keys with empty arrays', () => {
        expect(sanitizeLintPrefs({})).toEqual({ ignoredSignatures: [], mutedRules: [] });
        expect(
          sanitizeLintPrefs({ ignoredSignatures: 'nope', mutedRules: 'also nope' }),
        ).toEqual({ ignoredSignatures: [], mutedRules: [] });
        // A partial shape keeps the part that survived.
        expect(sanitizeLintPrefs({ mutedRules: ['duplicate-key'] })).toEqual({
          ignoredSignatures: [],
          mutedRules: ['duplicate-key'],
        });
      });
    });
  });

  describe('helpers', () => {
    it('entryTitle prefers comment, then keys, then id', () => {
      expect(entryTitle({ ...createEmptyEntry(4), comment: 'Grail' })).toBe('Grail');
      expect(entryTitle({ ...createEmptyEntry(4), comment: '', keys: ['a', 'b'] })).toBe('a, b');
      expect(entryTitle(createEmptyEntry(4))).toBe('Entry 4');
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

  describe('entry tags (lorestitch_tags extension)', () => {
    it('reads, trims and de-duplicates tags from the extension bag', () => {
      const entry = createEmptyEntry(0);
      expect(entryTags(entry)).toEqual([]);
      entry.extensions = {
        ...entry.extensions,
        lorestitch_tags: ['Fate', ' Servant ', 'Fate', 42, null],
      };
      expect(entryTags(entry)).toEqual(['Fate', 'Servant']);
    });

    it('produces an extension patch that preserves sibling keys', () => {
      const entry = createEmptyEntry(0);
      entry.extensions = { ...entry.extensions, vendor_color: '#f0f' };
      const patch = withEntryTags(entry, ['Fate']);
      expect(patch.extensions?.['lorestitch_tags']).toEqual(['Fate']);
      expect(patch.extensions?.['vendor_color']).toBe('#f0f');
    });
  });

  describe('extractSubBook (modular splitting)', () => {
    it('copies only the selected entries with fresh display indexes', () => {
      const book = createEmptyBook('Fuyuki');
      book.entries = [createEmptyEntry(0), createEmptyEntry(1), createEmptyEntry(2)];
      book.entries.forEach((entry, index) => {
        entry.extensions = { ...entry.extensions, display_index: index, vendor_color: '#abc' };
      });

      const sub = extractSubBook(book, [0, 2], 'Servants');
      expect(sub.name).toBe('Servants');
      expect(sub.entries.map((e) => e.id)).toEqual([0, 2]);
      expect(sub.entries.map((e) => e.extensions?.['display_index'])).toEqual([0, 1]);
      // Entry-level vendor keys ride along untouched.
      expect(sub.entries[0]?.extensions?.['vendor_color']).toBe('#abc');
    });

    it('carries book-level settings but starts from a clean extension root', () => {
      const book = createEmptyBook('Fuyuki');
      book.scan_depth = 4;
      book.token_budget = 2048;
      book.recursive_scanning = true;
      book.extensions = { stlo: { vendor: true } };

      const sub = extractSubBook(book, [0], 'Split');
      expect(sub.scan_depth).toBe(4);
      expect(sub.token_budget).toBe(2048);
      expect(sub.recursive_scanning).toBe(true);
      expect(sub.extensions).toEqual({});
    });

    it('deep-clones entries so mutating the split never touches the source', () => {
      const book = createEmptyBook('Fuyuki');
      book.entries = [createEmptyEntry(0)];
      const sub = extractSubBook(book, [0], 'Split');
      const splitEntry = sub.entries[0];
      assert(splitEntry);
      splitEntry.content = 'mutated';
      expect(book.entries[0]?.content).not.toBe('mutated');
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
      assert(book.entries[0]);
      expect(entryTriggerState(book.entries[0])).toBe('vectorized');
      const native = characterBookToStNative(book).entries['3'];
      assert(native);
      expect(native.vectorized).toBe(true);
      expect(native.constant).toBe(false);
    });
  });
});
