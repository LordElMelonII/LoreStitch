import { TestBed } from '@angular/core/testing';
import { ImportExportService } from './import-export.service';
import { CharacterBook, characterBookToStNative } from '../models/lorebook.model';
// Real SillyTavern world-info exports used as import fixtures.
import fuyukiCard from '../../../../example_card/Fate Stay Night - Fuyuki Lorebook(1).json';
import exampleCard from '../../../../example_card/Example test lorebook.json';

/**
 * Import/export round-trip tests against a real SillyTavern world-info export
 * (the bundled Fate/Stay Night Fuyuki lorebook).
 */
describe('ImportExportService', () => {
  let service: ImportExportService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ImportExportService);
  });

  it('detects and parses the Fuyuki card as native SillyTavern world info', () => {
    const parsed = service.parseImport(fuyukiCard, 'Fuyuki');

    assert(parsed);
    expect(parsed.format).toBe('sillytavern_native');
    const entryCount = Object.keys((fuyukiCard as { entries: object }).entries).length;
    expect(parsed.book.entries).toHaveLength(entryCount);
    expect(parsed.suggestedTitle).toBe('Fuyuki');
  });

  it('maps native fields onto the CharacterBook model without loss', () => {
    const parsed = service.parseImport(fuyukiCard, 'Fuyuki');
    assert(parsed);
    const book = parsed.book;
    const first = book.entries.find((e) => e.keys.includes('apartment'));

    assert(first);
    expect(first.content).toContain('{{user}}');
    expect(first.enabled).toBe(true);
    // `constant: true` imports as a constant (empty trigger keys).
    expect(first.constant).toBe(true);
  });

  it('round-trips the card back to native format with stable entry count', () => {
    const parsed = service.parseImport(fuyukiCard, 'Fuyuki');
    assert(parsed);
    const book = parsed.book;
    const native = characterBookToStNative(book);

    expect(Object.keys(native.entries)).toHaveLength(book.entries.length);
    // Re-importing the export must yield the same book size.
    const reparsed = service.parseImport(native, 'Fuyuki');
    assert(reparsed);
    expect(reparsed.format).toBe('sillytavern_native');
    expect(reparsed.book.entries).toHaveLength(book.entries.length);
  });

  it('preserves secondary keys across a native round-trip', () => {
    const parsed = service.parseImport(fuyukiCard, 'Fuyuki');
    assert(parsed);
    const book = parsed.book;
    const withSecondary = book.entries.find((e) => (e.secondary_keys ?? []).length > 0);
    if (!withSecondary) {
      throw new Error('fixture card has no secondary keys — pick a richer fixture');
    }
    const native = characterBookToStNative(book);
    const reparsedParsed = service.parseImport(native, 'Fuyuki');
    assert(reparsedParsed);
    const reparsed = reparsedParsed.book;
    const again = reparsed.entries.find((e) => e.id === withSecondary.id);

    assert(again);
    expect(again.secondary_keys).toEqual(withSecondary.secondary_keys);
  });

  it('rejects payloads that match no known format', () => {
    expect(service.parseImport(null)).toBeNull();
    expect(service.parseImport('just a string')).toBeNull();
    expect(service.parseImport({ unrelated: true })).toBeNull();
    expect(service.parseImport([])).toBeNull();
  });

  it('accepts both bundled real-world fixtures', () => {
    const fuyuki = service.parseImport(fuyukiCard, 'Fuyuki');
    assert(fuyuki);
    expect(fuyuki.format).toBe('sillytavern_native');

    const example = service.parseImport(exampleCard, 'Example');
    assert(example);
    expect(example.format).toBe('sillytavern_native');
    expect(example.book.entries.length).toBeGreaterThan(0);
  });

  it('rejects native files whose entries are not objects', () => {
    expect(service.parseImport({ entries: { '0': 'garbage' } })).toBeNull();
    expect(service.parseImport({ entries: [null] })).toBeNull();
  });

  it('rejects bare books whose entries miss critical fields', () => {
    // The crash repro: entryTitle reads entry.keys.length.
    expect(service.parseImport({ entries: [{ content: 'x' }] })).toBeNull();
    expect(service.parseImport({ entries: [{ keys: 'a', content: 'x' }] })).toBeNull();
    expect(service.parseImport({ entries: [{ keys: [], content: 5 }] })).toBeNull();
  });

  it('rejects a .stproj archive with an empty workspace', () => {
    expect(
      service.parseImport({ format: 'lorestitch-project', version: 1, workspace: {} }),
    ).toBeNull();
  });

  it('rejects .stproj archives from a future version', () => {
    const workspace = {
      id: 'p1',
      title: 'From the future',
      createdAt: 1,
      updatedAt: 1,
      activeBook: { entries: [] },
      headCommitId: null,
      commits: [],
    };
    expect(
      service.parseImport({ format: 'lorestitch-project', version: 2, workspace }),
    ).toBeNull();
  });

  it('accepts a .stproj archive with a missing version field', () => {
    const archive = {
      format: 'lorestitch-project',
      workspace: {
        id: 'p1',
        title: 'Legacy',
        createdAt: 1,
        updatedAt: 1,
        activeBook: { entries: [] },
        headCommitId: null,
        commits: [],
      },
    };
    const parsed = service.parseImport(archive);
    assert(parsed);
    assert(parsed.workspace);
    expect(parsed.workspace.title).toBe('Legacy');
  });

  it('rejects a .stproj archive with a malformed commit history', () => {
    const archive = {
      format: 'lorestitch-project',
      version: 1,
      workspace: {
        id: 'p1',
        title: 'Broken history',
        createdAt: 1,
        updatedAt: 1,
        activeBook: { entries: [] },
        headCommitId: 'c1',
        commits: [{ id: 'c1', message: 'no timestamp or snapshot' }],
      },
    };
    expect(service.parseImport(archive)).toBeNull();
  });

  it('accepts a bare CharacterBook and normalizes positions', () => {
    const book: CharacterBook = {
      name: 'Bare',
      extensions: {},
      entries: [
        {
          id: 0,
          keys: ['a'],
          secondary_keys: [],
          content: 'x',
          enabled: true,
          insertion_order: 0,
          extensions: { position: 4 }, // ST "at depth"
        },
      ],
    };

    const parsed = service.parseImport(structuredClone(book), 'Bare');
    assert(parsed);
    expect(parsed.format).toBe('character_book');
    // normalizeBookPositions lifts extensions.position into the spec field.
    assert(parsed.book.entries[0]);
    expect(parsed.book.entries[0].position).toBe('at_depth');
  });

  it('parses a .stproj archive and unwraps its workspace', () => {
    const archive = {
      format: 'lorestitch-project',
      version: 1,
      workspace: {
        id: 'p1',
        title: 'Archived',
        createdAt: 1,
        updatedAt: 1,
        targetType: 'standalone_lorebook',
        activeBook: { name: 'Archived', entries: [] },
        headCommitId: null,
        commits: [],
      },
    };

    const parsed = service.parseImport(archive);
    assert(parsed);
    expect(parsed.format).toBe('stproj');
    assert(parsed.workspace);
    expect(parsed.workspace.title).toBe('Archived');
    expect(parsed.book.name).toBe('Archived');
  });

  it('handles empty native lorebooks gracefully', () => {
    const parsed = service.parseImport({ entries: {} }, 'Empty');
    assert(parsed);
    expect(parsed.book.entries).toEqual([]);
    expect(parsed.suggestedTitle).toBe('Empty');
  });
});
