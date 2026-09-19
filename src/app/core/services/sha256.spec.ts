import { hasSubtleCrypto, randomUuid, sha256Hex } from './sha256';

/** Hex-encodes a WebCrypto digest the way `sha256Hex` formats its output. */
async function subtleDigestHex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('sha256 fallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('matches the FIPS 180-4 test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('handles inputs spanning multiple 64-byte blocks', () => {
    // Standard NIST two-block (112-byte) test vector.
    const twoBlocks =
      'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmno' +
      'ijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu';
    expect(sha256Hex(twoBlocks)).toBe(
      'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1',
    );
  });

  it('agrees with WebCrypto', async () => {
    // No capability guard: if subtle crypto were absent, subtleDigestHex
    // throws and this test fails instead of vacuously passing.
    const payload = `${'root'}\u0000${JSON.stringify({ entries: [1, 2, 3] })}`;
    const expected = await subtleDigestHex(payload);
    expect(sha256Hex(payload)).toBe(expected);
  });

  it('agrees with WebCrypto for multi-byte UTF-8 input', async () => {
    // CJK + emoji exercise the TextEncoder path beyond ASCII.
    const payload = '上海 — 🎲 lorebook entry';
    expect(sha256Hex(payload)).toBe(await subtleDigestHex(payload));
  });

  it('produces WebCrypto-identical digests while WebCrypto is unavailable', async () => {
    // Secure-context test env: WebCrypto exists and the detector reports it.
    expect(hasSubtleCrypto()).toBe(true);
    const expected = await subtleDigestHex('abc');
    expect(expected).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

    // Simulate an insecure origin (`ng serve` over LAN http): no subtle crypto.
    vi.stubGlobal(
      'crypto',
      {
        getRandomValues: (buffer: Uint8Array<ArrayBuffer>) => crypto.getRandomValues(buffer),
      } as Crypto,
    );
    expect(hasSubtleCrypto()).toBe(false);
    // The pure-JS digest keeps commit ids stable across environments.
    expect(sha256Hex('abc')).toBe(expected);
  });

  it('returns a random v4 UUID when crypto.randomUUID is available', () => {
    const id = randomUuid();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('synthesizes a v4 UUID from getRandomValues on insecure origins', () => {
    // No randomUUID (insecure origin), but getRandomValues exists.
    let counter = 0;
    vi.stubGlobal('crypto', {
      getRandomValues: (buffer: Uint8Array) => {
        for (let i = 0; i < buffer.length; i += 1) {
          buffer[i] = counter & 0xff;
          counter += 1;
        }
        return buffer;
      },
    } as Crypto);

    // Bytes 0..15 with the version/variant bits patched in.
    expect(randomUuid()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
  });

  it('falls back to a templated UUID without any crypto at all', () => {
    vi.stubGlobal('crypto', undefined);
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // always draws 8

    // Version nibble stays 4, variant nibble (8 & 0x3) | 0x8 stays 8.
    expect(randomUuid()).toBe('88888888-8888-4888-8888-888888888888');
  });
});
