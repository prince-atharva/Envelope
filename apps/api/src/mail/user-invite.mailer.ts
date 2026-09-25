import { INVITE_TOKEN_EXPIRY_DAYS, type UserRole } from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { inviteUrl, mintInviteToken, tokenRef } from '../signing/signing-token';
import type { UserInvitedJob } from './mail.types';
import { MailTransportService } from './mail-transport.service';
import type { SigningLinkResult } from './signing-link.mailer';
import { renderUserInvitedEmail } from './templates';

const ROLE_LABEL: Record<UserRole, string> = {
  OWNER: 'an owner',
  ADMIN: 'an admin',
  MEMBER: 'a member',
};

/**
 * Sends a tenant invitation (docs/17 step 6). The token is minted here, not
 * in the API: only its HMAC is stored, and the raw value is never queued
 * (ADR 0009, the same treatment as a signing link).
 */
@Injectable()
export class UserInviteMailer {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transport: MailTransportService,
    private readonly config: AppConfig,
    @InjectPinoLogger(UserInviteMailer.name) private readonly logger: PinoLogger,
  ) {}

  async send(job: UserInvitedJob): Promise<SigningLinkResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: job.userId },
      include: { tenant: { select: { name: true } } },
    });
    if (!user) {
      this.logger.info({ userId: job.userId }, 'Invitation not sent: user not found');
      return { skipped: 'user not found' };
    }
    if (!user.inviteTokenHash) {
      // Already accepted, or was never a pending invite (self-registered).
      this.logger.info({ userId: job.userId }, 'Invitation not sent: already accepted');
      return { skipped: 'already accepted' };
    }

    const { rawToken, tokenHash } = mintInviteToken(this.config.SIGNING_TOKEN_SECRET);
    const expiresAt = new Date(Date.now() + INVITE_TOKEN_EXPIRY_DAYS * 24 * 3600_000);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { inviteTokenHash: tokenHash, inviteTokenExpiresAt: expiresAt },
    });

    // The inviter's name is not carried on the job (ADR 0009: ids only); the
    // tenant name is enough context.
    const email = renderUserInvitedEmail({
      to: user.email,
      fullName: user.fullName,
      invitedByName: 'A workspace owner',
      workspaceName: user.tenant.name,
      roleLabel: ROLE_LABEL[user.role as UserRole],
      acceptUrl: inviteUrl(this.config.APP_URL, rawToken),
      expiresAt,
    });
    const { messageId } = await this.transport.send(email, job.template);

    this.logger.info(
      { userId: user.id, tokenRef: tokenRef(tokenHash), messageId },
      'Invitation emailed',
    );
    return { messageId };
  }
}
