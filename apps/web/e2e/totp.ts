import { createHmac } from 'node:crypto';

/**
 * An authenticator app, for tests: RFC 6238 (HMAC-SHA1, 30 seconds, 6 digits),
 * written separately from the API's own implementation so the browser suite
 * checks the two against each other rather than the API against itself.
 */
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function decode(secret: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of secret.replace(/[\s=]/g, '').toUpperCase()) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** The code shown now, or `offset` 30-second steps away (the server accepts one either side). */
export function totpNow(secret: string, offset = 0): string {
  const step = Math.floor(Date.now() / 1000 / 30) + offset;
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', decode(secret)).update(counter).digest();
  const at = (hmac[19] ?? 0) & 0x0f;
  const binary =
    (((hmac[at] ?? 0) & 0x7f) << 24) |
    (((hmac[at + 1] ?? 0) & 0xff) << 16) |
    (((hmac[at + 2] ?? 0) & 0xff) << 8) |
    ((hmac[at + 3] ?? 0) & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}
