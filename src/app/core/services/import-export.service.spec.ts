import { TestBed } from '@angular/core/testing';
import { ImportExportService } from './import-export.service';
import {
  CharacterBook,
  CharacterBookEntry,
  LORESTITCH_ARCHIVE_VERSION,
  ProjectWorkspace,
  ST_POSITION,
  characterBookToStNative,
  createEmptyBook,
} from '../models/lorebook.model';
import { estimateTokens } from './token-estimator';
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

  it('rejects files carrying the SillyTavern marker but corrupt entry values', () => {
    // `stlo` forces native detection, so the payload reaches the native guard —
    // which must still reject non-object entry values instead of crashing.
    expect(service.parseImport({ stlo: {}, entries: { a: 1 } })).toBeNull();
  });

  it('rejects a .stproj archive whose version is not the archive number', () => {
    const workspace = {
      id: 'p1',
      title: 'String version',
      createdAt: 1,
      updatedAt: 1,
      activeBook: { entries: [] },
      headCommitId: null,
      commits: [],
    };
    // `version: "1"` is not `1`: only exact archive versions may import.
    expect(
      service.parseImport({ format: 'lorestitch-project', version: '1', workspace }),
    ).toBeNull();
  });

  it('rejects a .stproj workspace whose commit history is missing entirely', () => {
    const workspace = {
      id: 'p1',
      title: 'No commits key',
      createdAt: 1,
      updatedAt: 1,
      activeBook: { entries: [] },
      headCommitId: null,
    };
    expect(
      service.parseImport({ format: 'lorestitch-project', version: 1, workspace }),
    ).toBeNull();
  });

  it('falls back to the provided title for untitled .stproj workspaces', () => {
    const workspace = {
      id: 'p1',
      title: '',
      createdAt: 1,
      updatedAt: 1,
      activeBook: { name: 'Untitled archive', entries: [] },
      headCommitId: null,
      commits: [],
    };
    const parsed = service.parseImport(
      { format: 'lorestitch-project', version: 1, workspace },
      'Dropped file name',
    );
    assert(parsed);
    expect(parsed.format).toBe('stproj');
    expect(parsed.suggestedTitle).toBe('Dropped file name');
  });

  it('reads a File and parses its JSON payload', async () => {
    const file = new File(['{"entries":{}}'], 'empty-card.json', { type: 'application/json' });
    const text = await service.readFileText(file);
    expect(text).toBe('{"entries":{}}');

    const parsed = service.parseImport(JSON.parse(text), 'From file');
    assert(parsed);
    expect(parsed.format).toBe('sillytavern_native');
    expect(parsed.suggestedTitle).toBe('From file');
  });
});

/**
 * jsdom has no `URL.createObjectURL` and would report a not-implemented
 * navigation for a clicked download anchor. Both are routed through stubs that
 * hand back the produced `Blob` and the anchor's `download` name, so every
 * export can be asserted byte-for-byte.
 */
interface DownloadCapture {
  readonly blob: Blob;
  readonly fileName: string;
  readonly url: string;
}

function captureDownloads(): DownloadCapture[] {
  const downloads: DownloadCapture[] = [];
  const blobUrls = new Map<string, Blob>();
  let counter = 0;
  URL.createObjectURL = ((blob: Blob) => {
    const url = `blob:mock-${counter}`;
    counter += 1;
    blobUrls.set(url, blob);
    return url;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn(() => undefined) as typeof URL.revokeObjectURL;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(
    this: HTMLAnchorElement,
  ) {
    const blob = blobUrls.get(this.href);
    assert(blob);
    downloads.push({ blob, fileName: this.download, url: this.href });
  });
  return downloads;
}

function makeEntry(id: number, overrides: Partial<CharacterBookEntry> = {}): CharacterBookEntry {
  return {
    id,
    keys: [`key-${id}`],
    secondary_keys: [],
    content: `content ${id}`,
    comment: `Entry ${id}`,
    enabled: true,
    insertion_order: id,
    extensions: {},
    ...overrides,
  };
}

function makeProject(title: string): ProjectWorkspace {
  const now = Date.now();
  return {
    id: 'project-1',
    title,
    createdAt: now,
    updatedAt: now,
    targetType: 'standalone_lorebook',
    activeBook: createEmptyBook(title),
    headCommitId: null,
    commits: [],
  };
}

describe('ImportExportService exports', () => {
  let service: ImportExportService;
  let downloads: DownloadCapture[];

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ImportExportService);
    downloads = captureDownloads();
  });

  afterEach(async () => {
    // Drain the macrotask queue while the stubs are still live: `download`
    // revokes its object URL from a timer that would otherwise fire after the
    // globals were restored.
    await new Promise((resolve) => setTimeout(resolve, 0));
    // jsdom never owned these functions; assigning them back (undefined)
    // restores the pre-test globals, the mocks on URL & HTMLElement go too.
    URL.createObjectURL = undefined as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = undefined as unknown as typeof URL.revokeObjectURL;
    vi.restoreAllMocks();
  });

  /** Drains the macrotask queue so the post-download revoke timer ran. */
  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  async function payloadOf(capture: DownloadCapture): Promise<Record<string, unknown>> {
    return JSON.parse(await capture.blob.text()) as Record<string, unknown>;
  }

  it('downloads the V2-spec-compliant book with the numeric position mirror preserved', async () => {
    const book: CharacterBook = {
      name: 'Fuyuki',
      extensions: { stlo: { vendor: true } },
      entries: [
        makeEntry(0, {
          extensions: { position: ST_POSITION.atDepth, custom_vendor: { keep: true } },
        }),
        // Only the spec string is set: it must still collapse + gain a mirror.
        makeEntry(1, { extensions: {}, position: 'before_an' }),
        makeEntry(2, { extensions: {} }),
      ],
    };

    service.exportCharacterBook(book, 'Fate Fuyuki');
    expect(downloads).toHaveLength(1);
    const capture = downloads[0];
    assert(capture);
    expect(capture.fileName).toBe('Fate-Fuyuki-lorebook.json');
    expect(capture.blob.type).toBe('application/json');

    const exported = await payloadOf(capture);
    const entries = exported['entries'] as Record<string, unknown>[];
    assert(entries[0]);
    // Spec field collapses to the two schema-legal values…
    expect(entries[0]['position']).toBe('after_char');
    // …while the true SillyTavern position survives losslessly in extensions.
    expect(entries[0]['extensions']).toEqual({
      position: ST_POSITION.atDepth,
      custom_vendor: { keep: true },
    });
    assert(entries[1]);
    expect(entries[1]['position']).toBe('after_char');
    expect((entries[1]['extensions'] as Record<string, unknown>)['position']).toBe(
      ST_POSITION.ANTop,
    );
    assert(entries[2]);
    expect(entries[2]['position']).toBe('before_char');
    expect((entries[2]['extensions'] as Record<string, unknown>)['position']).toBe(
      ST_POSITION.before,
    );
    // Unknown vendor keys survive at both levels (never dropped on export).
    expect(exported['extensions']).toEqual({ stlo: { vendor: true } });
    // Serialized with indentation, not minified.
    expect(await capture.blob.text()).toContain('\n  "');
    await settle();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(capture.url);
  });

  it('downloads native world info keyed by uid with converted entry fields', async () => {
    const book: CharacterBook = {
      name: 'Fuyuki',
      extensions: {},
      entries: [
        makeEntry(3, {
          keys: ['apartment'],
          secondary_keys: ['night'],
          comment: 'Apartment memo',
          enabled: false,
          insertion_order: 10,
          extensions: { position: ST_POSITION.atDepth, depth: 2 },
        }),
        makeEntry(7, { keys: ['church'], comment: '', insertion_order: 5 }),
      ],
    };

    service.exportStNative(book, 'Fuyuki');
    const capture = downloads[0];
    assert(capture);
    expect(capture.fileName).toBe('Fuyuki-world-info.json');
    expect(capture.blob.type).toBe('application/json');

    const native = await payloadOf(capture);
    // Entries are keyed by the entry uid, not by array position.
    const nativeKeys = Object.keys(native['entries'] as Record<string, unknown>);
    expect(nativeKeys).toEqual(['3', '7']);
    const entries = native['entries'] as Record<string, Record<string, unknown>>;
    const disabled = entries['3'];
    assert(disabled);
    expect(disabled['uid']).toBe(3);
    expect(disabled['key']).toEqual(['apartment']);
    expect(disabled['keysecondary']).toEqual(['night']);
    expect(disabled['disable']).toBe(true);
    expect(disabled['order']).toBe(10);
    expect(disabled['position']).toBe(ST_POSITION.atDepth);
    expect(disabled['depth']).toBe(2);
    // Fresh in-app entries derive addMemo from the comment's presence.
    expect(disabled['addMemo']).toBe(true);
    expect(disabled['comment']).toBe('Apartment memo');
    const live = entries['7'];
    assert(live);
    expect(live['disable']).toBe(false);
    expect(live['addMemo']).toBe(false);
    expect(live['order']).toBe(5);
    // No position mirror: the spec default maps back to ST "before".
    expect(live['position']).toBe(ST_POSITION.before);
  });

  it('downloads the project archive envelope and re-imports its own output', async () => {
    const project = makeProject('Fuyuki Campaign');

    service.exportProject(project);
    const capture = downloads[0];
    assert(capture);
    expect(capture.fileName).toBe('Fuyuki-Campaign.stproj');
    expect(capture.blob.type).toBe('application/json');

    const archive = await payloadOf(capture);
    expect(archive['format']).toBe('lorestitch-project');
    expect(archive['version']).toBe(LORESTITCH_ARCHIVE_VERSION);
    const exportedAt = archive['exportedAt'];
    assert(typeof exportedAt === 'string');
    expect(Number.isNaN(Date.parse(exportedAt))).toBe(false);
    expect(archive['workspace']).toEqual(project);

    // The archive is self-contained: importing the export restores the project.
    const parsed = service.parseImport(archive);
    assert(parsed);
    expect(parsed.format).toBe('stproj');
    assert(parsed.workspace);
    expect(parsed.workspace.title).toBe('Fuyuki Campaign');
    expect(parsed.book).toEqual(project.activeBook);
  });

  it('carries lintPrefs through exportProject and re-imports it verbatim', async () => {
    const project: ProjectWorkspace = {
      ...makeProject('Linted Project'),
      lintPrefs: {
        ignoredSignatures: ['duplicate-key|1,2|rose', 'invalid-regex|7|/bad[/i'],
        mutedRules: ['never-activatable', 'self-trigger'],
      },
    };

    service.exportProject(project);
    const capture = downloads[0];
    assert(capture);
    // `exportProject` clones the whole workspace, so the field rides along
    // (plan 03 §3.6.5.2) — no dedicated export code path.
    const archive = await payloadOf(capture);
    const workspace = archive['workspace'] as Record<string, unknown>;
    expect(workspace['lintPrefs']).toEqual(project.lintPrefs);

    // Re-importing the export restores the prefs verbatim (well-shaped values
    // survive `sanitizeLintPrefs` content-unchanged).
    const parsed = service.parseImport(archive);
    assert(parsed);
    assert(parsed.workspace);
    expect(parsed.workspace.lintPrefs).toEqual(project.lintPrefs);
  });

  it('imports an old archive without lintPrefs unchanged', async () => {
    const project = makeProject('Legacy Project');

    service.exportProject(project);
    const capture = downloads[0];
    assert(capture);
    const archive = await payloadOf(capture);
    expect(archive['workspace']).toEqual(project); // no lintPrefs key written

    const parsed = service.parseImport(archive);
    assert(parsed);
    assert(parsed.workspace);
    expect(parsed.workspace.lintPrefs).toBeUndefined();
    expect(Object.hasOwn(parsed.workspace, 'lintPrefs')).toBe(false);
  });

  it('sanitizes malformed lintPrefs parts on import instead of rejecting', async () => {
    const base = makeProject('Hand-edited');
    const archive = {
      format: 'lorestitch-project',
      version: LORESTITCH_ARCHIVE_VERSION,
      exportedAt: new Date().toISOString(),
      workspace: {
        ...base,
        lintPrefs: {
          ignoredSignatures: ['sig-a', '', '   ', 42, null],
          mutedRules: ['never-activatable', 'bogus-rule', 7],
        },
      },
    };

    const parsed = service.parseImport(archive);
    assert(parsed);
    assert(parsed.workspace);
    expect(parsed.workspace.lintPrefs).toEqual({
      ignoredSignatures: ['sig-a'],
      mutedRules: ['never-activatable'],
    });

    // A wholly malformed field is dropped, not kept as a type violation.
    const garbage = {
      format: 'lorestitch-project',
      version: LORESTITCH_ARCHIVE_VERSION,
      workspace: { ...base, lintPrefs: 'garbage' },
    };
    const garbageParsed = service.parseImport(garbage);
    assert(garbageParsed);
    assert(garbageParsed.workspace);
    expect(garbageParsed.workspace.lintPrefs).toBeUndefined();
    expect(Object.hasOwn(garbageParsed.workspace, 'lintPrefs')).toBe(false);
  });

  it('exports byte-identical ST JSON for a book from a prefs-carrying workspace', async () => {
    // The pinned contract (plan 03 §3.6.5.2): preferences are workspace
    // metadata — a book exported from a prefs-carrying workspace must be
    // byte-for-byte the same ST JSON as from one without.
    const book: CharacterBook = {
      name: 'Prefs Book',
      extensions: { stlo: { vendor: true } },
      entries: [
        makeEntry(0, { keys: ['rose'], secondary_keys: ['night'] }),
        makeEntry(1, { keys: ['lily'], content: '<lily>\nlore\n</lily>' }),
      ],
    };
    const withPrefs: ProjectWorkspace = {
      ...makeProject('Prefs Carrier'),
      activeBook: book,
      lintPrefs: { ignoredSignatures: ['duplicate-key|1,2|rose'], mutedRules: ['self-trigger'] },
    };
    const withoutPrefs: ProjectWorkspace = { ...makeProject('Prefs Carrier'), activeBook: book };

    service.exportCharacterBook(withPrefs.activeBook, 'Prefs Carrier');
    service.exportCharacterBook(withoutPrefs.activeBook, 'Prefs Carrier');
    service.exportStNative(withPrefs.activeBook, 'Prefs Carrier');
    service.exportStNative(withoutPrefs.activeBook, 'Prefs Carrier');
    expect(downloads).toHaveLength(4);
    const [bookWith, bookWithout, nativeWith, nativeWithout] = downloads;
    assert(bookWith && bookWithout && nativeWith && nativeWithout);
    expect(await bookWith.blob.text()).toBe(await bookWithout.blob.text());
    expect(await nativeWith.blob.text()).toBe(await nativeWithout.blob.text());
  });

  it('never writes lintPrefs into ProjectCommit snapshots', async () => {
    const project = makeProject('Committed');
    project.commits = [
      {
        id: 'c1',
        parentId: null,
        timestamp: 1,
        message: 'Initial commit',
        snapshot: structuredClone(project.activeBook),
      },
    ];
    project.headCommitId = 'c1';
    project.lintPrefs = { ignoredSignatures: ['never-activatable|1|'], mutedRules: [] };

    service.exportProject(project);
    const capture = downloads[0];
    assert(capture);
    const archive = await payloadOf(capture);
    const workspace = archive['workspace'] as Record<string, unknown>;
    // The prefs live on the workspace…
    expect(workspace['lintPrefs']).toEqual(project.lintPrefs);
    // …but never inside a commit snapshot (rollbacks must not touch them).
    const commits = workspace['commits'] as Record<string, unknown>[];
    const snapshot = commits[0]?.['snapshot'] as Record<string, unknown>;
    expect(snapshot).toEqual(project.activeBook);
    expect(Object.hasOwn(snapshot, 'lintPrefs')).toBe(false);
  });

  it('writes a sorted markdown digest and can exclude disabled entries', async () => {
    const book: CharacterBook = {
      name: 'Digest Book',
      extensions: {},
      entries: [
        makeEntry(0, {
          keys: ['k1', 'k2'],
          comment: 'Disabled one',
          enabled: false,
          insertion_order: 10,
          content: 'Body ten',
        }),
        makeEntry(1, {
          keys: [],
          comment: '',
          constant: true,
          insertion_order: 2,
          content: 'Body two',
        }),
      ],
    };

    service.exportMarkdownDigest(book, 'Other title');
    const capture = downloads[0];
    assert(capture);
    expect(capture.fileName).toBe('Other-title-digest.md');
    expect(capture.blob.type).toBe('text/markdown;charset=utf-8');
    // The header names the book, the file name the export title.
    const expected = [
      '# Digest Book — Proofread Digest',
      '',
      `2 entries · ~${estimateTokens('Body ten\nBody two')} tokens (rough)`,
      '',
      // Sorted by insertion order; a key-less constant entry says so.
      '### [Entry 1] (Order: 2 | Keys: constant)',
      'Body two',
      '---',
      '### [Disabled one] (disabled) (Order: 10 | Keys: k1, k2)',
      'Body ten',
      '---',
    ].join('\n');
    expect(await capture.blob.text()).toBe(expected);

    service.exportMarkdownDigest(book, 'Other title', { includeDisabled: false });
    const filtered = downloads[1];
    assert(filtered);
    const text = await filtered.blob.text();
    expect(text).not.toContain('Disabled one');
    expect(text).not.toContain('Body ten');
    expect(text.match(/^### /gm)).toHaveLength(1);
    // The header statistics describe exactly the listed (enabled) entries.
    expect(text).toContain(`1 entries · ~${estimateTokens('Body two')} tokens (rough)`);
  });

  it('exports a selection as a standalone book with renumbered display indexes', async () => {
    const book: CharacterBook = {
      name: 'Source',
      description: 'source description',
      scan_depth: 5,
      token_budget: 1024,
      recursive_scanning: true,
      extensions: { vendor_root: true },
      entries: [
        makeEntry(0, { extensions: { display_index: 0, position: ST_POSITION.before } }),
        makeEntry(1, { extensions: { display_index: 1, position: ST_POSITION.before } }),
        makeEntry(2, {
          keys: ['target'],
          extensions: { display_index: 2, position: ST_POSITION.before },
        }),
      ],
    };

    service.exportSelectedBook(book, [2, 0], 'Subset', 'character_book');
    const asBook = downloads[0];
    assert(asBook);
    expect(asBook.fileName).toBe('Subset-lorebook.json');
    const exported = await payloadOf(asBook);
    expect(exported['name']).toBe('Subset');
    // The split book keeps the source's scan settings but starts from a clean
    // extension root: parked vendor data belongs to the source file.
    expect(exported['token_budget']).toBe(1024);
    expect(exported['scan_depth']).toBe(5);
    expect(exported['extensions']).toEqual({});
    const entries = exported['entries'] as Record<string, unknown>[];
    expect(entries).toHaveLength(2);
    // Selection is by id, book order is preserved, display indexes renumbered.
    expect(entries.map((entry) => entry['id'])).toEqual([0, 2]);
    expect(entries.map((entry) => (entry['extensions'] as Record<string, unknown>)['display_index'])).toEqual([0, 1]);

    service.exportSelectedBook(book, [2, 0], 'Subset', 'st_native');
    const asNative = downloads[1];
    assert(asNative);
    expect(asNative.fileName).toBe('Subset-world-info.json');
    const native = await payloadOf(asNative);
    const subsetKeys = Object.keys(native['entries'] as Record<string, unknown>);
    expect(subsetKeys).toEqual(['0', '2']);
    const nativeEntries = native['entries'] as Record<string, Record<string, unknown>>;
    assert(nativeEntries['0']);
    expect(nativeEntries['0']['displayIndex']).toBe(0);
    assert(nativeEntries['2']);
    expect(nativeEntries['2']['displayIndex']).toBe(1);
    expect(nativeEntries['2']['key']).toEqual(['target']);
  });

  it('sanitizes file names and falls back for empty titles', async () => {
    const book: CharacterBook = { extensions: {}, entries: [] };

    service.exportCharacterBook(book, 'Weird:  Title (v2) x');
    const weird = downloads[0];
    assert(weird);
    expect(weird.fileName).toBe('Weird-Title-v2-x-lorebook.json');

    service.exportCharacterBook(book, '');
    const fallback = downloads[1];
    assert(fallback);
    expect(fallback.fileName).toBe('lorestitch-lorebook.json');
  });
});
