import exampleLorebook from '../../../../example_card/Example test lorebook.json';
import fateLorebook from '../../../../example_card/Fate Stay Night - Fuyuki Lorebook(1).json';
import {
  SillyTavernEntry,
  SillyTavernWorldInfo,
  characterBookToStNative,
  createEmptyEntry,
  detectLoreFileFormat,
  stNativeToCharacterBook,
  toSpecCompliantBook,
} from './lorebook.model';

type NativeEntryBag = Record<string, unknown>;

/**
 * Names the original attributes an exported entry lost or changed. The export
 * may ADD keys (normalized defaults for fields the source omitted), so only
 * the original -> export direction is compared — that is the preservation
 * guarantee the ROADMAP asks for.
 */
function lostAttributes(source: NativeEntryBag, exported: NativeEntryBag): string[] {
  const lost: string[] = [];
  for (const [key, expected] of Object.entries(source)) {
    if (JSON.stringify(exported[key]) !== JSON.stringify(expected)) {
      lost.push(`${key}: ${JSON.stringify(expected)} -> ${JSON.stringify(exported[key])}`);
    }
  }
  return lost;
}

function exportEntries(
  exported: SillyTavernWorldInfo,
): Record<string, SillyTavernEntry> {
  return exported.entries;
}

describe('Fate/Stay Night Fuyuki lorebook round trip', () => {
  const original = fateLorebook as unknown as SillyTavernWorldInfo;
  const book = stNativeToCharacterBook(original, 'Fuyuki');

  it('imports every entry', () => {
    expect(book.entries).toHaveLength(Object.keys(original['entries'] as NativeEntryBag).length);
  });

  it('preserves the stlo book metadata through import and export', () => {
    expect(book.extensions['stlo']).toEqual(original['stlo']);
    const exported = characterBookToStNative(book);
    expect(exported['stlo']).toEqual(original['stlo']);
  });

  it('exports every original attribute of every entry unchanged', () => {
    const exported = exportEntries(characterBookToStNative(book));
    const losses = Object.entries(original['entries'] as NativeEntryBag).flatMap(([uid, entry]) =>
      lostAttributes(entry as NativeEntryBag, exported[uid] ?? {}).map(
        (diff) => `uid ${uid} ${diff}`,
      ),
    );
    expect(losses).toEqual([]);
  });

  it('keeps edits and unedited entries intact in the same export', () => {
    const target = book.entries[0];
    assert(target);
    const targetId = target.id;
    assert(targetId !== undefined);
    workspace_edit(book, targetId, {
      content: '<edited>Modified content</edited>',
      'extensions.group': 'sword, students',
    });

    const exported = exportEntries(characterBookToStNative(book));
    expect(exported[String(targetId)]?.content).toBe('<edited>Modified content</edited>');
    expect(exported[String(targetId)]?.group).toBe('sword, students');

    // Every other entry is untouched by the edit.
    const losses = Object.entries(original['entries'] as NativeEntryBag)
      .filter(([uid]) => uid !== String(targetId))
      .flatMap(([uid, entry]) =>
        lostAttributes(entry as NativeEntryBag, exported[uid] ?? {}).map(
          (diff) => `uid ${uid} ${diff}`,
        ),
      );
    expect(losses).toEqual([]);
  });

  it('re-imports its own export identically (stable round trip)', () => {
    const exported = characterBookToStNative(book);
    expect(detectLoreFileFormat(exported)).toBe('sillytavern_native');

    const reimported = characterBookToStNative(stNativeToCharacterBook(exported, 'Fuyuki'));
    expect(reimported).toEqual(exported);
  });
});

describe('Example test lorebook round trip', () => {
  // This book has no stlo block; detection must rely on the uid-keyed entries.
  const original = exampleLorebook as unknown as SillyTavernWorldInfo;
  const book = stNativeToCharacterBook(original, 'Example');

  it('detects the native format from the uid-keyed entries alone', () => {
    expect(detectLoreFileFormat(original)).toBe('sillytavern_native');
  });

  it('exports every original attribute unchanged, including null tri-states', () => {
    const exported = exportEntries(characterBookToStNative(book));
    const losses = Object.entries(original['entries'] as NativeEntryBag).flatMap(([uid, entry]) =>
      lostAttributes(entry as NativeEntryBag, exported[uid] ?? {}).map(
        (diff) => `uid ${uid} ${diff}`,
      ),
    );
    expect(losses).toEqual([]);
  });
});

describe('addMemo fidelity round trip', () => {
  // world-info.js stores `addMemo` independently of the comment text; the
  // export must replay the captured flag, not re-derive it from the comment.
  function roundTripAddMemo(overrides: Record<string, unknown>): unknown {
    const book = stNativeToCharacterBook({ entries: { 3: { ...baseEntry, ...overrides } } });
    return characterBookToStNative(book).entries['3']?.addMemo;
  }

  const baseEntry = {
    uid: 3,
    key: ['memos'],
    content: 'Content with or without a memo.',
    comment: 'A non-empty comment',
  };

  it('addMemo:false with a non-empty comment stays false', () => {
    expect(roundTripAddMemo({ addMemo: false })).toBe(false);
  });

  it('addMemo:true with an empty comment stays true', () => {
    expect(roundTripAddMemo({ addMemo: true, comment: '' })).toBe(true);
  });

  it('a missing addMemo falls back to comment presence', () => {
    expect(roundTripAddMemo({ addMemo: undefined })).toBe(true);
    expect(roundTripAddMemo({ addMemo: undefined, comment: '' })).toBe(false);
  });
});

describe('out-of-enum numeric position round trip', () => {
  // An unmapped `world_info_position` (plugin values like 99) must survive
  // import -> export untouched instead of collapsing to 0 (before_char).
  const source: SillyTavernWorldInfo = {
    entries: {
      '5': {
        uid: 5,
        key: ['portal'],
        content: 'A shimmering portal.',
        comment: 'Portal',
        position: 99,
        order: 100,
      } as SillyTavernEntry,
    },
  };

  it('keeps 99 across import, native export, and re-import', () => {
    const book = stNativeToCharacterBook(source, 'Portals');
    assert(book.entries[0]);
    expect(book.entries[0].position).toBe('before_char'); // spec fallback only
    expect(book.entries[0].extensions['position']).toBe(99);

    const native = characterBookToStNative(book);
    expect(native.entries['5']?.position).toBe(99);

    const reimported = stNativeToCharacterBook(native, 'Portals');
    assert(reimported.entries[0]);
    expect(reimported.entries[0].extensions['position']).toBe(99);
    expect(characterBookToStNative(reimported).entries['5']?.position).toBe(99);
  });
});

describe('unmanaged extension data preservation', () => {
  // ROADMAP example: stlo and randomExtension live outside `entries` and are
  // not managed by LoreStitch, but must survive the round trip verbatim.
  const roadMapExample: SillyTavernWorldInfo = {
    stlo: {
      priority: 1,
      budget: 0,
      budgetMode: 'default',
      orderAdjustment: 0,
      orderAdjustmentGroupOnly: false,
      characterOverrides: {},
      onlyWhenSpeaking: false,
      randomTrim: false,
    },
    randomExtension: { blabla: 'blabla' },
    entries: {
      '0': {
        uid: 0,
        key: ['apartment', 'house', 'home', 'Octagon'],
        keysecondary: [],
        comment: 'User apartment',
        content: '<user_apartment>A one-room apartment.</user_apartment>',
        constant: true,
        vectorized: false,
        selective: true,
        selectiveLogic: 0,
        addMemo: true,
        order: 100,
        position: 0,
        disable: false,
        ignoreBudget: false,
        excludeRecursion: false,
        preventRecursion: true,
        probability: 100,
        useProbability: true,
        depth: 4,
        group: '',
        groupOverride: false,
        groupWeight: 100,
        sticky: 10,
        displayIndex: 62,
      },
    },
  };

  it('preserves stlo and randomExtension outside entries', () => {
    const book = stNativeToCharacterBook(roadMapExample, 'Roadmap');
    expect(book.extensions['stlo']).toEqual(roadMapExample['stlo']);
    expect(book.extensions['randomExtension']).toEqual({ blabla: 'blabla' });

    const exported = characterBookToStNative(book);
    expect(exported['stlo']).toEqual(roadMapExample['stlo']);
    expect(exported['randomExtension']).toEqual({ blabla: 'blabla' });
  });

  it('parks unknown entry attributes (extension-derived) into extensions and restores them', () => {
    const source: SillyTavernWorldInfo = {
      entries: {
        '7': {
          uid: 7,
          key: ['colorful'],
          content: 'An entry with extension attributes.',
          color: '#ff00ff',
          extensions: {
            randomExtension: { surprise: true },
            // Normalized mirrors are consumed, never duplicated as unknowns.
            position: 1,
            prevent_recursion: true,
          },
        } as SillyTavernEntry,
      },
    };

    const book = stNativeToCharacterBook(source, 'Colored');
    assert(book.entries[0]);
    expect(book.entries[0].extensions['color']).toBe('#ff00ff');
    // Unknown keys inside the native mirror ride along inside the parked copy.
    const parked = book.entries[0].extensions['native_extensions'] as NativeEntryBag;
    expect(parked['randomExtension']).toEqual({ surprise: true });
    // Known normalized keys do not leak into the unknown bag.
    expect(book.entries[0].extensions['prevent_recursion']).toBe(true);
    expect(book.entries[0].position).toBe('after_char');

    const exported = exportEntries(characterBookToStNative(book));
    expect(exported['7']?.['color']).toBe('#ff00ff');
    // The native entry's own `extensions` mirror comes back verbatim (with
    // the unknown keys it carried), and its known mirrors stay consumed.
    expect(exported['7']?.['extensions']).toEqual({
      randomExtension: { surprise: true },
      position: 1,
      prevent_recursion: true,
    });
    expect(exported['7']?.['preventRecursion']).toBe(true);
    expect(exported['7']?.position).toBe(1);
  });

  it('exports freshly created entries as complete native entries', () => {
    const book = {
      name: 'Fresh',
      description: '',
      scan_depth: undefined,
      token_budget: undefined,
      recursive_scanning: false,
      extensions: {},
      entries: [createEmptyEntry(0, 0)],
    };
    const exported = exportEntries(characterBookToStNative(book));
    const native = exported['0'] as NativeEntryBag;
    expect(native['group']).toBe('');
    expect(native['groupOverride']).toBe(false);
    expect(native['groupWeight']).toBe(100);
    expect(native['useGroupScoring']).toBeNull();
    expect(native['ignoreBudget']).toBe(false);
    expect(native['role']).toBe(0);
    expect(Object.keys(native)).not.toContain('color');
  });

  it('keeps stlo on spec-compliant V2 exports too', () => {
    const book = stNativeToCharacterBook(roadMapExample, 'Roadmap');
    const specBook = toSpecCompliantBook(book);
    expect(specBook.extensions['stlo']).toEqual(roadMapExample['stlo']);
  });
});

/** Applies an edit the way the editor's workspace patch would. */
function workspace_edit(
  book: ReturnType<typeof stNativeToCharacterBook>,
  uid: number,
  edits: Record<string, unknown>,
): void {
  const entry = book.entries.find((e) => e.id === uid);
  if (!entry) {
    throw new Error(`entry ${uid} not found`);
  }
  const { 'extensions.group': group, ...rest } = edits;
  Object.assign(entry, rest);
  if (group !== undefined) {
    entry.extensions = { ...entry.extensions, group };
  }
}
