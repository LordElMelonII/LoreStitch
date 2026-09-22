/**
 * Character-card model + PNG codec — the boundary where SillyTavern character
 * cards (V2/V3 JSON payloads embedded in PNG text chunks, or plain card JSON
 * files) meet the LoreStitch data layer (plan 15 §3.1).
 *
 * House notes:
 * - **Losslessness**: the codec only rewrites chunks it is told to re-embed;
 *   every other byte — foreign chunks, all IDATs, trailing bytes after IEND —
 *   stays byte-identical in place, and the CRCs of untouched chunks are
 *   preserved verbatim. At the JSON level only `data.character_book` is
 *   swapped; unknown card fields (and their key order) survive
 *   open→embed verbatim.
 * - **Book conversion**: the embed side runs the updated book through
 *   `toSpecCompliantBook` (`lorebook.model.ts`) — the same conversion the
 *   Character Book JSON export uses, one path, not a new one. Vendor
 *   card/book objects are never normalized to fit LoreStitch at this
 *   boundary, and entry ids present in the book are vendor data that flow
 *   back through verbatim (they were assigned by `normalizeImportedBook` at
 *   import; the boundary never invents ids). Verified against the V3
 *   fixture (`example_card/example_card.json`): its `character_book` uses
 *   the V2-style field names plus `name` (never `order`/`use_regex`), so a
 *   single shared conversion serves both the `chara` (V2 shape) and `ccv3`
 *   (V3 shape) chunks; no V3-specific entry mapping is needed here.
 * - **SillyTavern ground truth**: this module implements card behavior
 *   against the vendored snapshot (`sillytaver-world-info-doc/`) and the
 *   verified fixture profile — a SillyTavern update requires re-reading the
 *   snapshot before trusting these rules (house losslessness note).
 *
 * All byte work goes through `DataView`/`Uint8Array` (uint32 math stays
 * masked with `>>>`). Functions are total: the import path never throws —
 * every failure is a `CardError` result-union member with a humanized
 * message. Bare module: no DOM, no Angular, no RxJS.
 */

import { isJsonObject, toSpecCompliantBook, type CharacterBook } from './lorebook.model';

// ============================================================================
// Card model
// ============================================================================

/** Card spec versions the codec recognizes (both ride the same JSON shape). */
export type CardSpec = 'chara_card_v2' | 'chara_card_v3';

/** PNG text-chunk keywords that carry a card payload (base64 of card JSON). */
export type CardChunkKeyword = 'chara' | 'ccv3';

/** True when `value` is one of the two card spec strings. */
export function isCardSpec(value: unknown): value is CardSpec {
  return value === 'chara_card_v2' || value === 'chara_card_v3';
}

/** True when `value` is one of the two card-carrying chunk keywords. */
export function isCardChunkKeyword(value: unknown): value is CardChunkKeyword {
  return value === 'chara' || value === 'ccv3';
}

/**
 * Non-fatal open finding, surfaced on `OpenedCard.warnings` — the card
 * opened, but the caller should tell the user about it.
 */
export interface CardWarning {
  readonly reason: 'multiple-card-chunks' | 'truncated-png';
  readonly message: string;
  /** Set for `multiple-card-chunks`: the duplicated keyword. */
  readonly keyword?: CardChunkKeyword;
}

export type CardErrorReason =
  | 'not-a-png'
  | 'no-card-chunk'
  | 'no-iend-chunk'
  | 'bad-chunk-crc'
  | 'bad-base64'
  | 'card-json-invalid'
  | 'not-a-card'
  | 'card-without-book'
  | 'compressed-card-chunk'
  | 'stale-card-chunk';

/**
 * Open/embed failure. Discriminate an `OpenedCard | CardError` result with
 * `'reason' in result` — `OpenedCard` carries no top-level `reason` field.
 * `message` is humanized for the import-failure snackbar; `keyword` is set
 * for errors about one specific card chunk.
 */
export interface CardError {
  readonly reason: CardErrorReason;
  readonly message: string;
  readonly keyword?: CardChunkKeyword;
}

/**
 * Result of a successful card open (PNG or JSON source). `cardJson` is the
 * card's JSON text **as decoded from the payload — verbatim, never
 * re-serialized** — so `JSON.parse(cardJson)` equals what the writer wrote;
 * on export only `data.character_book` is swapped (see
 * `embedBookIntoCardJson`) and the re-embedded payload is minified.
 */
export interface OpenedCard {
  /** Spec read from the payload's `spec` field; keyword-derived if absent. */
  readonly spec: CardSpec;
  /** Full card JSON text as stored (PNG: base64-decoded; JSON: file text). */
  readonly cardJson: string;
  /** The embedded book, run through the normal import pipeline afterwards. */
  readonly rawBook: unknown;
  /** For PNG sources: the original bytes (kept as the export shell). */
  readonly pngBytes?: Uint8Array;
  /** The chunk keyword the preferred payload came from (export reuses it). */
  readonly pngKeyword?: CardChunkKeyword;
  /**
   * Dual-chunk cards carry their own independent full card JSON per keyword;
   * the payload of the *other* readable card chunk is remembered here so
   * export can re-embed both (plan 15 §3.1 — every card-carrying chunk the
   * source had gets the updated book, none is left stale).
   */
  readonly extraCardJson?: Partial<Record<CardChunkKeyword, string>>;
  /** Open findings worth surfacing (absent when none). */
  readonly warnings?: readonly CardWarning[];
}

// ============================================================================
// Byte helpers
// ============================================================================

/** A `DataView` over the exact byte range of a `Uint8Array` view. */
function dataViewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Pure PNG CRC-32 (reversed polynomial 0xEDB88320) — the checksum that
 * chunk verification and re-embedding rely on. Table built once at module
 * init.
 */
const CRC32_TABLE: DataView = (() => {
  const bytes = new Uint8Array(256 * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    view.setUint32(i * 4, value >>> 0, false);
  }
  return view;
})();

/** Computes the CRC-32 checksum of `bytes` (uint32, masked). */
export function crc32(bytes: Uint8Array): number {
  const view = dataViewOf(bytes);
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.byteLength; i++) {
    const tableIndex = (crc ^ view.getUint8(i)) & 0xff;
    crc = (crc >>> 8) ^ CRC32_TABLE.getUint32(tableIndex * 4, false);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard-alphabet base64 lookup table (`0xff` marks non-alphabet bytes). */
const BASE64_DECODE_TABLE: DataView = (() => {
  const bytes = new Uint8Array(256);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < 256; i++) {
    view.setUint8(i, 0xff);
  }
  for (let i = 0; i < BASE64_ALPHABET.length; i++) {
    view.setUint8(BASE64_ALPHABET.charCodeAt(i), i);
  }
  return view;
})();

const isBase64Whitespace = (code: number): boolean =>
  code === 0x09 || code === 0x0a || code === 0x0d || code === 0x20;

/**
 * Decodes a standard-alphabet base64 string into bytes (forgiving on
 * whitespace and missing padding, like the WHATWG forgiving-base64 rules;
 * data after padding and a dangling single sextet are errors). Returns null
 * for invalid input — callers turn that into a result, never a throw.
 */
export function base64DecodeBytes(text: string): Uint8Array | null {
  let canonical = 0;
  let sawPadding = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x3d) {
      // '=': padding — only padding/whitespace may follow.
      sawPadding = true;
    } else if (isBase64Whitespace(code)) {
      // Whitespace is ignored anywhere.
    } else if (sawPadding) {
      return null; // Data after padding.
    } else if (BASE64_DECODE_TABLE.getUint8(code) === 0xff) {
      return null; // Non-alphabet character.
    } else {
      canonical++;
    }
  }
  if (canonical % 4 === 1) {
    return null; // Dangling sextet.
  }
  const out = new Uint8Array(Math.floor((canonical * 6) / 8));
  const view = new DataView(out.buffer);
  let accumulator = 0;
  let bits = 0;
  let written = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x3d) {
      break; // Padding only ever trails (pass 1 validated what follows).
    }
    if (isBase64Whitespace(code)) {
      continue;
    }
    accumulator = ((accumulator << 6) | BASE64_DECODE_TABLE.getUint8(code)) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      view.setUint8(written, (accumulator >>> bits) & 0xff);
      written++;
    }
  }
  return out;
}

/** Encodes bytes as standard-alphabet base64 (with padding). */
export function base64EncodeBytes(bytes: Uint8Array): string {
  const view = dataViewOf(bytes);
  const length = bytes.byteLength;
  const triplets = Math.floor(length / 3);
  const remainder = length - triplets * 3;
  const parts: string[] = [];
  for (let i = 0; i + 3 <= length; i += 3) {
    const n =
      (view.getUint8(i) << 16) | (view.getUint8(i + 1) << 8) | view.getUint8(i + 2);
    parts.push(
      BASE64_ALPHABET.charAt((n >>> 18) & 63) +
        BASE64_ALPHABET.charAt((n >>> 12) & 63) +
        BASE64_ALPHABET.charAt((n >>> 6) & 63) +
        BASE64_ALPHABET.charAt(n & 63),
    );
  }
  if (remainder === 1) {
    const n = view.getUint8(triplets * 3) << 16;
    parts.push(BASE64_ALPHABET.charAt((n >>> 18) & 63) + BASE64_ALPHABET.charAt((n >>> 12) & 63) + '==');
  } else if (remainder === 2) {
    const n = (view.getUint8(triplets * 3) << 16) | (view.getUint8(triplets * 3 + 1) << 8);
    parts.push(
      BASE64_ALPHABET.charAt((n >>> 18) & 63) +
        BASE64_ALPHABET.charAt((n >>> 12) & 63) +
        BASE64_ALPHABET.charAt((n >>> 6) & 63) +
        '=',
    );
  }
  return parts.join('');
}

/**
 * UTF-8 decode: well-formed sequences decode exactly; an invalid byte,
 * overlong/surrogate/out-of-range encoding, or truncated sequence yields
 * U+FFFD (matches `TextDecoder`'s non-fatal mode — conformant card payloads
 * are valid UTF-8 and never exercise the fallbacks).
 */
function utf8Decode(bytes: Uint8Array): string {
  const view = dataViewOf(bytes);
  const length = bytes.byteLength;
  const parts: string[] = [];
  let chunk: number[] = [];
  const flush = (): void => {
    if (chunk.length > 0) {
      parts.push(String.fromCharCode(...chunk));
      chunk = [];
    }
  };
  let i = 0;
  while (i < length) {
    const b0 = view.getUint8(i);
    let code = b0;
    let sequenceLength = 1;
    if (b0 < 0x80) {
      // ASCII: code stays b0.
    } else if (b0 < 0xc0 || b0 > 0xf4) {
      code = 0xfffd; // Continuation byte or invalid lead.
    } else if (b0 < 0xe0) {
      sequenceLength = 2;
      code = decodeUtf8Sequence(view, i, b0 & 0x1f, 2, 0x80);
    } else if (b0 < 0xf0) {
      sequenceLength = 3;
      code = decodeUtf8Sequence(view, i, b0 & 0x0f, 3, 0x800);
    } else {
      sequenceLength = 4;
      code = decodeUtf8Sequence(view, i, b0 & 0x07, 4, 0x10000);
    }
    if (code <= 0xffff) {
      chunk.push(code);
    } else {
      code -= 0x10000;
      chunk.push(0xd800 + (code >>> 10), 0xdc00 + (code & 0x3ff));
    }
    if (chunk.length >= 4096) {
      flush();
    }
    i += sequenceLength;
  }
  flush();
  return parts.join('');
}

/**
 * Decodes one multi-byte UTF-8 sequence starting at `start` (the lead's low
 * bits already in `lowBits`). Any invalid continuation, overlong,
 * surrogate-range or out-of-range encoding — including a sequence truncated
 * by the end of input — collapses to U+FFFD.
 */
function decodeUtf8Sequence(
  view: DataView,
  start: number,
  lowBits: number,
  sequenceLength: number,
  minimum: number,
): number {
  let code = lowBits;
  const available = view.byteLength - start;
  for (let offset = 1; offset < sequenceLength; offset++) {
    const byte = offset < available ? view.getUint8(start + offset) : 0xff;
    if (byte < 0x80 || byte >= 0xc0) {
      return 0xfffd;
    }
    code = (code << 6) | (byte & 0x3f);
  }
  if (code < minimum || (code >= 0xd800 && code <= 0xdfff) || code > 0x10ffff) {
    return 0xfffd;
  }
  return code;
}

/**
 * UTF-8 encodes a string (unpaired surrogates become U+FFFD, matching
 * `TextEncoder`).
 */
function utf8Encode(text: string): Uint8Array {
  // Pass 1: exact byte count (surrogate pairs count once; unpaired → U+FFFD).
  let byteCount = 0;
  let i = 0;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        byteCount += 4;
        i += 2;
        continue;
      }
    }
    byteCount += code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
    i++;
  }
  const out = new Uint8Array(byteCount);
  const view = new DataView(out.buffer);
  let written = 0;
  i = 0;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    let codePoint: number;
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i += 2;
      } else {
        codePoint = 0xfffd;
        i += 1;
      }
    } else if (code >= 0xd800 && code <= 0xdfff) {
      codePoint = 0xfffd; // Unpaired surrogate.
      i += 1;
    } else {
      codePoint = code;
      i += 1;
    }
    if (codePoint < 0x80) {
      view.setUint8(written, codePoint);
      written += 1;
    } else if (codePoint < 0x800) {
      view.setUint8(written, 0xc0 | (codePoint >>> 6));
      view.setUint8(written + 1, 0x80 | (codePoint & 0x3f));
      written += 2;
    } else if (codePoint < 0x10000) {
      view.setUint8(written, 0xe0 | (codePoint >>> 12));
      view.setUint8(written + 1, 0x80 | ((codePoint >>> 6) & 0x3f));
      view.setUint8(written + 2, 0x80 | (codePoint & 0x3f));
      written += 3;
    } else {
      view.setUint8(written, 0xf0 | (codePoint >>> 18));
      view.setUint8(written + 1, 0x80 | ((codePoint >>> 12) & 0x3f));
      view.setUint8(written + 2, 0x80 | ((codePoint >>> 6) & 0x3f));
      view.setUint8(written + 3, 0x80 | (codePoint & 0x3f));
      written += 4;
    }
  }
  return out;
}

/**
 * Encodes a card JSON text into the exact payload string a card tEXt chunk
 * carries: standard-alphabet base64 of the text's UTF-8 bytes.
 */
export function encodeCardPayload(cardJson: string): string {
  return base64EncodeBytes(utf8Encode(cardJson));
}

// ============================================================================
// PNG chunk walk
// ============================================================================

const PNG_SIGNATURE_LENGTH = 8;

const PNG_SIGNATURE: DataView = (() => {
  const view = new DataView(new Uint8Array(PNG_SIGNATURE_LENGTH).buffer);
  view.setUint32(0, 0x89504e47, false); // 0x89 "PNG"
  view.setUint32(4, 0x0d0a1a0a, false); // "\r\n" 0x1a "\n"
  return view;
})();

function hasPngSignature(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PNG_SIGNATURE_LENGTH) {
    return false;
  }
  const view = dataViewOf(bytes);
  for (let i = 0; i < PNG_SIGNATURE_LENGTH; i++) {
    if (view.getUint8(i) !== PNG_SIGNATURE.getUint8(i)) {
      return false;
    }
  }
  return true;
}

interface PngChunk {
  /** Chunk type as 4 ASCII characters (e.g. `tEXt`). */
  readonly type: string;
  /** Offset of the chunk's 4-byte length field. */
  readonly chunkStart: number;
  /** Offset of the chunk's data (== `chunkStart + 8`). */
  readonly dataStart: number;
  readonly dataLength: number;
  /** First offset after the chunk's CRC (== `chunkStart + 12 + dataLength`). */
  readonly chunkEnd: number;
}

interface PngWalk {
  /** Chunks seen before IEND (IEND itself is excluded, recorded below). */
  readonly chunks: readonly PngChunk[];
  /** Offset of the IEND chunk, or -1 when the walk ended without one. */
  readonly iendStart: number;
}

/**
 * Walks `[len, type, data, crc]` chunks from offset 8. Stops at IEND —
 * bytes after it are never inspected. A chunk whose declared length runs
 * past EOF ends the walk early (`iendStart` stays -1; open surfaces a
 * truncation warning, embed refuses inserts).
 */
function walkPngChunks(view: DataView): PngWalk {
  const chunks: PngChunk[] = [];
  let position = PNG_SIGNATURE_LENGTH;
  while (position + 12 <= view.byteLength) {
    const dataLength = view.getUint32(position, false);
    const chunkEnd = position + 12 + dataLength;
    if (chunkEnd > view.byteLength) {
      return { chunks, iendStart: -1 };
    }
    let type = '';
    for (let i = 0; i < 4; i++) {
      type += String.fromCharCode(view.getUint8(position + 4 + i));
    }
    if (type === 'IEND') {
      return { chunks, iendStart: position };
    }
    chunks.push({
      type,
      chunkStart: position,
      dataStart: position + 8,
      dataLength,
      chunkEnd,
    });
    position = chunkEnd;
  }
  return { chunks, iendStart: -1 };
}

/** Latin-1 string of a byte range (tEXt payload semantics, byte-per-unit). */
function latin1String(view: DataView, start: number, end: number): string {
  let text = '';
  for (let i = start; i < end; i++) {
    text += String.fromCharCode(view.getUint8(i));
  }
  return text;
}

// ============================================================================
// Card-chunk classification
// ============================================================================

/** One readable card-carrying text chunk and its decoded payload string. */
interface CardTextChunkRef {
  readonly chunk: PngChunk;
  readonly keyword: CardChunkKeyword;
  /** tEXt: Latin-1 text; uncompressed iTXt: UTF-8 text. Base64 of card JSON. */
  readonly payload: string;
}

interface TextChunkScan {
  /** First readable card chunk per keyword (first wins; duplicates warn). */
  readonly readable: Partial<Record<CardChunkKeyword, CardTextChunkRef>>;
  /** How many readable card chunks each keyword has (duplicates detect). */
  readonly counts: Record<CardChunkKeyword, number>;
  /** Card-keyword chunks the codec cannot read (zTXt/compressed/mis-shaped). */
  readonly unreadableCount: number;
}

/**
 * Classifies every text chunk of a walked PNG. Unknown/foreign chunks are
 * opaque — located, never parsed beyond the walk, never verified.
 */
function scanTextChunks(view: DataView, pngBytes: Uint8Array, chunks: readonly PngChunk[]): TextChunkScan {
  const readable: Partial<Record<CardChunkKeyword, CardTextChunkRef>> = {};
  const counts: Record<CardChunkKeyword, number> = { chara: 0, ccv3: 0 };
  let unreadableCount = 0;
  for (const chunk of chunks) {
    const classification = classifyTextChunk(view, pngBytes, chunk);
    if (classification.kind === 'opaque') {
      continue;
    }
    if (classification.kind === 'unreadable') {
      unreadableCount++;
      continue;
    }
    counts[classification.ref.keyword]++;
    const first = readable[classification.ref.keyword];
    if (!first) {
      readable[classification.ref.keyword] = classification.ref;
    }
  }
  return { readable, counts, unreadableCount };
}

type TextChunkClassification =
  | { kind: 'opaque' }
  | { kind: 'unreadable' }
  | { kind: 'readable'; ref: CardTextChunkRef };

function classifyTextChunk(
  view: DataView,
  pngBytes: Uint8Array,
  chunk: PngChunk,
): TextChunkClassification {
  if (chunk.type !== 'tEXt' && chunk.type !== 'iTXt' && chunk.type !== 'zTXt') {
    return { kind: 'opaque' };
  }
  const dataEnd = chunk.dataStart + chunk.dataLength;
  let nulPosition = -1;
  for (let i = chunk.dataStart; i < dataEnd; i++) {
    if (view.getUint8(i) === 0) {
      nulPosition = i;
      break;
    }
  }
  if (nulPosition < 0) {
    return { kind: 'opaque' }; // No keyword separator: never a card chunk.
  }
  const keyword = latin1String(view, chunk.dataStart, nulPosition);
  if (keyword !== 'chara' && keyword !== 'ccv3') {
    return { kind: 'opaque' };
  }
  if (chunk.type === 'zTXt') {
    return { kind: 'unreadable' }; // zlib-compressed; out of codec scope.
  }
  if (chunk.type === 'iTXt') {
    // iTXt data: keyword NUL compression-flag compression-method language NUL
    // translated NUL text(Utf8). Only flag 0 (uncompressed) is readable.
    const flagPosition = nulPosition + 1;
    if (flagPosition >= dataEnd || view.getUint8(flagPosition) !== 0) {
      return { kind: 'unreadable' }; // Compressed or mis-shaped.
    }
    let textStart = -1;
    let nulsSeen = 0;
    for (let i = flagPosition + 2; i < dataEnd; i++) {
      if (view.getUint8(i) === 0) {
        nulsSeen++;
        if (nulsSeen === 2) {
          textStart = i + 1;
          break;
        }
      }
    }
    if (textStart < 0) {
      return { kind: 'unreadable' }; // Mis-shaped: missing language/translated NULs.
    }
    const payload = utf8Decode(pngBytes.subarray(textStart, dataEnd));
    return { kind: 'readable', ref: { chunk, keyword, payload } };
  }
  const payload = latin1String(view, nulPosition + 1, dataEnd);
  return { kind: 'readable', ref: { chunk, keyword, payload } };
}

// ============================================================================
// Open
// ============================================================================

interface OpenedCardFields {
  readonly spec: CardSpec;
  readonly cardJson: string;
  readonly rawBook: unknown;
}

function cardError(reason: CardErrorReason, message: string, keyword?: CardChunkKeyword): CardError {
  if (keyword === undefined) {
    return { reason, message };
  }
  return { reason, message, keyword };
}

/** Spec fallback for a payload without a recognizable `spec` field. */
function specForKeyword(keyword: CardChunkKeyword): CardSpec {
  return keyword === 'ccv3' ? 'chara_card_v3' : 'chara_card_v2';
}

/**
 * Validates a decoded card payload text (shared by the JSON path and the
 * PNG path): `data.character_book` must exist (V1 cards and book-less
 * V2/V3 cards have nothing to edit → `card-without-book`). A wrong-typed
 * book still opens — the normal import pipeline gates its shape downstream.
 */
function openCardPayloadText(payloadText: string, fallbackSpec: CardSpec): OpenedCardFields | CardError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadText);
  } catch {
    return cardError('card-json-invalid', 'The card payload is not valid JSON.');
  }
  if (!isJsonObject(parsed)) {
    return cardError('card-json-invalid', 'The card payload is not a JSON object.');
  }
  const spec = isCardSpec(parsed['spec']) ? parsed['spec'] : fallbackSpec;
  const data = parsed['data'];
  if (!isJsonObject(data)) {
    return cardError('card-without-book', 'The card carries no data object, so there is no embedded lorebook.');
  }
  const book = data['character_book'];
  if (book === undefined || book === null) {
    return cardError('card-without-book', 'The card carries no character_book to import.');
  }
  return { spec, cardJson: payloadText, rawBook: book };
}

/**
 * Full decode of one card chunk: base64 payload → bytes → UTF-8 card JSON
 * text → validated card fields. A non-base64 payload is `bad-base64`.
 */
function attemptCardChunk(ref: CardTextChunkRef): OpenedCardFields | CardError {
  const decodedBytes = base64DecodeBytes(ref.payload);
  if (!decodedBytes) {
    return cardError('bad-base64', `The '${ref.keyword}' card chunk payload is not valid base64.`, ref.keyword);
  }
  return openCardPayloadText(utf8Decode(decodedBytes), specForKeyword(ref.keyword));
}

function composeOpened(
  fields: OpenedCardFields,
  pngBytes: Uint8Array,
  pngKeyword: CardChunkKeyword,
  otherPayload: string | undefined,
  warnings: readonly CardWarning[],
): OpenedCard {
  const otherKeyword = pngKeyword === 'ccv3' ? 'chara' : 'ccv3';
  return {
    spec: fields.spec,
    cardJson: fields.cardJson,
    rawBook: fields.rawBook,
    pngBytes,
    pngKeyword,
    ...(otherPayload !== undefined ? { extraCardJson: { [otherKeyword]: otherPayload } } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/**
 * Open a card PNG: signature check, chunk walk, `chara`/`ccv3` text-chunk
 * extraction (payloads are standard-alphabet base64 of a card JSON).
 *
 * - Preference: `ccv3` first, then `chara`; first chunk per keyword wins.
 * - A same-keyword duplicate is a warning (`multiple-card-chunks`), and
 *   export re-embeds into that first position only.
 * - An uncompressed iTXt card chunk is tolerated (robustness against
 *   non-conformant writers); a zTXt or compressed iTXt card chunk is never
 *   read — if it is the only card chunk the error names that limitation.
 * - The CRC of every card chunk whose payload is read is verified
 *   (`bad-chunk-crc`); foreign/untouched chunks are never verified.
 */
export function openCardPng(bytes: Uint8Array): OpenedCard | CardError {
  if (!hasPngSignature(bytes)) {
    return cardError('not-a-png', 'The bytes are not a PNG file (signature mismatch).');
  }
  const view = dataViewOf(bytes);
  const walk = walkPngChunks(view);
  const warnings: CardWarning[] = [];
  if (walk.iendStart < 0) {
    warnings.push({
      reason: 'truncated-png',
      message: 'The PNG ends without an IEND chunk (truncated); card data may be incomplete.',
    });
  }
  const scan = scanTextChunks(view, bytes, walk.chunks);
  for (const keyword of ['chara', 'ccv3'] as const) {
    const ref = scan.readable[keyword];
    if (!ref) {
      continue;
    }
    const stored = view.getUint32(ref.chunk.chunkEnd - 4, false);
    const computed = crc32(bytes.subarray(ref.chunk.chunkStart + 4, ref.chunk.chunkEnd - 4));
    if (stored !== computed) {
      return cardError(
        'bad-chunk-crc',
        `The '${keyword}' card chunk fails its PNG checksum.`,
        keyword,
      );
    }
    if (scan.counts[keyword] > 1) {
      warnings.push({
        reason: 'multiple-card-chunks',
        keyword,
        message: `Multiple '${keyword}' card chunks in the PNG — the first one wins.`,
      });
    }
  }
  const preferred = scan.readable['ccv3'] ?? scan.readable['chara'];
  if (!preferred) {
    if (scan.unreadableCount > 0) {
      return cardError(
        'compressed-card-chunk',
        'The only card chunk(s) in this PNG are compressed (zTXt) or mis-shaped, which LoreStitch cannot read. Re-save the card as an uncompressed PNG.',
      );
    }
    return cardError('no-card-chunk', 'No embedded character card found in the PNG.');
  }
  const preferredKeyword = preferred.keyword;
  const otherKeyword = preferredKeyword === 'ccv3' ? 'chara' : 'ccv3';
  const otherRef = scan.readable[otherKeyword];
  const primary = attemptCardChunk(preferred);
  if ('reason' in primary) {
    // The preferred payload is corrupt — fall back to the other card chunk
    // (e.g. a broken ccv3 beside a valid chara); when both fail, the
    // preferred spec's error wins. The failed chunk's payload cannot be
    // remembered as JSON, so `extraCardJson` omits it and a later export
    // refuses with `stale-card-chunk` rather than shipping a stale book.
    if (!otherRef) {
      return primary;
    }
    const fallback = attemptCardChunk(otherRef);
    if ('reason' in fallback) {
      return primary;
    }
    return composeOpened(fallback, bytes, otherKeyword, undefined, warnings);
  }
  // The other chunk's payload is remembered only when it decodes too; a
  // broken extra leaves no `extraCardJson` entry (export then refuses with
  // `stale-card-chunk` for that keyword instead of shipping stale bytes).
  const extra = otherRef ? attemptCardChunk(otherRef) : null;
  const extraJson = extra && !('reason' in extra) ? extra.cardJson : undefined;
  return composeOpened(primary, bytes, preferredKeyword, extraJson, warnings);
}

/**
 * Open a card JSON (`spec` + `data.character_book`; V1 cards and cards
 * without an embedded book → `card-without-book`). Not-JSON and non-object
 * payloads are `not-a-card` — the import pipeline only routes here after
 * the lorebook/archive sniffs failed.
 */
export function openCardJson(text: string): OpenedCard | CardError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return cardError('not-a-card', 'The file is not valid JSON, so it is not a character card.');
  }
  if (!isJsonObject(parsed)) {
    return cardError('not-a-card', 'The JSON payload is not a character card object.');
  }
  const fields = openCardPayloadText(text, 'chara_card_v2');
  if ('reason' in fields) {
    return fields;
  }
  return { spec: fields.spec, cardJson: fields.cardJson, rawBook: fields.rawBook };
}

// ============================================================================
// Embed (export side)
// ============================================================================

/** Structural subset of the card shell that remembers PNG chunk payloads. */
export interface PngCardShellSubset {
  /** The preferred card JSON payload text (updated in place). */
  readonly cardJson: string;
  /** The keyword of the chunk `cardJson` came from. */
  readonly pngKeyword: CardChunkKeyword;
  /** Per-keyword payloads of the other card chunks (dual-chunk cards). */
  readonly extraCardJson?: Partial<Record<CardChunkKeyword, string>>;
}

/** Per-keyword updated card JSON texts, ready for `embedCardPayloads`. */
export interface CardChunkPayloads {
  readonly chara?: string;
  readonly ccv3?: string;
}

/**
 * Embeds the updated book into every card payload a PNG-sourced shell
 * remembers: the preferred payload (`cardJson`/`pngKeyword`) plus each
 * `extraCardJson` entry. One shared conversion (`toSpecCompliantBook`)
 * serves both the V2 (`chara`) and V3 (`ccv3`) chunk shapes — see the
 * module doc comment for the fixture-verified delta.
 */
export function updatedCardPayloads(
  shell: PngCardShellSubset,
  book: CharacterBook,
): CardChunkPayloads | CardError {
  const payloads: { chara?: string; ccv3?: string } = {};
  const primary = embedBookIntoCardJson(shell.cardJson, book);
  // `embedBookIntoCardJson` returns `string | CardError` — discriminate with
  // typeof, not `'reason' in …` (the `in` operator throws on string
  // primitives).
  if (typeof primary !== 'string') {
    return primary;
  }
  payloads[shell.pngKeyword] = primary;
  for (const keyword of ['chara', 'ccv3'] as const) {
    const extra = shell.extraCardJson?.[keyword];
    if (extra === undefined) {
      continue;
    }
    const updated = embedBookIntoCardJson(extra, book);
    if (typeof updated !== 'string') {
      return updated;
    }
    payloads[keyword] = updated;
  }
  return payloads;
}

/**
 * Re-embeds per-keyword card JSON payloads into a PNG shell: every
 * card-carrying chunk the source had is replaced in place at its original
 * position (length change allowed; the rewritten chunk gets a fresh length
 * field, fresh CRC, and always tEXt encoding — an iTXt card chunk is
 * normalized to tEXt on rewrite); keywords the source lacks are inserted as
 * fresh tEXt chunks immediately before IEND. Every other chunk — including
 * all IDATs, foreign chunks, unreadable (zTXt) card chunks and any trailing
 * bytes after IEND — stays byte-identical, and the CRCs of untouched chunks
 * are preserved verbatim. A same-keyword duplicate chunk is never rewritten
 * (export targets the first position only), so malformed files keep their
 * shape. Caller-owned bytes are never mutated; a fresh array is returned.
 */
export function embedCardPayloads(
  pngBytes: Uint8Array,
  payloads: CardChunkPayloads,
): Uint8Array | CardError {
  if (!hasPngSignature(pngBytes)) {
    return cardError('not-a-png', 'The stored card image is not a PNG file (signature mismatch).');
  }
  const view = dataViewOf(pngBytes);
  const walk = walkPngChunks(view);
  const scan = scanTextChunks(view, pngBytes, walk.chunks);
  // A readable card chunk without a payload would be left holding the book
  // as of import — refuse instead of shipping a stale book.
  for (const keyword of ['chara', 'ccv3'] as const) {
    if (scan.readable[keyword] && payloads[keyword] === undefined) {
      return cardError(
        'stale-card-chunk',
        `The PNG carries a '${keyword}' card chunk but no updated card JSON was provided for it — it would keep the stale book.`,
        keyword,
      );
    }
  }
  interface ReplaceOp {
    readonly start: number;
    readonly end: number;
    readonly bytes: Uint8Array;
  }
  const ops: ReplaceOp[] = [];
  // Insert order: ccv3 before chara, so a re-import of the embedded result
  // finds the preferred keyword first.
  for (const keyword of ['ccv3', 'chara'] as const) {
    const payload = payloads[keyword];
    if (payload === undefined) {
      continue;
    }
    const target = scan.readable[keyword];
    const chunkBytes = buildCardTextChunk(keyword, payload);
    if (target) {
      ops.push({ start: target.chunk.chunkStart, end: target.chunk.chunkEnd, bytes: chunkBytes });
    } else {
      if (walk.iendStart < 0) {
        return cardError('no-iend-chunk', 'The PNG has no IEND chunk to insert the card chunk before.');
      }
      ops.push({ start: walk.iendStart, end: walk.iendStart, bytes: chunkBytes });
    }
  }
  if (ops.length === 0) {
    return pngBytes.slice(); // Nothing requested — an untouched copy.
  }
  ops.sort((a, b) => a.start - b.start); // Stable: same-start inserts keep order.
  const total =
    pngBytes.byteLength +
    ops.reduce((sum, op) => sum + (op.bytes.byteLength - (op.end - op.start)), 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  let writePosition = 0;
  for (const op of ops) {
    out.set(pngBytes.subarray(cursor, op.start), writePosition);
    writePosition += op.start - cursor;
    out.set(op.bytes, writePosition);
    writePosition += op.bytes.byteLength;
    cursor = op.end;
  }
  out.set(pngBytes.subarray(cursor), writePosition); // Tail incl. bytes after IEND.
  return out;
}

/**
 * Swaps `data.character_book` in a card JSON text for the spec-clean
 * conversion of `book` — the same conversion the Character Book JSON export
 * uses (`toSpecCompliantBook`). Everything else survives verbatim: unknown
 * card fields keep their values and key order (the swap only re-assigns an
 * existing key). Entry ids present in `book` were assigned by the import
 * pipeline and flow back as vendor data — none are invented here. The
 * result is minified JSON in the original key order.
 */
export function embedBookIntoCardJson(cardJson: string, book: CharacterBook): string | CardError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(cardJson);
  } catch {
    return cardError('card-json-invalid', 'The stored card payload is not valid JSON.');
  }
  if (!isJsonObject(parsed)) {
    return cardError('card-json-invalid', 'The stored card payload is not a JSON object.');
  }
  const data = parsed['data'];
  if (!isJsonObject(data)) {
    return cardError('card-without-book', 'The stored card payload has no data object to swap the book into.');
  }
  if (data['character_book'] === undefined || data['character_book'] === null) {
    return cardError('card-without-book', 'The stored card payload has no character_book to swap.');
  }
  data['character_book'] = toSpecCompliantBook(book);
  return JSON.stringify(parsed);
}

/** Builds a complete tEXt chunk for a card keyword and card JSON text. */
function buildCardTextChunk(keyword: CardChunkKeyword, cardJson: string): Uint8Array {
  const payload = encodeCardPayload(cardJson);
  const payloadBytes = new Uint8Array(payload.length);
  const payloadView = new DataView(payloadBytes.buffer);
  for (let i = 0; i < payload.length; i++) {
    payloadView.setUint8(i, payload.charCodeAt(i));
  }
  const keywordLength = keyword === 'ccv3' ? 4 : 5;
  const dataLength = keywordLength + 1 + payloadBytes.byteLength;
  const chunk = new Uint8Array(12 + dataLength);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, dataLength, false);
  for (let i = 0; i < 4; i++) {
    view.setUint8(4 + i, 'tEXt'.charCodeAt(i));
  }
  for (let i = 0; i < keywordLength; i++) {
    view.setUint8(8 + i, keyword.charCodeAt(i));
  }
  view.setUint8(8 + keywordLength, 0);
  chunk.set(payloadBytes, 8 + keywordLength + 1);
  view.setUint32(8 + dataLength, crc32(chunk.subarray(4, 8 + dataLength)), false);
  return chunk;
}
