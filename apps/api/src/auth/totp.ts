import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { TOTP_DIGITS, TOTP_STEP_SECONDS } from '@envelope/shared';

/**
 * Time-based one-time passwords, RFC 6238 with HMAC-SHA1 (docs/19, ADR 0024).
 * Written on node:crypto rather than a library: the algorithm is small and
 * stable, and this sits on the sign-in path.
 */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const SECRET_BYTES = 20;

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of text.replace(/=+$/, '').toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('Not a base32 string');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A new shared secret: 160 random bits, base32, the form authenticator apps take. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

/** The 30-second window a moment falls in. */
export function totpStep(now: Date): number {
  return Math.floor(now.getTime() / 1000 / TOTP_STEP_SECONDS);
}

/** The code for one step (RFC 4226 dynamic truncation over the step counter). */
export function totpCodeAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const binary =
    (((hmac[offset] ?? 0) & 0x7f) << 24) |
    (((hmac[offset + 1] ?? 0) & 0xff) << 16) |
    (((hmac[offset + 2] ?? 0) & 0xff) << 8) |
    ((hmac[offset + 3] ?? 0) & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

function sameCode(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Checks a code against the previous, current and next step (clock drift), and
 * returns the step it matched, or null. A step at or before `lastStep` is
 * refused, so a code that was already used, or one older than the last used,
 * cannot be replayed. All three steps are always computed, so the time taken
 * does not say which one matched.
 */
export function verifyTotp(
  secret: string,
  code: string,
  now: Date,
  lastStep: number | null,
): number | null {
  const current = totpStep(now);
  let accepted: number | null = null;
  for (const step of [current - 1, current, current + 1]) {
    const matches = sameCode(totpCodeAt(secret, step), code);
    if (matches && accepted === null && (lastStep === null || step > lastStep)) accepted = step;
  }
  return accepted;
}

/** The `otpauth://` URI an authenticator app reads from a QR code. */
export function otpauthUri(secret: string, accountName: string, issuer: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
