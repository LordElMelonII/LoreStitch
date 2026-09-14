import { TestBed } from '@angular/core/testing';
import { ImportExportService } from './import-export.service';
import { CharacterBook, characterBookToStNative } from '../models/lorebook.model';
// Real SillyTavern world-info export used as import fixture.
import fuyukiCard from '../../../../example_card/Fate Stay Night - Fuyuki Lorebook(1).json';

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

    expect(parsed).not.toBeNull();
    expect(parsed!.format).toBe('sillytavern_native');
    const entryCount = Object.keys((fuyukiCard as { entries: object }).entries).length;
    expect(parsed!.book.entries).toHaveLength(entryCount);
    expect(parsed!.suggestedTitle).toBe('Fuyuki');
  });

  it('maps native fields onto the CharacterBook model without loss', () => {
    const book = service.parseImport(fuyukiCard, 'Fuyuki')!.book;
    const first = book.entries.find((e) => e.keys.includes('apartment'));

    expect(first).toBeDefined();
    expect(first!.content).toContain('{{user}}');
    expect(first!.enabled).toBe(true);
    // `constant: true` imports as a constant (empty trigger keys).
    expect(first!.constant).toBe(true);
  });

  it('round-trips the card back to native format with stable entry count', () => {
    const book = service.parseImport(fuyukiCard, 'Fuyuki')!.book;
    const native = characterBookToStNative(book);

    expect(Object.keys(native.entries)).toHaveLength(book.entries.length);
    // Re-importing the export must yield the same book size.
    const reparsed = service.parseImport(native, 'Fuyuki');
    expect(reparsed!.format).toBe('sillytavern_native');
    expect(reparsed!.book.entries).toHaveLength(book.entries.length);
  });

  it('preserves secondary keys across a native round-trip', () => {
    const book = service.parseImport(fuyukiCard, 'Fuyuki')!.book;
    const withSecondary = book.entries.find((e) => (e.secondary_keys ?? []).length > 0);
    if (!withSecondary) {
      throw new Error('fixture card has no secondary keys — pick a richer fixture');
    }
    const native = characterBookToStNative(book);
    const reparsed = service.parseImport(native, 'Fuyuki')!.book;
    const again = reparsed.entries.find((e) => e.id === withSecondary.id);

    expect(again!.secondary_keys).toEqual(withSecondary.secondary_keys);
  });

  it('rejects payloads that match no known format', () => {
    expect(service.parseImport(null)).toBeNull();
    expect(service.parseImport('just a string')).toBeNull();
    expect(service.parseImport({ unrelated: true })).toBeNull();
    expect(service.parseImport([])).toBeNull();
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
    expect(parsed!.format).toBe('character_book');
    // normalizeBookPositions lifts extensions.position into the spec field.
    expect(parsed!.book.entries[0].position).toBe('at_depth');
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

    const parsed = service.parseImport(archive)!;
    expect(parsed.format).toBe('stproj');
    expect(parsed.workspace!.title).toBe('Archived');
    expect(parsed.book.name).toBe('Archived');
  });

  it('handles empty native lorebooks gracefully', () => {
    const parsed = service.parseImport({ entries: {} }, 'Empty');
    expect(parsed!.book.entries).toEqual([]);
    expect(parsed!.suggestedTitle).toBe('Empty');
  });
});
