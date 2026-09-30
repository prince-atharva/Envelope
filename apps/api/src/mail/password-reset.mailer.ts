import { PASSWORD_RESET_TOKEN_EXPIRY_MINUTES } from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfig } from '../config/app-config';
import { maskEmail } from '../logging/redact';
import { PrismaService } from '../prisma/prisma.service';
import {
  forgotPasswordUrl,
  mintPasswordResetToken,
  passwordResetUrl,
  tokenRef,
} from '../signing/signing-token';
import type {
  PasswordChangedEmailJob,
  PasswordResetEmailJob,
  TwoFactorNoticeJob,
} from './mail.types';
import { MailTransportService } from './mail-transport.service';
import type { SigningLinkResult } from './signing-link.mailer';
import {
  renderPasswordChangedEmail,
  renderPasswordResetEmail,
  renderTwoFactorNoticeEmail,
} from './templates';

/**
 * Sends a password-reset link, and the notice that follows a reset (docs/19,
 * ADR 0022). The API answered the request the same way for every address; this
 * is where an account is looked up. The token is minted here, so only its HMAC
 * is stored and the raw value is never queued or logged (ADR 0009, the same
 * treatment as an invitation).
 */
@Injectable()
export class PasswordResetMailer {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transport: MailTransportService,
    private readonly config: AppConfig,
    @InjectPinoLogger(PasswordResetMailer.name) private readonly logger: PinoLogger,
  ) {}

  async sendResetLink(job: PasswordResetEmailJob): Promise<SigningLinkResult> {
    const email = maskEmail(job.email);
    const user = await this.prisma.user.findUnique({ where: { email: job.email } });
    const skipped = !user
      ? 'user not found'
      : user.isServiceAccount
        ? 'service account'
        : user.disabledAt
          ? 'account disabled'
          : user.inviteTokenHash
            ? 'invitation pending'
            : null;
    if (!user || skipped) {
      this.logger.info({ reason: skipped, email, userId: user?.id }, 'Password reset link skipped');
      return { skipped: skipped ?? 'user not found' };
    }

    const { rawToken, tokenHash } = mintPasswordResetToken(this.config.SIGNING_TOKEN_SECRET);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TOKEN_EXPIRY_MINUTES * 60_000);
    // A newer link cancels the older ones: one usable link at a time (ADR 0022).
    // The user row is locked first, so two jobs for one account cannot each
    // leave their own link usable.
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id}::uuid FOR UPDATE`;
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: now },
      });
      await tx.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt } });
    });

    const { messageId } = await this.transport.send(
      renderPasswordResetEmail({
        to: user.email,
        fullName: user.fullName,
        resetUrl: passwordResetUrl(this.config.APP_URL, rawToken),
      }),
      job.template,
    );

    this.logger.info(
      { userId: user.id, tokenRef: tokenRef(tokenHash), messageId },
      'Password reset link emailed',
    );
    return { messageId };
  }

  /** After a reset: tells the account's owner, so an unexpected change is noticed. */
  async sendChanged(job: PasswordChangedEmailJob): Promise<SigningLinkResult> {
    const user = await this.prisma.user.findUnique({ where: { id: job.userId } });
    if (!user) {
      this.logger.info({ userId: job.userId }, 'Password changed notice not sent: user not found');
      return { skipped: 'user not found' };
    }
    const { messageId } = await this.transport.send(
      renderPasswordChangedEmail({
        to: user.email,
        fullName: user.fullName,
        resetRequestUrl: forgotPasswordUrl(this.config.APP_URL),
        via: job.via ?? 'reset',
      }),
      job.template,
    );
    this.logger.info({ userId: user.id, messageId }, 'Password changed notice emailed');
    return { messageId };
  }

  /** Two-factor changed, or a recovery code was used: tells the account's owner (docs/19). */
  async sendTwoFactorNotice(job: TwoFactorNoticeJob): Promise<SigningLinkResult> {
    const user = await this.prisma.user.findUnique({ where: { id: job.userId } });
    if (!user) {
      this.logger.info({ userId: job.userId }, 'Two-factor notice not sent: user not found');
      return { skipped: 'user not found' };
    }
    const recoveryCodesLeft =
      job.event === 'recovery-used'
        ? await this.prisma.recoveryCode.count({ where: { userId: user.id, usedAt: null } })
        : undefined;
    const { messageId } = await this.transport.send(
      renderTwoFactorNoticeEmail({
        to: user.email,
        fullName: user.fullName,
        event: job.event,
        recoveryCodesLeft,
        resetRequestUrl: forgotPasswordUrl(this.config.APP_URL),
      }),
      job.template,
    );
    this.logger.info({ userId: user.id, event: job.event, messageId }, 'Two-factor notice emailed');
    return { messageId };
  }
}
