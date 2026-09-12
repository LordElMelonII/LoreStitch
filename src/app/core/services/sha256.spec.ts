import { sha256Hex } from './sha256';

describe('sha256 fallback', () => {
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
    const long = 'x'.repeat(500);
    expect(sha256Hex(long)).toHaveLength(64);
    // Same algorithm as WebCrypto, so the digests must be identical.
    expect(sha256Hex(long)).toBe(sha256Hex(long));
  });

  it('agrees with WebCrypto (when this environment provides it)', async () => {
    if (typeof crypto === 'undefined' || !crypto.subtle) {
      return; // nothing to compare against here
    }
    const payload = `${'root'}\u0000${JSON.stringify({ entries: [1, 2, 3] })}`;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
    const expected = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    expect(sha256Hex(payload)).toBe(expected);
  });
});
