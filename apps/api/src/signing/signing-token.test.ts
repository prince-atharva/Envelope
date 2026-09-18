import { SIGNING_TOKEN_PATTERN } from '@envelope/shared';
import { describe, expect, it } from 'vitest';
import { hashSigningToken, mintSigningToken, signingUrl, tokenRef } from './signing-token';

const SECRET = 'unit-test-signing-secret-0123456789abcdef';

describe('signing tokens', () => {
  it('mints 256 random bits as lower-case hex, stored only as their HMAC', () => {
    const { rawToken, tokenHash } = mintSigningToken(SECRET);
    expect(rawToken).toMatch(SIGNING_TOKEN_PATTERN);
    expect(tokenHash).toBe(hashSigningToken(SECRET, rawToken));
    expect(tokenHash).not.toContain(rawToken);
  });

  it('never mints the same token twice', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => mintSigningToken(SECRET).rawToken));
    expect(tokens.size).toBe(200);
  });

  it('keys the hash with the secret, so a database dump alone cannot test guesses', () => {
    const raw = 'a'.repeat(64);
    expect(hashSigningToken(SECRET, raw)).not.toBe(hashSigningToken(`${SECRET}x`, raw));
  });

  it('logs only a short prefix of the hash', () => {
    const { rawToken, tokenHash } = mintSigningToken(SECRET);
    const ref = tokenRef(tokenHash);
    expect(ref).toHaveLength(8);
    expect(rawToken).not.toContain(ref);
  });

  it('builds the link from the web app URL', () => {
    expect(signingUrl('https://app.example.com/', 'f'.repeat(64))).toBe(
      `https://app.example.com/sign/${'f'.repeat(64)}`,
    );
  });
});
