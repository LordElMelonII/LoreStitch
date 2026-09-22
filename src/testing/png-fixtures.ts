/**
 * Shared in-test PNG fixtures for the character-card specs (plan 15 §3.6: the
 * spec tree stays binary-free — every card PNG is a minimal hand-built fixture
 * whose bytes the specs fully control). Previously each spec carried a private
 * near-identical copy of these builders (`character-card.spec.ts`,
 * `import-export.service.spec.ts`, `project-actions.service.spec.ts`); like
 * `projectOf` above, they now exist exactly once here.
 *
 * Importable only from specs (`tsconfig.spec.json` includes `src/testing`).
 */
import { crc32 } from '../app/core/models/character-card';

/** The 8-byte PNG file signature. */
export const PNG_SIGNATURE: Uint8Array = Uint8Array.of(
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
);

/** One complete PNG chunk: `[len, type, data, crc]` with a valid CRC. */
export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) {
    view.setUint8(4 + i, type.charCodeAt(i));
  }
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
  return out;
}

/** Concatenates byte arrays. */
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

/** tEXt data: keyword bytes + NUL + Latin-1 payload (byte-per-unit). */
export function textChunkData(keyword: string, payloadText: string): Uint8Array {
  const out = new Uint8Array(keyword.length + 1 + payloadText.length);
  for (let i = 0; i < keyword.length; i++) {
    out[i] = keyword.charCodeAt(i);
  }
  out[keyword.length] = 0;
  for (let i = 0; i < payloadText.length; i++) {
    out[keyword.length + 1 + i] = payloadText.charCodeAt(i);
  }
  return out;
}

export interface SpecChunk {
  /** Chunk type as 4 ASCII characters (e.g. `tEXt`). */
  readonly type: string;
  /** The chunk's data bytes (keyword/payload as stored, CRC excluded). */
  readonly data: Uint8Array;
  /** Offset of the chunk's 4-byte length field. */
  readonly chunkStart: number;
}

/**
 * Spec-local chunk walk (offsets included) for byte-identity assertions.
 * Stops at IEND — matching the codec's contract that bytes after it are
 * never inspected.
 */
export function walkSpecPng(bytes: Uint8Array): SpecChunk[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: SpecChunk[] = [];
  let position = 8;
  while (position + 12 <= bytes.byteLength) {
    const length = view.getUint32(position, false);
    let type = '';
    for (let i = 0; i < 4; i++) {
      type += String.fromCharCode(view.getUint8(position + 4 + i));
    }
    chunks.push({
      type,
      data: bytes.slice(position + 8, position + 8 + length),
      chunkStart: position,
    });
    if (type === 'IEND') {
      break;
    }
    position += 12 + length;
  }
  return chunks;
}

/** Flips one byte inside `chunk`'s CRC so the checksum breaks. */
export function corruptCrcOf(bytes: Uint8Array, chunk: SpecChunk): Uint8Array {
  const corrupted = bytes.slice();
  const view = new DataView(corrupted.buffer);
  const dataLength = view.getUint32(chunk.chunkStart, false);
  const crcLast = chunk.chunkStart + 12 + dataLength - 1;
  corrupted[crcLast] = (corrupted[crcLast] ?? 0) ^ 0xff;
  return corrupted;
}
