import {
  base64DecodeBytes,
  base64EncodeBytes,
  crc32,
  embedBookIntoCardJson,
  embedCardPayloads,
  encodeCardPayload,
  isCardChunkKeyword,
  isCardSpec,
  openCardJson,
  openCardPng,
  updatedCardPayloads,
  type CardError,
} from './character-card';
import { ST_POSITION, type CharacterBookEntry } from './lorebook.model';
import {
  PNG_SIGNATURE,
  concatBytes,
  corruptCrcOf,
  pngChunk,
  textChunkData,
  walkSpecPng,
} from '../../../testing/png-fixtures';

// ============================================================================
// In-test PNG crafting (plan 15 §3.6: no binary assets — every fixture is a
// minimal hand-built PNG whose bytes this spec fully controls). The shared
// chunk/concat/text/walk machinery lives in `src/testing/png-fixtures.ts`;
// only the card-specific shapes (iTXt/zTXt payloads, trailing bytes) stay here.
// ============================================================================

/** iTXt data: keyword NUL compression-flag compression-method lang NUL translated NUL text. */
function iTXtData(keyword: string, payloadText: string, compressionFlag: number): Uint8Array {
  const language = 'en';
  const out = new Uint8Array(keyword.length + 1 + 2 + language.length + 1 + 1 + payloadText.length);
  let at = 0;
  const write = (text: string): void => {
    for (let i = 0; i < text.length; i++) {
      out[at++] = text.charCodeAt(i);
    }
  };
  write(keyword);
  out[at++] = 0; // keyword separator
  out[at++] = compressionFlag;
  out[at++] = 0; // compression method (zlib)
  write(language);
  out[at++] = 0; // language NUL
  out[at++] = 0; // translated-keyword NUL (empty)
  write(payloadText);
  return out.slice(0, at);
}

/** iTXt data with flag 0 but missing language/translated NUL separators. */
function misShapedITXtData(keyword: string, junk: string): Uint8Array {
  const out = new Uint8Array(keyword.length + 1 + 2 + junk.length);
  let at = 0;
  for (let i = 0; i < keyword.length; i++) {
    out[at++] = keyword.charCodeAt(i);
  }
  out[at++] = 0; // keyword separator
  out[at++] = 0; // compression flag 0 (claims uncompressed)
  out[at++] = 0; // compression method
  for (let i = 0; i < junk.length; i++) {
    out[at++] = junk.charCodeAt(i);
  }
  return out.slice(0, at);
}

/** zTXt data: keyword NUL compression-method + fake zlib stream bytes. */
function zTXtData(keyword: string): Uint8Array {
  return textChunkData(keyword, '\x78\x9c\x63\x00\x01'); // 0x78 0x9c zlib header + junk
}

/** Concatenates a full PNG: signature + chunks. */
function png(...chunks: Uint8Array[]): Uint8Array {
  return concatBytes(PNG_SIGNATURE, ...chunks);
}

/** Minimal (never decoded) IHDR data: 1x1, 8-bit RGBA. */
function ihdrData(): Uint8Array {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, 1, false);
  view.setUint32(4, 1, false);
  data[8] = 8; // bit depth
  data[9] = 6; // color type RGBA
  return data;
}

const IHDR = (): Uint8Array => pngChunk('IHDR', ihdrData());
const IDAT_A = (): Uint8Array => pngChunk('IDAT', Uint8Array.of(1, 2, 3, 4));
const DE_BG = (): Uint8Array => pngChunk('deBG', Uint8Array.of(0xde, 0xad, 0xbe, 0xef));
const IEND = (): Uint8Array => pngChunk('IEND', new Uint8Array(0));
const TRAILING = Uint8Array.of(0xaa, 0xbb, 0xcc); // bytes after IEND

// ============================================================================
// Card JSON fixtures
// ============================================================================

const ENTRY: CharacterBookEntry = {
  id: 0,
  keys: ['k'],
  content: 'c',
  enabled: true,
  insertion_order: 0,
  extensions: {},
};

function v2CardJson(entries: CharacterBookEntry[]): string {
  return JSON.stringify({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: { name: 'Test Card', character_book: { name: 'Book', extensions: {}, entries } },
  });
}

function v3CardJson(entries: CharacterBookEntry[]): string {
  return JSON.stringify({
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: { name: 'Test Card', character_book: { name: 'Book', extensions: {}, entries } },
  });
}

function cardPng(cardText: string): Uint8Array {
  return png(
    IHDR(),
    pngChunk('tEXt', textChunkData('chara', encodeCardPayload(cardText))),
    IDAT_A(),
    IEND(),
  );
}

function expectCardError(result: unknown, reason: string): asserts result is CardError {
  assert('reason' in (result as object), `expected a CardError with reason '${reason}'`);
  expect((result as CardError).reason).toBe(reason);
}

// ============================================================================
// Codec
// ============================================================================

describe('character-card', () => {
  describe('crc32 / base64 helpers', () => {
    it('crc32 matches the PNG spec test vector', () => {
      const bytes = Uint8Array.from('123456789', (c) => c.charCodeAt(0));
      expect(crc32(bytes)).toBe(0xcbf43926);
    });

    it('base64 round-trips bytes of every remainder class', () => {
      for (const length of [0, 1, 2, 3, 4, 5, 7, 9]) {
        const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 11) & 0xff);
        const decoded = base64DecodeBytes(base64EncodeBytes(bytes));
        assert(decoded);
        expect([...decoded]).toEqual([...bytes]);
      }
    });

    it('base64EncodeBytes covers all padding shapes', () => {
      expect(base64EncodeBytes(Uint8Array.of(0x41))).toBe('QQ==');
      expect(base64EncodeBytes(Uint8Array.of(0x41, 0x42))).toBe('QUI=');
      expect(base64EncodeBytes(Uint8Array.of(0x41, 0x42, 0x43))).toBe('QUJD');
      expect(base64EncodeBytes(new Uint8Array(0))).toBe('');
    });

    it('base64DecodeBytes is forgiving on whitespace and missing padding', () => {
      expect(new TextDecoder().decode(base64DecodeBytes('Q U\tJ\nD') ?? new Uint8Array())).toBe(
        'ABC',
      );
      expect(new TextDecoder().decode(base64DecodeBytes('QUI') ?? new Uint8Array())).toBe('AB');
    });

    it('base64DecodeBytes rejects invalid input with null, never a throw', () => {
      expect(base64DecodeBytes('A!')).toBeNull(); // non-alphabet character
      expect(base64DecodeBytes('AB=C')).toBeNull(); // data after padding
      expect(base64DecodeBytes('A')).toBeNull(); // dangling single sextet
    });

    it('encodeCardPayload is base64 of the UTF-8 bytes', () => {
      const text = 'café 日本語 😀 \ud800 trailing';
      expect([...(base64DecodeBytes(encodeCardPayload(text)) ?? [])]).toEqual([
        ...new TextEncoder().encode(text),
      ]);
      // A high surrogate followed by a non-low-surrogate encodes as U+FFFD.
      const loneHigh = '\ud800x';
      expect([...(base64DecodeBytes(encodeCardPayload(loneHigh)) ?? [])]).toEqual([
        ...new TextEncoder().encode(loneHigh),
      ]);
      // A lone low surrogate — and a high surrogate at the very end — too.
      const loneLow = 'x\udfffend';
      expect([...(base64DecodeBytes(encodeCardPayload(loneLow)) ?? [])]).toEqual([
        ...new TextEncoder().encode(loneLow),
      ]);
      const highAtEnd = 'a\ud800';
      expect([...(base64DecodeBytes(encodeCardPayload(highAtEnd)) ?? [])]).toEqual([
        ...new TextEncoder().encode(highAtEnd),
      ]);
    });

    it('spec/keyword guards accept exactly the two literals', () => {
      expect(isCardSpec('chara_card_v2')).toBe(true);
      expect(isCardSpec('chara_card_v3')).toBe(true);
      expect(isCardSpec('chara_card_v1')).toBe(false);
      expect(isCardSpec(null)).toBe(false);
      expect(isCardChunkKeyword('chara')).toBe(true);
      expect(isCardChunkKeyword('ccv3')).toBe(true);
      expect(isCardChunkKeyword('ccv2')).toBe(false);
      expect(isCardChunkKeyword(42)).toBe(false);
    });
  });

  describe('openCardPng', () => {
    it('opens a single-chara PNG with the payload text verbatim', () => {
      const cardText = v2CardJson([ENTRY]);
      const opened = openCardPng(cardPng(cardText));
      assert(!('reason' in opened));
      expect(opened.spec).toBe('chara_card_v2');
      expect(opened.pngKeyword).toBe('chara');
      expect(opened.cardJson).toBe(cardText);
      expect(opened.rawBook).toEqual(JSON.parse(cardText).data.character_book);
      expect(opened.extraCardJson).toBeUndefined();
      expect(opened.warnings).toBeUndefined();
      assert(opened.pngBytes);
      expect([...opened.pngBytes]).toEqual([...cardPng(cardText)]);
    });

    it('prefers ccv3 over chara and remembers the other payload (dual-chunk)', () => {
      const v2 = v2CardJson([ENTRY]);
      const v3 = v3CardJson([{ ...ENTRY, content: 'v3 content' }]);
      const bytes = png(
        IHDR(),
        pngChunk('tEXt', textChunkData('chara', encodeCardPayload(v2))),
        IDAT_A(),
        pngChunk('tEXt', textChunkData('ccv3', encodeCardPayload(v3))),
        IEND(),
      );
      const opened = openCardPng(bytes);
      assert(!('reason' in opened));
      expect(opened.spec).toBe('chara_card_v3');
      expect(opened.pngKeyword).toBe('ccv3');
      expect(opened.cardJson).toBe(v3);
      expect(opened.extraCardJson).toEqual({ chara: v2 });
      expect(opened.warnings).toBeUndefined(); // Different keywords are NOT duplicates.
    });

    it('derives the spec from the chunk keyword when the payload has no spec field', () => {
      const booklessSpec = JSON.stringify({
        data: { name: 'Specless', character_book: { name: 'B', extensions: {}, entries: [] } },
      });
      const opened = openCardPng(
        png(
          IHDR(),
          pngChunk('tEXt', textChunkData('ccv3', encodeCardPayload(booklessSpec))),
          IEND(),
        ),
      );
      assert(!('reason' in opened));
      expect(opened.spec).toBe('chara_card_v3');
    });

    it('multiple same-keyword chunks: first wins with a warning', () => {
      const first = v2CardJson([{ ...ENTRY, content: 'first' }]);
      const second = v2CardJson([{ ...ENTRY, content: 'second' }]);
      const bytes = png(
        IHDR(),
        pngChunk('tEXt', textChunkData('chara', encodeCardPayload(first))),
        pngChunk('tEXt', textChunkData('chara', encodeCardPayload(second))),
        IEND(),
      );
      const opened = openCardPng(bytes);
      assert(!('reason' in opened));
      expect(opened.cardJson).toBe(first);
      expect(opened.warnings).toEqual([
        {
          reason: 'multiple-card-chunks',
          keyword: 'chara',
          message: "Multiple 'chara' card chunks in the PNG — the first one wins.",
        },
      ]);
    });

    it('a card chunk failing its CRC is bad-chunk-crc', () => {
      const bytes = cardPng(v2CardJson([ENTRY]));
      const cardChunk = walkSpecPng(bytes)[1];
      assert(cardChunk);
      const opened = openCardPng(corruptCrcOf(bytes, cardChunk));
      expectCardError(opened, 'bad-chunk-crc');
      expect(opened.keyword).toBe('chara');
    });

    it('tolerates an uncompressed iTXt card chunk', () => {
      const cardText = v2CardJson([ENTRY]);
      const bytes = png(
        IHDR(),
        pngChunk('iTXt', iTXtData('chara', encodeCardPayload(cardText), 0)),
        IEND(),
      );
      const opened = openCardPng(bytes);
      assert(!('reason' in opened));
      expect(opened.cardJson).toBe(cardText);
      expect(opened.pngKeyword).toBe('chara');
    });

    it('a compressed iTXt card chunk alone names the limitation', () => {
      const bytes = png(
        IHDR(),
        pngChunk('iTXt', iTXtData('chara', encodeCardPayload(v2CardJson([ENTRY])), 1)),
        IEND(),
      );
      expectCardError(openCardPng(bytes), 'compressed-card-chunk');
    });

    it('a mis-shaped uncompressed iTXt card chunk is unreadable, never skipped silently', () => {
      // flag = 0 but the language/translated NUL separators are missing.
      const bytes = png(
        IHDR(),
        pngChunk('iTXt', misShapedITXtData('chara', 'no-nuls-here')),
        IEND(),
      );
      expectCardError(openCardPng(bytes), 'compressed-card-chunk');
    });

    it('a zTXt card chunk alone names the zTXt limitation', () => {
      const bytes = png(IHDR(), pngChunk('zTXt', zTXtData('chara')), IEND());
      expectCardError(openCardPng(bytes), 'compressed-card-chunk');
    });

    it('a zTXt card chunk beside a readable one is opaque preserved bytes', () => {
      const v3 = v3CardJson([ENTRY]);
      const bytes = png(
        IHDR(),
        pngChunk('zTXt', zTXtData('chara')),
        pngChunk('tEXt', textChunkData('ccv3', encodeCardPayload(v3))),
        IEND(),
      );
      const opened = openCardPng(bytes);
      assert(!('reason' in opened));
      expect(opened.spec).toBe('chara_card_v3');
      expect(opened.extraCardJson).toBeUndefined();
      // Export is not blocked by the unreadable chunk (no stale check trips).
      const embedded = embedCardPayloads(bytes, { ccv3: v3 });
      assert(!('reason' in embedded));
      expect([...embedded]).toEqual([...bytes]); // Nothing to rewrite or insert.
    });

    it('a corrupt preferred payload falls back to the other keyword', () => {
      const v2 = v2CardJson([ENTRY]);
      const bytes = png(
        IHDR(),
        pngChunk('tEXt', textChunkData('ccv3', '!!!not base64!!!')),
        pngChunk('tEXt', textChunkData('chara', encodeCardPayload(v2))),
        IEND(),
      );
      const opened = openCardPng(bytes);
      assert(!('reason' in opened));
      expect(opened.pngKeyword).toBe('chara');
      expect(opened.spec).toBe('chara_card_v2');
      expect(opened.cardJson).toBe(v2);
      expect(opened.extraCardJson).toBeUndefined(); // The corrupt ccv3 is not remembered.
    });

    it('corrupt preferred with no readable fallback returns the preferred error', () => {
      const bytes = png(IHDR(), pngChunk('tEXt', textChunkData('ccv3', '!!!')), IEND());
      const error = openCardPng(bytes);
      expectCardError(error, 'bad-base64');
      expect(error.keyword).toBe('ccv3');
    });

    it('both card chunks unreadable returns the preferred spec error', () => {
      const notJson = encodeCardPayload('not json at all');
      const bytes = png(
        IHDR(),
        pngChunk('tEXt', textChunkData('ccv3', '!!!')),
        pngChunk('tEXt', textChunkData('chara', notJson)),
        IEND(),
      );
      expectCardError(openCardPng(bytes), 'bad-base64');
    });

    it('a non-base64 Latin-1 payload byte is respected and rejected, not munged', () => {
      // 0xC3 0xA9 (é in UTF-8) inside the base64 text is invalid base64 — the
      // tEXt Latin-1 boundary keeps the bytes as-is and the decoder refuses.
      const bytes = png(IHDR(), pngChunk('tEXt', textChunkData('chara', '\xc3\xa9bad')), IEND());
      expectCardError(openCardPng(bytes), 'bad-base64');
    });

    it('a card payload that is not JSON is card-json-invalid', () => {
      const bytes = png(
        IHDR(),
        pngChunk('tEXt', textChunkData('chara', encodeCardPayload('plain text'))),
        IEND(),
      );
      expectCardError(openCardPng(bytes), 'card-json-invalid');
      // A payload whose decode flushes exactly on a 4096-code-unit boundary.
      const boundary = encodeCardPayload('a'.repeat(4096));
      const boundaryBytes = png(IHDR(), pngChunk('tEXt', textChunkData('chara', boundary)), IEND());
      expectCardError(openCardPng(boundaryBytes), 'card-json-invalid');
    });

    it('invalid UTF-8 in the payload never throws (each shape yields U+FFFD)', () => {
      // invalid lead | invalid continuation | overlong 2/3-byte | surrogate |
      // 4-byte out of range | truncated 4-byte sequence
      const shapes = [
        [0x22, 0x80, 0x22],
        [0x22, 0xc2, 0x41, 0x22],
        [0x22, 0xc0, 0xaf, 0x22],
        [0x22, 0xe0, 0x80, 0x80, 0x22],
        [0x22, 0xed, 0xa0, 0x80, 0x22],
        [0x22, 0xf7, 0xbf, 0xbf, 0xbf, 0x22],
        [0x22, 0xf0],
      ];
      for (const shape of shapes) {
        const bytes = png(
          IHDR(),
          pngChunk(
            'tEXt',
            textChunkData('chara', base64EncodeBytes(Uint8Array.from(shape, (b) => b))),
          ),
          IEND(),
        );
        expectCardError(openCardPng(bytes), 'card-json-invalid');
      }
    });

    it('a valid PNG without card chunks is no-card-chunk', () => {
      expectCardError(openCardPng(png(IHDR(), IDAT_A(), IEND())), 'no-card-chunk');
    });

    it('non-PNG bytes are not-a-png and never throw', () => {
      expectCardError(openCardPng(new Uint8Array(0)), 'not-a-png');
      expectCardError(openCardPng(Uint8Array.of(1, 2, 3, 4, 5, 6, 7)), 'not-a-png');
      expectCardError(
        openCardPng(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0b)),
        'not-a-png',
      );
    });

    it('a PNG cut mid-chunk after the card chunk opens with a truncation warning', () => {
      const full = png(
        IHDR(),
        pngChunk('tEXt', textChunkData('chara', encodeCardPayload(v2CardJson([ENTRY])))),
        IEND(),
      );
      const truncated = full.slice(0, full.length - 12); // IEND cut off
      const opened = openCardPng(truncated);
      assert(!('reason' in opened));
      expect(opened.warnings).toEqual([
        {
          reason: 'truncated-png',
          message: 'The PNG ends without an IEND chunk (truncated); card data may be incomplete.',
        },
      ]);
    });

    it('a PNG cut before any card chunk is no-card-chunk, never a throw', () => {
      expectCardError(openCardPng(png(IHDR(), IDAT_A()).slice(0, 12)), 'no-card-chunk');
    });

    it('a PNG whose final chunk header is complete but data is cut is no-card-chunk', () => {
      // Signature + [len=100]["IDAT"] + 4 junk bytes: the header reads fine,
      // the data does not exist — the walk ends truncated, nothing throws.
      const bytes = concatBytes(
        Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
        Uint8Array.of(0, 0, 0, 100),
        Uint8Array.from('IDAT', (c) => c.charCodeAt(0)),
        Uint8Array.of(1, 2, 3, 4),
      );
      expectCardError(openCardPng(bytes), 'no-card-chunk');
    });

    it('a tEXt chunk without a keyword NUL is opaque (never a card chunk)', () => {
      const bytes = png(
        IHDR(),
        pngChunk(
          'tEXt',
          Uint8Array.from('justtext', (c) => c.charCodeAt(0)),
        ),
        IEND(),
      );
      expectCardError(openCardPng(bytes), 'no-card-chunk');
    });

    it('a tEXt chunk with a non-card keyword is opaque beside a real card chunk', () => {
      const cardText = v2CardJson([ENTRY]);
      const bytes = png(
        IHDR(),
        pngChunk('tEXt', textChunkData('comment', 'hello\x00world')),
        pngChunk('tEXt', textChunkData('chara', encodeCardPayload(cardText))),
        IEND(),
      );
      const opened = openCardPng(bytes);
      assert(!('reason' in opened));
      expect(opened.cardJson).toBe(cardText);
      expect(opened.warnings).toBeUndefined();
    });
  });

  describe('openCardJson', () => {
    it('opens V2 and V3 card JSON', () => {
      for (const [text, spec] of [
        [v2CardJson([ENTRY]), 'chara_card_v2'],
        [v3CardJson([ENTRY]), 'chara_card_v3'],
      ] as const) {
        const opened = openCardJson(text);
        assert(!('reason' in opened));
        expect(opened.spec).toBe(spec);
        expect(opened.cardJson).toBe(text);
        expect(opened.pngBytes).toBeUndefined();
        expect(opened.pngKeyword).toBeUndefined();
        expect(opened.warnings).toBeUndefined();
      }
    });

    it('a V1 card without a book is card-without-book', () => {
      const v1 = JSON.stringify({ name: 'V1 Card', description: 'no book here' });
      expectCardError(openCardJson(v1), 'card-without-book');
    });

    it('a book-less V2/V3 card is card-without-book', () => {
      expectCardError(
        openCardJson(JSON.stringify({ spec: 'chara_card_v2', data: { name: 'N' } })),
        'card-without-book',
      );
      expectCardError(
        openCardJson(
          JSON.stringify({ spec: 'chara_card_v3', data: { name: 'N', character_book: null } }),
        ),
        'card-without-book',
      );
    });

    it('not-JSON and non-object payloads are not-a-card', () => {
      expectCardError(openCardJson('{nope'), 'not-a-card');
      expectCardError(openCardJson('42'), 'not-a-card');
    });

    it('a payload without a spec field defaults to V2 on the JSON path', () => {
      const text = JSON.stringify({ data: { character_book: { extensions: {}, entries: [] } } });
      const opened = openCardJson(text);
      assert(!('reason' in opened));
      expect(opened.spec).toBe('chara_card_v2');
    });

    it('unknown card fields and key order survive verbatim (card-level never-drop pin)', () => {
      const text = JSON.stringify({
        zzz_unknown_top: { keep: true },
        spec: 'chara_card_v3',
        data: {
          name: 'N',
          character_book: { extensions: {}, entries: [] },
          aaa_vendor_extra: [1, 2, 3],
        },
      });
      const opened = openCardJson(text);
      assert(!('reason' in opened));
      expect(opened.rawBook).toEqual({ extensions: {}, entries: [] });
      const reparsed = JSON.parse(opened.cardJson) as Record<string, unknown>;
      expect(Object.keys(reparsed)).toEqual(['zzz_unknown_top', 'spec', 'data']);
      expect(reparsed['zzz_unknown_top']).toEqual({ keep: true });
    });
  });

  describe('embedBookIntoCardJson', () => {
    it('swaps only data.character_book, keeping unknown fields and key order', () => {
      const text = JSON.stringify({
        spec: 'chara_card_v2',
        data: {
          name: 'N',
          character_book: { extensions: {}, entries: [] },
          vendor_extra: { a: 1 },
        },
      });
      const updatedBook: Parameters<typeof embedBookIntoCardJson>[1] = {
        name: 'Edited',
        extensions: {},
        entries: [{ ...ENTRY, content: 'edited' }],
      };
      const embedded = embedBookIntoCardJson(text, updatedBook);
      assert(typeof embedded === 'string');
      const reparsed = JSON.parse(embedded) as {
        data: Record<string, unknown> & { character_book: Record<string, unknown> };
      };
      // character_book keeps its key position; the extra vendor key survives.
      expect(Object.keys(reparsed['data'])).toEqual(['name', 'character_book', 'vendor_extra']);
      expect(reparsed['data']['vendor_extra']).toEqual({ a: 1 });
      const book = reparsed['data']['character_book'] as Record<string, unknown>;
      expect(book['name']).toBe('Edited');
      // The swapped book carries the toSpecCompliantBook conversion fields.
      expect(book['entries']).toEqual([
        {
          ...ENTRY,
          content: 'edited',
          position: 'before_char',
          extensions: { position: ST_POSITION.before },
        },
      ]);
    });

    it('runs the same toSpecCompliantBook conversion as the book export', () => {
      const text = v2CardJson([ENTRY]);
      const book: Parameters<typeof embedBookIntoCardJson>[1] = {
        extensions: {},
        entries: [{ ...ENTRY, extensions: { position: ST_POSITION.atDepth, vendor: true } }],
      };
      const embedded = embedBookIntoCardJson(text, book);
      assert(typeof embedded === 'string');
      const entry = ((
        JSON.parse(embedded) as { data: { character_book: { entries: Record<string, unknown>[] } } }
      ).data.character_book.entries[0] ?? {}) as Record<string, unknown>;
      // Spec position collapses; the true ST position mirrors in extensions.
      expect(entry['position']).toBe('after_char');
      expect(entry['extensions']).toEqual({ position: ST_POSITION.atDepth, vendor: true });
    });

    it('never invents entry ids at the card boundary', () => {
      const text = v2CardJson([ENTRY]);
      const embedded = embedBookIntoCardJson(text, {
        extensions: {},
        entries: [
          { keys: ['a'], content: 'no id', enabled: true, insertion_order: 0, extensions: {} },
          { ...ENTRY, id: 5, keys: ['b'], content: 'kept id' },
        ],
      });
      assert(typeof embedded === 'string');
      const entries = (
        JSON.parse(embedded) as { data: { character_book: { entries: Record<string, unknown>[] } } }
      ).data.character_book.entries.map((entry) => 'id' in entry);
      expect(entries).toEqual([false, true]);
    });

    it('rejects unswappable payloads with a CardError, never a throw', () => {
      const book: Parameters<typeof embedBookIntoCardJson>[1] = { extensions: {}, entries: [] };
      expectCardError(embedBookIntoCardJson('{nope', book), 'card-json-invalid');
      expectCardError(embedBookIntoCardJson('42', book), 'card-json-invalid');
      expectCardError(embedBookIntoCardJson('{"spec":"chara_card_v2"}', book), 'card-without-book');
      expectCardError(
        embedBookIntoCardJson('{"spec":"chara_card_v2","data":{"name":"N"}}', book),
        'card-without-book',
      );
    });
  });

  describe('updatedCardPayloads', () => {
    it('embeds the updated book into the preferred payload and each extra payload', () => {
      const v2 = v2CardJson([{ ...ENTRY, content: 'old v2' }]);
      const v3 = v3CardJson([{ ...ENTRY, content: 'old v3' }]);
      const book: Parameters<typeof updatedCardPayloads>[1] = {
        extensions: {},
        entries: [{ ...ENTRY, content: 'fresh' }],
      };
      const payloads = updatedCardPayloads(
        { cardJson: v3, pngKeyword: 'ccv3', extraCardJson: { chara: v2 } },
        book,
      );
      assert(!('reason' in payloads));
      const fresh = JSON.parse(payloads['ccv3'] ?? '') as {
        data: { character_book: { entries: { content: string }[] } };
      };
      expect(fresh.data.character_book.entries[0]?.content).toBe('fresh');
      expect(payloads['chara']).toBeTypeOf('string');
      expect(JSON.parse(payloads['chara'] ?? '')).toMatchObject({ spec: 'chara_card_v2' });
      expect(JSON.parse(payloads['ccv3'] ?? '')).toMatchObject({ spec: 'chara_card_v3' });
    });

    it('propagates embed errors from any payload', () => {
      const payloads = updatedCardPayloads(
        { cardJson: v3CardJson([ENTRY]), pngKeyword: 'ccv3', extraCardJson: { chara: 'not json' } },
        { extensions: {}, entries: [] },
      );
      expectCardError(payloads, 'card-json-invalid');
    });

    it('propagates an error from the primary payload itself', () => {
      const payloads = updatedCardPayloads(
        { cardJson: '{nope', pngKeyword: 'chara', extraCardJson: { ccv3: v3CardJson([ENTRY]) } },
        { extensions: {}, entries: [] },
      );
      expectCardError(payloads, 'card-json-invalid');
    });
  });

  describe('embedCardPayloads', () => {
    it('refuses non-PNG bytes', () => {
      expectCardError(
        embedCardPayloads(Uint8Array.of(1, 2, 3), { chara: v2CardJson([ENTRY]) }),
        'not-a-png',
      );
    });

    it('replaces in place — longer payload, every other chunk byte-identical', () => {
      const cardText = v2CardJson([ENTRY]);
      const bytes = png(
        IHDR(),
        pngChunk('tEXt', textChunkData('chara', encodeCardPayload(cardText))),
        IDAT_A(),
        DE_BG(),
        IEND(),
      );
      const longer = v2CardJson([{ ...ENTRY, content: 'x'.repeat(500) }]);
      const embedded = embedCardPayloads(bytes, { chara: longer });
      assert(!('reason' in embedded));
      expect(embedded.byteLength).toBeGreaterThan(bytes.byteLength);
      // Only chunk index 1 (the card chunk) may differ; all others byte-equal.
      const before = walkSpecPng(bytes);
      const after = walkSpecPng(embedded);
      expect(after.length).toBe(before.length);
      for (let i = 0; i < before.length; i++) {
        const original = before[i];
        const now = after[i];
        assert(original && now);
        if (i === 1) {
          expect(now.type).toBe('tEXt');
          expect(new TextDecoder().decode(now.data)).toBe('chara\x00' + encodeCardPayload(longer));
          const view = new DataView(embedded.buffer, embedded.byteOffset, embedded.byteLength);
          const length = view.getUint32(now.chunkStart, false);
          expect(length).toBe(now.data.length);
          expect(view.getUint32(now.chunkStart + 8 + length, false)).toBe(
            crc32(embedded.subarray(now.chunkStart + 4, now.chunkStart + 8 + length)),
          );
        } else {
          expect(now.type).toBe(original.type);
          expect([...now.data]).toEqual([...original.data]);
        }
      }
      // The re-embedded payload decodes back to the updated JSON.
      const reopened = openCardPng(embedded);
      assert(!('reason' in reopened));
      expect(reopened.cardJson).toBe(longer);
    });

    it('replaces in place — shorter payload shifts the tail byte-identically', () => {
      const long = v2CardJson([{ ...ENTRY, content: 'x'.repeat(500) }]);
      const bytes = png(
        IHDR(),
        pngChunk('tEXt', textChunkData('chara', encodeCardPayload(long))),
        IDAT_A(),
        DE_BG(),
        IEND(),
        TRAILING,
      );
      const short = v2CardJson([{ ...ENTRY, content: 'y'.repeat(50) }]);
      const embedded = embedCardPayloads(bytes, { chara: short });
      assert(!('reason' in embedded));
      expect(embedded.byteLength).toBeLessThan(bytes.byteLength);
      const before = walkSpecPng(bytes);
      const after = walkSpecPng(embedded);
      expect(after.length).toBe(before.length);
      for (let i = 0; i < before.length; i++) {
        const original = before[i];
        const now = after[i];
        assert(original && now);
        if (i === 1) {
          expect(new TextDecoder().decode(now.data)).toBe('chara\x00' + encodeCardPayload(short));
        } else {
          expect([...now.data]).toEqual([...original.data]); // IDAT, deBG, IEND
        }
      }
      // Trailing bytes after IEND are preserved byte-identically.
      const iendEnd = (after[after.length - 1]?.chunkStart ?? 0) + 12;
      expect([...embedded.slice(iendEnd)]).toEqual([...TRAILING]);
    });

    it('embedding the exact original payload reproduces the PNG byte-for-byte', () => {
      const cardText = v2CardJson([ENTRY]);
      const bytes = png(
        IHDR(),
        pngChunk('tEXt', textChunkData('chara', encodeCardPayload(cardText))),
        IDAT_A(),
        IEND(),
        TRAILING,
      );
      const embedded = embedCardPayloads(bytes, { chara: cardText });
      assert(!('reason' in embedded));
      expect([...embedded]).toEqual([...bytes]);
    });

    it('inserts before IEND when the keyword is absent', () => {
      const bytes = png(IHDR(), IDAT_A(), IEND(), TRAILING);
      const embedded = embedCardPayloads(bytes, { chara: v2CardJson([ENTRY]) });
      assert(!('reason' in embedded));
      const after = walkSpecPng(embedded);
      expect(after.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'tEXt', 'IEND']);
      // The insert sits directly before IEND; all other bytes are untouched.
      expect([...(after[2]?.data ?? new Uint8Array())]).toEqual([
        ...textChunkData('chara', encodeCardPayload(v2CardJson([ENTRY]))),
      ]);
      expect([...(after[0]?.data ?? new Uint8Array())]).toEqual([...ihdrData()]);
      expect([...(after[1]?.data ?? new Uint8Array())]).toEqual([...IDAT_A().slice(8, -4)]);
      expect([...embedded.slice((after[3]?.chunkStart ?? 0) + 12)]).toEqual([...TRAILING]);
    });

    it('inserts both keywords ccv3-first so a re-import prefers ccv3', () => {
      const bytes = png(IHDR(), IEND());
      const embedded = embedCardPayloads(bytes, {
        ccv3: v3CardJson([ENTRY]),
        chara: v2CardJson([ENTRY]),
      });
      assert(!('reason' in embedded));
      expect(walkSpecPng(embedded).map((c) => c.type)).toEqual(['IHDR', 'tEXt', 'tEXt', 'IEND']);
      const reopened = openCardPng(embedded);
      assert(!('reason' in reopened));
      expect(reopened.pngKeyword).toBe('ccv3');
    });

    it('a payload-less call on a card-less PNG returns an untouched fresh copy', () => {
      const bytes = png(IHDR(), IDAT_A(), IEND());
      const result = embedCardPayloads(bytes, {});
      assert(!('reason' in result));
      expect(result).not.toBe(bytes);
      expect([...result]).toEqual([...bytes]);
    });

    it('never mutates the caller-owned bytes', () => {
      const bytes = cardPng(v2CardJson([ENTRY]));
      const snapshot = bytes.slice();
      const updated = v2CardJson([{ ...ENTRY, content: 'edited' }]);
      const embedded = embedCardPayloads(bytes, { chara: updated });
      assert(!('reason' in embedded));
      expect([...bytes]).toEqual([...snapshot]);
      expect(embedded).not.toBe(bytes);
      // Opening does not hand out a copy either — the shell is read-only.
      const opened = openCardPng(bytes);
      assert(!('reason' in opened));
      expect(opened.pngBytes).toBe(bytes);
    });

    it('a readable card chunk without its payload is stale-card-chunk', () => {
      const bytes = cardPng(v2CardJson([ENTRY]));
      const error = embedCardPayloads(bytes, { ccv3: v3CardJson([ENTRY]) });
      expectCardError(error, 'stale-card-chunk');
      expect(error.keyword).toBe('chara');
    });

    it('inserting into a truncated PNG (no IEND) is no-iend-chunk', () => {
      const bytes = png(IHDR(), IDAT_A()).slice(0, 8 + 12 + 13 + 6); // cut mid-IDAT
      const error = embedCardPayloads(bytes, { chara: v2CardJson([ENTRY]) });
      expectCardError(error, 'no-iend-chunk');
    });

    it('replacing (without insert) still works on a truncated shell', () => {
      const cardText = v2CardJson([ENTRY]);
      // Cut off exactly the IEND chunk: the card chunk stays fully intact.
      const bytes = png(
        IHDR(),
        pngChunk('tEXt', textChunkData('chara', encodeCardPayload(cardText))),
        IEND(),
      ).slice(0, -12);
      const embedded = embedCardPayloads(bytes, {
        chara: v2CardJson([{ ...ENTRY, content: 'new' }]),
      });
      assert(!('reason' in embedded));
      const reopened = openCardPng(embedded);
      assert(!('reason' in reopened));
      expect(reopened.warnings?.map((w) => w.reason)).toContain('truncated-png');
      expect(reopened.cardJson).toBe(v2CardJson([{ ...ENTRY, content: 'new' }]));
    });

    it('an oversized multi-hundred-KB non-Latin-1 book round-trips through base64', () => {
      const oversized = v2CardJson([
        {
          ...ENTRY,
          content: 'x'.repeat(200_000) + '日本語のロアブック'.repeat(40_000) + '😀'.repeat(5_000),
        },
      ]);
      const bytes = png(
        IHDR(),
        pngChunk('tEXt', textChunkData('chara', encodeCardPayload(oversized))),
        IDAT_A(),
        IEND(),
      );
      assert(bytes.byteLength > 400_000);
      const embedded = embedCardPayloads(bytes, { chara: oversized });
      assert(!('reason' in embedded));
      const reopened = openCardPng(embedded);
      assert(!('reason' in reopened));
      expect(reopened.cardJson).toBe(oversized);
      const entries = (
        JSON.parse(reopened.cardJson) as {
          data: { character_book: { entries: { content: string }[] } };
        }
      ).data.character_book.entries;
      expect(entries[0]?.content).toBe(
        'x'.repeat(200_000) + '日本語のロアブック'.repeat(40_000) + '😀'.repeat(5_000),
      );
    });

    it('a dual-chunk card re-embeds both chunks and nothing else moves', () => {
      const v2 = v2CardJson([{ ...ENTRY, content: 'old v2' }]);
      const v3 = v3CardJson([{ ...ENTRY, content: 'old v3' }]);
      const bytes = png(
        IHDR(),
        pngChunk('tEXt', textChunkData('chara', encodeCardPayload(v2))),
        IDAT_A(),
        pngChunk('tEXt', textChunkData('ccv3', encodeCardPayload(v3))),
        DE_BG(),
        IEND(),
        TRAILING,
      );
      const opened = openCardPng(bytes);
      assert(!('reason' in opened));
      const editedBook: Parameters<typeof updatedCardPayloads>[1] = {
        extensions: {},
        entries: [{ ...ENTRY, content: 'edited everywhere' }],
      };
      const payloads = updatedCardPayloads(
        { cardJson: opened.cardJson, pngKeyword: 'ccv3', extraCardJson: opened.extraCardJson },
        editedBook,
      );
      assert(!('reason' in payloads));
      const embedded = embedCardPayloads(bytes, payloads);
      assert(!('reason' in embedded));

      const before = walkSpecPng(bytes);
      const after = walkSpecPng(embedded);
      expect(after.length).toBe(before.length);
      for (let i = 0; i < before.length; i++) {
        const original = before[i];
        const now = after[i];
        assert(original && now);
        if (i === 1 || i === 3) {
          expect(now.type).toBe('tEXt');
        } else {
          expect([...now.data]).toEqual([...original.data]); // IHDR, IDAT, deBG, IEND
        }
      }
      expect([...embedded.slice((after[after.length - 1]?.chunkStart ?? 0) + 12)]).toEqual([
        ...TRAILING,
      ]);

      const reopened = openCardPng(embedded);
      assert(!('reason' in reopened));
      expect(reopened.cardJson).toBe(payloads['ccv3']);
      expect(reopened.extraCardJson).toEqual({ chara: payloads['chara'] });
      const fresh = JSON.parse(reopened.cardJson) as {
        data: { character_book: { entries: { content: string }[] } };
      };
      expect(fresh.data.character_book.entries[0]?.content).toBe('edited everywhere');
    });
  });
});
