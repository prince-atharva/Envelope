import { randomBytes } from 'node:crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

/** OWASP's recommended Argon2id parameters (19 MiB memory, 2 iterations, 1 thread). */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** Password hashing for sender accounts (docs/10: Argon2id). */
@Injectable()
export class PasswordService implements OnModuleInit {
  private dummyHash = '';

  constructor(@InjectPinoLogger(PasswordService.name) private readonly logger: PinoLogger) {}

  async onModuleInit(): Promise<void> {
    // Verified against when an email is unknown, so a failed login takes the same
    // time whether or not the account exists.
    this.dummyHash = await this.hash(randomBytes(32).toString('base64'));
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch (error) {
      // A malformed stored hash is a data problem, not a wrong password.
      this.logger.error({ err: error }, 'Password hash could not be verified');
      return false;
    }
  }

  /** Burns the same CPU time as a real verification. Always resolves to false. */
  async verifyAgainstDummy(password: string): Promise<false> {
    await argon2.verify(this.dummyHash, password).catch(() => false);
    return false;
  }

  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, ARGON2_OPTIONS);
  }
}
