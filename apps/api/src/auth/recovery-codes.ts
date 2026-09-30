import { createHmac, randomBytes } from 'node:crypto';
import { RECOVERY_CODE_COUNT } from '@envelope/shared';

/**
 * Recovery codes for a lost authenticator (docs/19, ADR 0024). Ten single-use
 * codes of 50 random bits, shown once; only their HMAC is stored, under their
 * own label, so a code can never pass for another token kind (ADR 0009).
 */

/** Crockford-style base32: no i, l, o or u, so a code read aloud or by eye is not misread. */
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const RECOVERY_LABEL = 'recovery-code\0';

export interface MintedRecoveryCode {
  /** Shown to the person once, as `xxxxx-xxxxx`. */
  code: string;
  /** Stored in RecoveryCode.codeHash. */
  codeHash: string;
}

function randomCode(): string {
  const bytes = randomBytes(10);
  // 256 is a multiple of 32, so masking a byte gives each symbol equal odds.
  const chars = Array.from(bytes, (byte) => ALPHABET[byte & 31]).join('');
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

/** What is compared and hashed: lower case, without the separator or stray spaces. */
export function normaliseRecoveryCode(code: string): string {
  return code.trim().toLowerCase().replace(/-/g, '');
}

export function hashRecoveryCode(secret: string, code: string): string {
  return createHmac('sha256', secret)
    .update(RECOVERY_LABEL)
    .update(normaliseRecoveryCode(code))
    .digest('hex');
}

export function mintRecoveryCodes(secret: string): MintedRecoveryCode[] {
  const codes = new Set<string>();
  while (codes.size < RECOVERY_CODE_COUNT) codes.add(randomCode());
  return [...codes].map((code) => ({ code, codeHash: hashRecoveryCode(secret, code) }));
}
