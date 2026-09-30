import { RECOVERY_CODE_COUNT } from '@envelope/shared';
import { describe, expect, it } from 'vitest';
import { hashRecoveryCode, mintRecoveryCodes, normaliseRecoveryCode } from './recovery-codes';

const SECRET = 'unit-test-signing-secret-0123456789abcdef';

describe('recovery codes', () => {
  it('mints ten distinct xxxxx-xxxxx codes, each stored only as its HMAC', () => {
    const minted = mintRecoveryCodes(SECRET);
    expect(minted).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(minted.map((m) => m.code)).size).toBe(RECOVERY_CODE_COUNT);
    for (const { code, codeHash } of minted) {
      expect(code).toMatch(/^[0-9a-hjkmnp-tv-z]{5}-[0-9a-hjkmnp-tv-z]{5}$/);
      expect(codeHash).toBe(hashRecoveryCode(SECRET, code));
      expect(codeHash).not.toContain(normaliseRecoveryCode(code));
    }
  });

  it('hashes the same whatever the case, spacing or separator the person types', () => {
    expect(hashRecoveryCode(SECRET, ' ABCDE-23456 ')).toBe(hashRecoveryCode(SECRET, 'abcde23456'));
  });

  it('keys the hash with the secret and its own label', () => {
    expect(hashRecoveryCode(SECRET, 'abcde-23456')).not.toBe(
      hashRecoveryCode(`${SECRET}x`, 'abcde-23456'),
    );
  });
});
