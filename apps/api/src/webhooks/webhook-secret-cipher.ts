import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app-config';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

/**
 * Encrypts webhook signing secrets at rest (docs/18, ADR 0015). Unlike the
 * HMAC-hashed secrets elsewhere in the codebase (`auth/session.service.ts`),
 * this must be reversible: signing an outbound delivery needs the raw
 * secret back, not just a value to compare against.
 *
 * Ciphertext layout, base64: iv (12 bytes) | authTag (16 bytes) | ciphertext.
 */
@Injectable()
export class WebhookSecretCipher {
  constructor(private readonly config: AppConfig) {}

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key(), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
  }

  decrypt(encoded: string): string {
    const raw = Buffer.from(encoded, 'base64');
    const iv = raw.subarray(0, IV_BYTES);
    const authTag = raw.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
    const ciphertext = raw.subarray(IV_BYTES + AUTH_TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, this.key(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  private key(): Buffer {
    return Buffer.from(this.config.WEBHOOK_SECRET_ENC_KEY, 'base64');
  }
}
