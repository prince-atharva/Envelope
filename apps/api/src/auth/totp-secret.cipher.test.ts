import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../config/app-config';
import { generateTotpSecret } from './totp';
import { TotpSecretCipher } from './totp-secret.cipher';

const cipherWithKey = (key: Buffer) =>
  new TotpSecretCipher({ TOTP_SECRET_ENC_KEY: key.toString('base64') } as AppConfig);

describe('TotpSecretCipher', () => {
  it('round-trips a secret and never stores it in the clear', () => {
    const cipher = cipherWithKey(randomBytes(32));
    const secret = generateTotpSecret();
    const ciphertext = cipher.encrypt(secret);
    expect(ciphertext).not.toContain(secret);
    expect(cipher.decrypt(ciphertext)).toBe(secret);
  });

  it('uses a fresh IV each time, fails closed on tampering and on the wrong key', () => {
    const cipher = cipherWithKey(randomBytes(32));
    expect(cipher.encrypt('ABCDEFGH')).not.toBe(cipher.encrypt('ABCDEFGH'));
    const tampered = Buffer.from(cipher.encrypt('ABCDEFGH'), 'base64');
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff;
    expect(() => cipher.decrypt(tampered.toString('base64'))).toThrow();
    expect(() => cipherWithKey(randomBytes(32)).decrypt(cipher.encrypt('ABCDEFGH'))).toThrow();
  });
});
