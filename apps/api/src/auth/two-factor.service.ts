import type {
  ConfirmTwoFactorInput,
  RecoveryCodesResponse,
  TwoFactorSetup,
  TwoFactorStatus,
} from '@envelope/shared';
import { BRAND } from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppException } from '../common/errors/app-exception';
import { rateLimited } from '../common/throttling/rate-limit';
import { AppConfig } from '../config/app-config';
import type { Prisma, User } from '../generated/prisma/client';
import type { TwoFactorNoticeEvent } from '../mail/mail.types';
import { MailQueueService } from '../mail/mail-queue.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import type { ClientInfo } from './auth.types';
import { PasswordService } from './password.service';
import { hashRecoveryCode, mintRecoveryCodes } from './recovery-codes';
import type { RevokeReason } from './session.service';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp';
import { TotpSecretCipher } from './totp-secret.cipher';

/** A second factor that was accepted: which kind, so a recovery code can be reported. */
export type SecondFactorMethod = 'totp' | 'recovery';

type Db = Prisma.TransactionClient | PrismaService;

const SIX_DIGITS = /^\d{6}$/;

/**
 * Wrong second-factor codes allowed per person before further tries are
 * refused for the rest of the window. The per-challenge and per-address limits
 * bound one token and one client; this bounds the account itself, so an
 * attacker holding the password cannot keep fetching fresh challenges to guess
 * a six-digit code (ADR 0024).
 */
const MAX_FAILED_CODES = 5;
const FAILED_CODES_WINDOW_SECONDS = 15 * 60;

/**
 * Two-factor authentication for one person (docs/19, ADR 0024): enrolling,
 * checking a code at sign-in, and turning it off. Never logs a secret, a code
 * or a URI, and never returns a stored secret.
 */
@Injectable()
export class TwoFactorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly cipher: TotpSecretCipher,
    private readonly config: AppConfig,
    private readonly mailQueue: MailQueueService,
    private readonly redis: RedisService,
    @InjectPinoLogger(TwoFactorService.name) private readonly logger: PinoLogger,
  ) {}

  async status(userId: string): Promise<TwoFactorStatus> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { tenant: { select: { requireTwoFactor: true } } },
    });
    const enabled = user.totpEnabledAt !== null;
    const recoveryCodesRemaining = enabled
      ? await this.prisma.recoveryCode.count({ where: { userId, usedAt: null } })
      : 0;
    return { enabled, recoveryCodesRemaining, required: user.tenant.requireTwoFactor };
  }

  /**
   * Starts enrolment: a fresh secret, stored encrypted and pending until a valid
   * code confirms it. Repeatable until enabled, so a lost QR code is not a dead end.
   */
  async setup(userId: string, client: ClientInfo): Promise<TwoFactorSetup> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.totpEnabledAt) throw new AppException('TWO_FACTOR_ALREADY_ENABLED');
    const setup = await this.startPending(user);
    this.logger.info(
      { userId, tenantId: user.tenantId, ip: client.ip },
      'Two-factor setup started',
    );
    return setup;
  }

  /** Confirms the pending secret with a code, turns two-factor on and issues the recovery codes. */
  async enable(userId: string, code: string, client: ClientInfo): Promise<RecoveryCodesResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const recoveryCodes = await this.finishEnrolment(user, code, client);
    await this.notify(userId, 'enabled');
    return { recoveryCodes };
  }

  /** Turns it off. Needs the password and a current code, so a stolen session alone cannot. */
  async disable(
    userId: string,
    sessionId: string,
    input: ConfirmTwoFactorInput,
    client: ClientInfo,
  ): Promise<void> {
    // The rule is checked first: a refused request must not spend the person's
    // authenticator step or one of their single-use recovery codes.
    const current = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { tenant: { select: { requireTwoFactor: true } } },
    });
    if (current.totpEnabledAt && current.tenant.requireTwoFactor) {
      this.logger.warn(
        { userId, tenantId: current.tenantId, reason: 'workspace-requires' },
        'Two-factor disable refused',
      );
      throw new AppException(
        'TWO_FACTOR_REQUIRED',
        'Your workspace requires two-factor authentication.',
      );
    }
    const user = await this.confirm(userId, input, client);

    const now = new Date();
    const revokedSessions = await this.prisma.$transaction(async (tx) => {
      await this.clear(tx, userId);
      const { count } = await tx.session.updateMany({
        where: { userId, revokedAt: null, id: { not: sessionId } },
        data: { revokedAt: now, revokedReason: 'two-factor-disabled' satisfies RevokeReason },
      });
      return count;
    });
    this.logger.info(
      { userId, tenantId: user.tenantId, revokedSessions, ip: client.ip },
      'Two-factor disabled',
    );
    await this.notify(userId, 'disabled');
  }

  /** Replaces the recovery codes, ending the old ones. Needs the password and a current code. */
  async regenerateRecoveryCodes(
    userId: string,
    input: ConfirmTwoFactorInput,
    client: ClientInfo,
  ): Promise<RecoveryCodesResponse> {
    const user = await this.confirm(userId, input, client);
    // One transaction: a failure between deleting the old codes and creating the
    // new ones must not leave an enrolled person with none.
    const recoveryCodes = await this.prisma.$transaction((tx) =>
      this.replaceRecoveryCodes(tx, userId),
    );
    this.logger.info(
      { userId, tenantId: user.tenantId, ip: client.ip },
      'Two-factor recovery codes regenerated',
    );
    return { recoveryCodes };
  }

  // ─── Shared with sign-in and enrolment (AuthService) ───

  /** A pending secret for `user`, replacing any earlier pending one. */
  async startPending(user: User): Promise<TwoFactorSetup> {
    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { totpSecretCiphertext: this.cipher.encrypt(secret), totpLastStep: null },
    });
    return { secret, otpauthUri: otpauthUri(secret, user.email, BRAND.productName) };
  }

  /**
   * Verifies `code` against the pending secret, stores the factor and issues
   * ten recovery codes, all in one transaction. Returns the codes, once.
   */
  async finishEnrolment(user: User, code: string, client: ClientInfo): Promise<string[]> {
    if (user.totpEnabledAt) throw new AppException('TWO_FACTOR_ALREADY_ENABLED');
    if (!user.totpSecretCiphertext) {
      throw new AppException('BAD_REQUEST', 'Start two-factor setup first.');
    }
    const secret = this.cipher.decrypt(user.totpSecretCiphertext);
    const step = verifyTotp(secret, code, new Date(), null);
    if (step === null) {
      this.logger.warn(
        { userId: user.id, reason: 'wrong-code', phase: 'enrol', ip: client.ip },
        'Two-factor code rejected',
      );
      throw new AppException('TWO_FACTOR_CODE_INVALID');
    }

    const recoveryCodes = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { totpEnabledAt: new Date(), totpLastStep: step },
      });
      return this.replaceRecoveryCodes(tx, user.id);
    });
    this.logger.info(
      { userId: user.id, tenantId: user.tenantId, ip: client.ip },
      'Two-factor enabled',
    );
    return recoveryCodes;
  }

  /**
   * Checks a code for someone with two-factor on: a six-digit authenticator
   * code (each step usable once) or a recovery code (usable once). Throws
   * `TWO_FACTOR_CODE_INVALID`; on success says which kind was used. A recovery
   * code is reported to the person by email.
   */
  async verifySecondFactor(
    user: User,
    code: string,
    client: ClientInfo,
  ): Promise<SecondFactorMethod> {
    const reject = async (reason: string, method: SecondFactorMethod): Promise<never> => {
      this.logger.warn(
        { userId: user.id, method, reason, ip: client.ip },
        'Two-factor code rejected',
      );
      await this.recordFailure(user.id);
      throw new AppException('TWO_FACTOR_CODE_INVALID');
    };
    if (!user.totpEnabledAt || !user.totpSecretCiphertext) {
      throw new AppException('TWO_FACTOR_NOT_ENABLED');
    }
    await this.assertNotLocked(user.id, client);
    const method = await this.check(user, code, client, reject);
    await this.clearFailures(user.id);
    return method;
  }

  private async check(
    user: User,
    code: string,
    client: ClientInfo,
    reject: (reason: string, method: SecondFactorMethod) => Promise<never>,
  ): Promise<SecondFactorMethod> {
    if (!user.totpEnabledAt || !user.totpSecretCiphertext) {
      throw new AppException('TWO_FACTOR_NOT_ENABLED');
    }

    if (SIX_DIGITS.test(code)) {
      const step = verifyTotp(
        this.cipher.decrypt(user.totpSecretCiphertext),
        code,
        new Date(),
        user.totpLastStep,
      );
      if (step === null) return reject('wrong-or-used-code', 'totp');
      // The condition makes this safe against two requests presenting one code
      // at once: only the first moves the step forward.
      const { count } = await this.prisma.user.updateMany({
        where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
        data: { totpLastStep: step },
      });
      if (count === 0) return reject('code-already-used', 'totp');
      return 'totp';
    }

    const { count } = await this.prisma.recoveryCode.updateMany({
      where: {
        userId: user.id,
        codeHash: hashRecoveryCode(this.config.SIGNING_TOKEN_SECRET, code),
        usedAt: null,
      },
      data: { usedAt: new Date() },
    });
    if (count === 0) return reject('unknown-or-used-recovery-code', 'recovery');
    this.logger.info(
      { userId: user.id, tenantId: user.tenantId, ip: client.ip },
      'Recovery code used',
    );
    await this.notify(user.id, 'recovery-used');
    return 'recovery';
  }

  // ─── Wrong-code lockout (per person, in Redis) ───

  private failuresKey(userId: string): string {
    return `${this.config.QUEUE_PREFIX}:mfa-failed:${userId}`;
  }

  /** Refuses further tries once a person has had too many wrong codes in the window. */
  private async assertNotLocked(userId: string, client: ClientInfo): Promise<void> {
    let retryAfter = 0;
    try {
      const failed = Number((await this.redis.client.get(this.failuresKey(userId))) ?? 0);
      if (failed >= MAX_FAILED_CODES) {
        retryAfter = Math.max(1, await this.redis.client.ttl(this.failuresKey(userId)));
      }
    } catch (error) {
      // Like the other rate limits, an unreachable Redis must not lock everyone out.
      this.logger.warn({ err: error, userId }, 'Two-factor lockout could not be checked');
      return;
    }
    if (retryAfter > 0) {
      this.logger.warn(
        { userId, retryAfter, ip: client.ip, limit: MAX_FAILED_CODES },
        'Two-factor attempts refused: too many wrong codes',
      );
      throw rateLimited(retryAfter, 'Too many incorrect codes. Please wait and try again.');
    }
  }

  private async recordFailure(userId: string): Promise<void> {
    const key = this.failuresKey(userId);
    try {
      // NX first, so the window starts at the first failure and always expires.
      await this.redis.client.set(key, 0, 'EX', FAILED_CODES_WINDOW_SECONDS, 'NX');
      await this.redis.client.incr(key);
    } catch (error) {
      this.logger.warn({ err: error, userId }, 'Two-factor failure could not be counted');
    }
  }

  private async clearFailures(userId: string): Promise<void> {
    await this.redis.client.del(this.failuresKey(userId)).catch((error: unknown) => {
      this.logger.warn({ err: error, userId }, 'Two-factor failures could not be cleared');
    });
  }

  /** Removes the factor and its recovery codes. */
  async clear(db: Db, userId: string): Promise<void> {
    await db.user.update({
      where: { id: userId },
      data: { totpSecretCiphertext: null, totpEnabledAt: null, totpLastStep: null },
    });
    await db.recoveryCode.deleteMany({ where: { userId } });
  }

  /** Queues the email that tells a person about a change to their factor. */
  async notify(userId: string, event: TwoFactorNoticeEvent): Promise<void> {
    // The change has happened either way; a queue outage must not fail the request.
    await this.mailQueue.enqueueTwoFactorNotice(userId, event).catch((error: unknown) => {
      this.logger.error({ err: error, userId, event }, 'Two-factor notice could not be queued');
    });
  }

  private async confirm(
    userId: string,
    input: ConfirmTwoFactorInput,
    client: ClientInfo,
  ): Promise<User> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.totpEnabledAt) throw new AppException('TWO_FACTOR_NOT_ENABLED');
    if (!(await this.passwords.verify(user.passwordHash, input.password))) {
      this.logger.warn(
        { userId, reason: 'wrong-password', ip: client.ip },
        'Two-factor change rejected',
      );
      throw new AppException('CURRENT_PASSWORD_INCORRECT');
    }
    await this.verifySecondFactor(user, input.code, client);
    return user;
  }

  private async replaceRecoveryCodes(db: Db, userId: string): Promise<string[]> {
    const minted = mintRecoveryCodes(this.config.SIGNING_TOKEN_SECRET);
    await db.recoveryCode.deleteMany({ where: { userId } });
    await db.recoveryCode.createMany({
      data: minted.map(({ codeHash }) => ({ userId, codeHash })),
    });
    return minted.map(({ code }) => code);
  }
}
