import { Injectable } from '@nestjs/common';
import { decryptAesGcm, encryptAesGcm } from '../common/crypto/aes-gcm';
import { AppConfig } from '../config/app-config';

/**
 * Encrypts two-factor (TOTP) secrets at rest under their own key (docs/19,
 * ADR 0024). A TOTP secret must be recovered in full to check a code, so it
 * cannot only be hashed.
 */
@Injectable()
export class TotpSecretCipher {
  constructor(private readonly config: AppConfig) {}

  encrypt(secret: string): string {
    return encryptAesGcm(this.key(), secret);
  }

  decrypt(ciphertext: string): string {
    return decryptAesGcm(this.key(), ciphertext);
  }

  private key(): Buffer {
    return Buffer.from(this.config.TOTP_SECRET_ENC_KEY, 'base64');
  }
}
