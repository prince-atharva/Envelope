import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  otpauthUri,
  totpCodeAt,
  totpStep,
  verifyTotp,
} from './totp';

// RFC 6238 appendix B: the SHA-1 secret is the ASCII string "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('base32', () => {
  it('round-trips and matches the RFC 4648 vectors', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    const bytes = Buffer.from(Array.from({ length: 20 }, (_, i) => i * 13));
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
  });

  it('refuses characters outside the alphabet', () => {
    expect(() => base32Decode('MZXW1YTB')).toThrow('Not a base32 string');
  });
});

describe('TOTP (RFC 6238)', () => {
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ])('gives the published six-digit code for unix time %i', (seconds, expected) => {
    expect(totpCodeAt(RFC_SECRET, totpStep(new Date(seconds * 1000)))).toBe(expected);
  });

  it('generates a 160-bit base32 secret, different each time', () => {
    const a = generateTotpSecret();
    expect(a).toMatch(/^[A-Z2-7]{32}$/);
    expect(a).not.toBe(generateTotpSecret());
  });
});

describe('verifyTotp', () => {
  const now = new Date(1_234_567_890_000);
  const step = totpStep(now);

  it('accepts the current step and returns it', () => {
    expect(verifyTotp(RFC_SECRET, totpCodeAt(RFC_SECRET, step), now, null)).toBe(step);
  });

  it('allows one step of drift either way, and no more', () => {
    expect(verifyTotp(RFC_SECRET, totpCodeAt(RFC_SECRET, step - 1), now, null)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totpCodeAt(RFC_SECRET, step + 1), now, null)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, totpCodeAt(RFC_SECRET, step - 2), now, null)).toBeNull();
    expect(verifyTotp(RFC_SECRET, totpCodeAt(RFC_SECRET, step + 2), now, null)).toBeNull();
  });

  it('refuses a step that was already used, and any earlier one (no replay)', () => {
    const code = totpCodeAt(RFC_SECRET, step);
    expect(verifyTotp(RFC_SECRET, code, now, step)).toBeNull();
    expect(verifyTotp(RFC_SECRET, totpCodeAt(RFC_SECRET, step - 1), now, step)).toBeNull();
    // A later step than the last used one is still fine.
    expect(verifyTotp(RFC_SECRET, totpCodeAt(RFC_SECRET, step + 1), now, step)).toBe(step + 1);
  });

  it('refuses a wrong, short or non-numeric code', () => {
    expect(verifyTotp(RFC_SECRET, '000000', now, null)).toBeNull();
    expect(verifyTotp(RFC_SECRET, '12345', now, null)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', now, null)).toBeNull();
    expect(verifyTotp(RFC_SECRET, '', now, null)).toBeNull();
  });

  it("does not accept another secret's code", () => {
    const other = generateTotpSecret();
    expect(verifyTotp(RFC_SECRET, totpCodeAt(other, step), now, null)).toBeNull();
  });
});

describe('otpauthUri', () => {
  it('carries the secret, issuer and the standard parameters, and escapes the account name', () => {
    const uri = new URL(otpauthUri('ABCDEFGH', 'asha+work@example.com', 'Envelope'));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.host).toBe('totp');
    expect(decodeURIComponent(uri.pathname)).toBe('/Envelope:asha+work@example.com');
    expect(uri.searchParams.get('secret')).toBe('ABCDEFGH');
    expect(uri.searchParams.get('issuer')).toBe('Envelope');
    expect(uri.searchParams.get('digits')).toBe('6');
    expect(uri.searchParams.get('period')).toBe('30');
  });
});
