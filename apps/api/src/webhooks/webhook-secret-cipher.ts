import { Injectable } from '@nestjs/common';
import { decryptAesGcm, encryptAesGcm } from '../common/crypto/aes-gcm';
import { AppConfig } from '../config/app-config';

/**
 * Encrypts webhook signing secrets at rest (docs/18, ADR 0015). Unlike the
 * HMAC-hashed secrets elsewhere in the codebase (`auth/session.service.ts`),
 * this must be reversible: signing an outbound delivery needs the raw
 * secret back, not just a value to compare against. The ciphertext layout is
 * in `common/crypto/aes-gcm.ts`.
 */
@Injectable()
export class WebhookSecretCipher {
  constructor(private readonly config: AppConfig) {}

  encrypt(plaintext: string): string {
    return encryptAesGcm(this.key(), plaintext);
  }

  decrypt(encoded: string): string {
    return decryptAesGcm(this.key(), encoded);
  }

  private key(): Buffer {
    return Buffer.from(this.config.WEBHOOK_SECRET_ENC_KEY, 'base64');
  }
}
