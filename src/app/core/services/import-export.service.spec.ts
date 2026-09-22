import { TestBed } from '@angular/core/testing';
import {
  ImportExportService,
  cardJsonExportAvailable,
  cardPngExportAvailable,
} from './import-export.service';
import {
  CharacterBook,
  CharacterBookEntry,
  ST_POSITION,
  characterBookToStNative,
  createEmptyBook,
  toSpecCompliantBook,
} from '../models/lorebook.model';
import { LORESTITCH_ARCHIVE_VERSION, ProjectWorkspace } from '../models/project.model';
import { base64EncodeBytes, crc32, encodeCardPayload, openCardPng } from '../models/character-card';
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
    expect(service.parseImport({ format: 'lorestitch-project', version: 2, workspace })).toBeNull();
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
    expect(service.parseImport({ format: 'lorestitch-project', version: 1, workspace })).toBeNull();
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

// ---------------------------------------------------------------------------
// Character-card fixtures (plan 15 §3.6): minimal PNGs crafted in-test with
// the same recipe as character-card.spec — the spec tree stays binary-free —
// plus a card JSON wrapping a book, so import equivalence and export
// preservation pin against deterministic bytes.
// ---------------------------------------------------------------------------

const CARD_NAME = 'Saber Card';
const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

/** One complete PNG chunk: `[len, type, data, crc]` with a valid CRC. */
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
  return out;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

const IHDR_CHUNK = (): Uint8Array => pngChunk('IHDR', new Uint8Array(13));
const IDAT_CHUNK = (): Uint8Array => pngChunk('IDAT', Uint8Array.of(1, 2, 3, 4));
const FOREIGN_CHUNK = (): Uint8Array => pngChunk('deBG', Uint8Array.of(0xde, 0xad, 0xbe, 0xef));
const IEND_CHUNK = (): Uint8Array => pngChunk('IEND', new Uint8Array(0));

/** tEXt data: keyword + NUL + base64 of the card JSON text. */
function cardTextData(keyword: string, cardJson: string): Uint8Array {
  const payload = encodeCardPayload(cardJson);
  const data = new Uint8Array(keyword.length + 1 + payload.length);
  for (let i = 0; i < keyword.length; i++) {
    data[i] = keyword.charCodeAt(i);
  }
  data[keyword.length] = 0;
  for (let i = 0; i < payload.length; i++) {
    data[keyword.length + 1 + i] = payload.charCodeAt(i);
  }
  return data;
}

function cardPngBytes(cardJson: string, options: { dualChunk?: boolean } = {}): Uint8Array {
  const parts: Uint8Array[] = [PNG_SIGNATURE, IHDR_CHUNK()];
  // Dual-chunk cards (the real fixture profile) carry an independent V3 card
  // beside the V2 one — the service must re-embed both or refuse.
  if (options.dualChunk) {
    parts.push(pngChunk('tEXt', cardTextData('ccv3', dualCardJson())));
  }
  parts.push(pngChunk('tEXt', cardTextData('chara', cardJson)));
  parts.push(IDAT_CHUNK(), FOREIGN_CHUNK(), IEND_CHUNK());
  return concatBytes(...parts);
}

function cardBook(): CharacterBook {
  return {
    name: 'Fuyuki Card Book',
    extensions: {},
    entries: [makeEntry(0, { content: 'Original grail lore' }), makeEntry(1)],
  };
}

function cardJsonText(book: CharacterBook = cardBook()): string {
  return JSON.stringify({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    creator: 'Fixture', // unknown card field — the never-drop pin at card level
    data: { name: CARD_NAME, description: 'Card description', character_book: book },
  });
}

function dualCardJson(): string {
  return JSON.stringify({
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: { name: `${CARD_NAME} V3`, character_book: cardBook() },
  });
}

/** Spec-local chunk walk for byte-identity assertions (data slices included). */
interface SpecChunk {
  readonly type: string;
  readonly data: Uint8Array;
}

function walkChunks(bytes: Uint8Array): SpecChunk[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: SpecChunk[] = [];
  let position = 8;
  while (position + 12 <= bytes.byteLength) {
    const length = view.getUint32(position, false);
    chunks.push({
      type: String.fromCharCode(
        view.getUint8(position + 4),
        view.getUint8(position + 5),
        view.getUint8(position + 6),
        view.getUint8(position + 7),
      ),
      data: bytes.slice(position + 8, position + 8 + length),
    });
    position += 12 + length;
  }
  return chunks;
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
    expect(
      entries.map((entry) => (entry['extensions'] as Record<string, unknown>)['display_index']),
    ).toEqual([0, 1]);

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

  it('carries a card shell with PNG bytes through archive export and import losslessly', async () => {
    // plan 15 §3.2: archives are JSON — the Uint8Array must ride as explicit
    // base64 (`pngBytesBase64`), never as a keyed object, and import decodes
    // it back to the same bytes.
    const bytes = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 250, 251, 252, 253, 254, 255);
    const project: ProjectWorkspace = {
      ...makeProject('Card Carrier'),
      cardShell: {
        spec: 'chara_card_v2',
        cardJson: '{"spec":"chara_card_v2"}',
        pngKeyword: 'chara',
        pngBytes: bytes,
        extraCardJson: { ccv3: '{"spec":"chara_card_v3"}' },
      },
    };

    service.exportProject(project);
    const capture = downloads[0];
    assert(capture);
    const archive = await payloadOf(capture);
    const shell = (archive['workspace'] as Record<string, unknown>)['cardShell'] as Record<
      string,
      unknown
    >;
    expect(shell['pngBytesBase64']).toBe(base64EncodeBytes(bytes));
    expect(Object.hasOwn(shell, 'pngBytes')).toBe(false); // never rides JSON verbatim
    expect(shell['extraCardJson']).toEqual({ ccv3: '{"spec":"chara_card_v3"}' });

    const parsed = service.parseImport(archive);
    assert(parsed);
    assert(parsed.workspace);
    assert(parsed.workspace.cardShell);
    const restored = parsed.workspace.cardShell.pngBytes;
    assert(restored);
    expect([...restored]).toEqual([...bytes]);
    expect(Object.hasOwn(parsed.workspace.cardShell, 'pngBytesBase64')).toBe(false);
    expect(parsed.workspace.cardShell.pngKeyword).toBe('chara');
    expect(parsed.workspace.cardShell.spec).toBe('chara_card_v2');
  });

  it('serializes a JSON-card shell without pngBytesBase64 and round-trips it', async () => {
    const project: ProjectWorkspace = {
      ...makeProject('Json Card'),
      cardShell: { spec: 'chara_card_v3', cardJson: '{"spec":"chara_card_v3"}' },
    };

    service.exportProject(project);
    const capture = downloads[0];
    assert(capture);
    const archive = await payloadOf(capture);
    const shell = (archive['workspace'] as Record<string, unknown>)['cardShell'] as Record<
      string,
      unknown
    >;
    expect(Object.hasOwn(shell, 'pngBytesBase64')).toBe(false);
    expect(shell['cardJson']).toBe('{"spec":"chara_card_v3"}');

    const parsed = service.parseImport(archive);
    assert(parsed);
    assert(parsed.workspace);
    expect(parsed.workspace.cardShell).toEqual({
      spec: 'chara_card_v3',
      cardJson: '{"spec":"chara_card_v3"}',
    });
  });

  it('leaves shell-less archives byte-identical to before card shells existed', async () => {
    const project = makeProject('Legacy');
    service.exportProject(project);
    const capture = downloads[0];
    assert(capture);
    const archive = await payloadOf(capture);
    const workspace = archive['workspace'] as Record<string, unknown>;
    expect(workspace).toEqual(project);
    expect(Object.hasOwn(workspace, 'cardShell')).toBe(false);
    const parsed = service.parseImport(archive);
    assert(parsed);
    assert(parsed.workspace);
    expect(Object.hasOwn(parsed.workspace, 'cardShell')).toBe(false);
  });

  it('rejects an archive whose cardShell is malformed (shape-checked when present)', () => {
    const archive = {
      format: 'lorestitch-project',
      version: LORESTITCH_ARCHIVE_VERSION,
      workspace: { ...makeProject('Bad Shell'), cardShell: { spec: 'chara_card_v1' } },
    };
    expect(service.parseImport(archive)).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Card exports (plan 15 §3.4–3.5): the SERVICE layer — file names, download
  // payloads, non-card byte preservation and refusal reasons (the codec itself
  // is pinned in character-card.spec).
  // -------------------------------------------------------------------------

  it('re-embeds the unedited book into the identical PNG (every byte preserved)', async () => {
    // The shell stores the card JSON as the export already wrote it — the
    // spec-clean conversion inside `data.character_book` — so an unedited
    // book re-embeds the exact same payload and every byte survives.
    const book = cardBook();
    const embeddableCardJson = JSON.stringify({
      spec: 'chara_card_v2',
      spec_version: '2.0',
      creator: 'Fixture',
      data: {
        name: CARD_NAME,
        description: 'Card description',
        character_book: toSpecCompliantBook(book),
      },
    });
    const pngBytes = cardPngBytes(embeddableCardJson);
    const opened = openCardPng(pngBytes);
    assert(!('reason' in opened));
    const project: ProjectWorkspace = {
      ...makeProject('Card Carrier'),
      activeBook: book, // the book as imported — nothing edited yet
      cardShell: {
        spec: opened.spec,
        cardJson: opened.cardJson,
        pngKeyword: opened.pngKeyword,
        pngBytes,
      },
    };

    const failure = service.exportCardPng(project);

    expect(failure).toBeNull();
    expect(downloads).toHaveLength(1);
    const capture = downloads[0];
    assert(capture);
    // The card's own name names the file — not the project title.
    expect(capture.fileName).toBe('Saber-Card.png');
    expect(capture.blob.type).toBe('image/png');
    // An unedited book re-embeds the same payload into a rebuilt, identical
    // chunk: the download is byte-identical to the stored shell image.
    const exported = new Uint8Array(await capture.blob.arrayBuffer());
    expect([...exported]).toEqual([...pngBytes]);
  });

  it('preserves every non-card chunk byte-for-byte when the book was edited', async () => {
    const pngBytes = cardPngBytes(cardJsonText());
    const book = cardBook();
    const first = book.entries[0];
    assert(first);
    first.content = 'EDITED grail lore - new bytes'; // ASCII: the payload decodes byte-exact
    const project: ProjectWorkspace = {
      ...makeProject('Card Carrier'),
      activeBook: book,
      cardShell: {
        spec: 'chara_card_v2',
        cardJson: cardJsonText(),
        pngKeyword: 'chara',
        pngBytes,
      },
    };

    const failure = service.exportCardPng(project);
    expect(failure).toBeNull();
    const capture = downloads[0];
    assert(capture);
    expect(capture.fileName).toBe('Saber-Card.png');

    const exported = new Uint8Array(await capture.blob.arrayBuffer());
    const originalChunks = walkChunks(pngBytes);
    const exportedChunks = walkChunks(exported);
    // Same chunk layout, same order...
    expect(exportedChunks.map((chunk) => chunk.type)).toEqual(
      originalChunks.map((chunk) => chunk.type),
    );
    // ...every non-card chunk (IHDR, IDATs, the foreign deBG, IEND) byte-identical...
    const originalCardIndex = originalChunks.findIndex((chunk) => chunk.type === 'tEXt');
    assert(originalCardIndex >= 0);
    expect(exportedChunks.filter((_, i) => i !== originalCardIndex)).toEqual(
      originalChunks.filter((_, i) => i !== originalCardIndex),
    );
    // ...and the one rewritten card chunk carries the edited book.
    const cardChunk = exportedChunks[originalCardIndex];
    assert(cardChunk);
    const payload = new TextDecoder().decode(cardChunk.data.subarray('chara'.length + 1));
    const decoded = JSON.parse(atob(payload)) as { data: { character_book: CharacterBook } };
    expect(decoded.data.character_book.entries[0]?.content).toBe('EDITED grail lore - new bytes');
  });

  it('refuses the PNG export for shell-less and JSON-card projects', async () => {
    const shellLess = makeProject('No Card');
    expect(service.exportCardPng(shellLess)).toEqual({
      reason: 'no-shell',
      message: 'The project holds no character-card shell.',
    });
    const jsonCard: ProjectWorkspace = {
      ...makeProject('Json Card'),
      cardShell: { spec: 'chara_card_v3', cardJson: cardJsonText() },
    };
    expect(service.exportCardPng(jsonCard)).toEqual({
      reason: 'no-image',
      message: 'The card shell stores no card image — import a card PNG first.',
    });
    // Neither refusal downloads anything.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(downloads).toHaveLength(0);
  });

  it('refuses the PNG export when a remembered card chunk would keep a stale book', async () => {
    // A dual-chunk source whose extra payload was dropped (e.g. a corrupt
    // chunk beside a valid one at import): re-embedding only the preferred
    // chunk would leave the other holding the book as of import.
    const pngBytes = cardPngBytes(cardJsonText(), { dualChunk: true });
    const opened = openCardPng(pngBytes);
    assert(!('reason' in opened));
    const project: ProjectWorkspace = {
      ...makeProject('Stale Carrier'),
      activeBook: cardBook(),
      // The extra payload is deliberately omitted from the shell.
      cardShell: {
        spec: opened.spec,
        cardJson: opened.cardJson,
        pngKeyword: opened.pngKeyword,
        pngBytes,
      },
    };

    const failure = service.exportCardPng(project);

    assert(failure);
    expect(failure.reason).toBe('stale-card-chunk');
    expect(downloads).toHaveLength(0);
  });

  it('swaps the edited book into the card JSON and keeps every other field', async () => {
    const project: ProjectWorkspace = {
      ...makeProject('Json Card'),
      activeBook: cardBook(),
      cardShell: {
        spec: 'chara_card_v2',
        cardJson: cardJsonText(),
      },
    };

    const failure = service.exportCardJson(project);

    expect(failure).toBeNull();
    const capture = downloads[0];
    assert(capture);
    // Card name again, not the project title.
    expect(capture.fileName).toBe('Saber-Card.json');
    const exported = await payloadOf(capture);
    // The swapped book is the same spec-clean conversion the Character Book
    // JSON export uses — one path, not a new one.
    expect(exported['data']).toEqual({
      name: CARD_NAME,
      description: 'Card description',
      character_book: toSpecCompliantBook(cardBook()),
    });
    // Unknown card fields survive the swap verbatim.
    expect(exported['spec']).toBe('chara_card_v2');
    expect(exported['creator']).toBe('Fixture');
  });

  it('falls back to the project title for name-less cards', () => {
    const project: ProjectWorkspace = {
      ...makeProject('Fallback Name'),
      cardShell: {
        spec: 'chara_card_v2',
        cardJson: JSON.stringify({ spec: 'chara_card_v2', data: { character_book: cardBook() } }),
        pngKeyword: 'chara',
        pngBytes: cardPngBytes(
          JSON.stringify({ spec: 'chara_card_v2', data: { character_book: cardBook() } }),
        ),
      },
    };

    expect(service.exportCardJson(project)).toBeNull();
    const capture = downloads[0];
    assert(capture);
    expect(capture.fileName).toBe('Fallback-Name.json');
  });

  it('refuses the JSON card export without a shell', async () => {
    expect(service.exportCardJson(makeProject('No Card'))).toEqual({
      reason: 'no-shell',
      message: 'The project holds no character-card shell.',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(downloads).toHaveLength(0);
  });

  it('derives card export availability from the shell truth table', () => {
    const pngShell = cardPngBytes(cardJsonText());
    const pngProject: ProjectWorkspace = {
      ...makeProject('Png'),
      cardShell: {
        spec: 'chara_card_v2',
        cardJson: cardJsonText(),
        pngKeyword: 'chara',
        pngBytes: pngShell,
      },
    };
    const jsonProject: ProjectWorkspace = {
      ...makeProject('Json'),
      cardShell: { spec: 'chara_card_v2', cardJson: cardJsonText() },
    };

    // No project / no shell: both rows unavailable (the menu disables them).
    expect(cardJsonExportAvailable(null)).toBe(false);
    expect(cardPngExportAvailable(null)).toBe(false);
    expect(cardJsonExportAvailable(makeProject('Bare'))).toBe(false);
    expect(cardPngExportAvailable(makeProject('Bare'))).toBe(false);
    // JSON-card shell: JSON export works, PNG stays disabled.
    expect(cardJsonExportAvailable(jsonProject)).toBe(true);
    expect(cardPngExportAvailable(jsonProject)).toBe(false);
    // PNG shell: both exports available.
    expect(cardJsonExportAvailable(pngProject)).toBe(true);
    expect(cardPngExportAvailable(pngProject)).toBe(true);
  });
});

describe('ImportExportService card imports', () => {
  let service: ImportExportService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ImportExportService);
  });

  it('imports a card JSON through the same book pipeline as a plain-book import', () => {
    const cardJson = cardJsonText();
    const card = service.parseCardImport({ rawText: cardJson }, 'Fallback');
    assert(card.status === 'ok');
    const plain = service.parseImport(cardBook(), 'Fallback');

    assert(plain);
    // Pipeline equivalence: the embedded book normalizes EXACTLY like the
    // same `character_book` imported as a bare lorebook.
    expect(card.parsed.book).toEqual(plain.book);
    // The card boundary is marked additively; plain books never set it.
    expect(card.parsed.cardShell).toEqual({ spec: 'chara_card_v2', cardJson });
    expect(plain.cardShell).toBeUndefined();
    // The card's data.name suggests the project title.
    expect(card.parsed.suggestedTitle).toBe(CARD_NAME);
    expect(card.parsed.format).toBe('character_book');
  });

  it('opens card JSON through the parseImport sniff-fallback branch too', () => {
    const cardJson = cardJsonText();
    const singleCall = service.parseImport(JSON.parse(cardJson), 'Fallback', { rawText: cardJson });
    const direct = service.parseCardImport({ rawText: cardJson }, 'Fallback');
    assert(direct.status === 'ok');
    expect(singleCall).toEqual(direct.parsed);
  });

  it('imports a card PNG with the shell remembering the exact source bytes', () => {
    const pngBytes = cardPngBytes(cardJsonText());
    const card = service.parseCardImport({ pngBytes: pngBytes }, 'Fallback');
    assert(card.status === 'ok');

    const plain = service.parseImport(cardBook(), 'Fallback');
    assert(plain);
    expect(card.parsed.book).toEqual(plain.book);
    const shell = card.parsed.cardShell;
    assert(shell);
    expect(shell.spec).toBe('chara_card_v2');
    expect(shell.cardJson).toBe(cardJsonText());
    expect(shell.pngKeyword).toBe('chara');
    assert(shell.pngBytes);
    expect([...shell.pngBytes]).toEqual([...pngBytes]);
  });

  it('remembers both card payloads of a dual-chunk source', () => {
    const pngBytes = cardPngBytes(cardJsonText(), { dualChunk: true });
    const card = service.parseCardImport({ pngBytes: pngBytes }, 'Fallback');
    assert(card.status === 'ok');
    // ccv3 is the preferred keyword; the chara payload rides as the extra.
    expect(card.parsed.cardShell?.pngKeyword).toBe('ccv3');
    expect(card.parsed.cardShell?.extraCardJson).toEqual({ chara: cardJsonText() });
  });

  it('reports the approved card reasons for unreadable payloads', () => {
    // Valid PNG without a card chunk.
    const barePng = concatBytes(PNG_SIGNATURE, IHDR_CHUNK(), IDAT_CHUNK(), IEND_CHUNK());
    const noChunk = service.parseCardImport({ pngBytes: barePng }, 'F');
    assert(noChunk.status === 'card-error');
    expect(noChunk.error.reason).toBe('no-card-chunk');

    // PNG signature mismatch.
    const notPng = service.parseCardImport({ pngBytes: Uint8Array.of(1, 2, 3) }, 'F');
    assert(notPng.status === 'card-error');
    expect(notPng.error.reason).toBe('not-a-png');

    // A card JSON without an embedded book.
    const bookless = service.parseCardImport(
      { rawText: JSON.stringify({ spec: 'chara_card_v2', data: { name: 'X' } }) },
      'Fallback',
    );
    assert(bookless.status === 'card-error');
    expect(bookless.error.reason).toBe('card-without-book');

    // A card whose embedded book is not a valid lorebook still refused.
    const badBook = service.parseCardImport(
      {
        rawText: JSON.stringify({
          spec: 'chara_card_v2',
          data: { name: 'X', character_book: { entries: [{ keys: 'a', content: 'x' }] } },
        }),
      },
      'Fallback',
    );
    assert(badBook.status === 'card-error');
    expect(badBook.error.reason).toBe('card-json-invalid');
  });
});
