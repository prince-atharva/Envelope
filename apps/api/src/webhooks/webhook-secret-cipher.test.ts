import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../config/app-config';
import { WebhookSecretCipher } from './webhook-secret-cipher';

function cipherWithKey(key: Buffer): WebhookSecretCipher {
  return new WebhookSecretCipher({ WEBHOOK_SECRET_ENC_KEY: key.toString('base64') } as AppConfig);
}

describe('WebhookSecretCipher', () => {
  it('round-trips a secret', () => {
    const cipher = cipherWithKey(randomBytes(32));
    const ciphertext = cipher.encrypt('whsec_raw-value-goes-here');
    expect(ciphertext).not.toContain('whsec_raw-value-goes-here');
    expect(cipher.decrypt(ciphertext)).toBe('whsec_raw-value-goes-here');
  });

  it('produces different ciphertext for the same plaintext each time (random IV)', () => {
    const cipher = cipherWithKey(randomBytes(32));
    expect(cipher.encrypt('same secret')).not.toBe(cipher.encrypt('same secret'));
  });

  it('fails closed when the ciphertext is tampered with', () => {
    const cipher = cipherWithKey(randomBytes(32));
    const ciphertext = cipher.encrypt('whsec_original');
    const tampered = Buffer.from(ciphertext, 'base64');
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff;
    expect(() => cipher.decrypt(tampered.toString('base64'))).toThrow();
  });

  it('fails closed with the wrong key', () => {
    const ciphertext = cipherWithKey(randomBytes(32)).encrypt('whsec_original');
    expect(() => cipherWithKey(randomBytes(32)).decrypt(ciphertext)).toThrow();
  });
});
