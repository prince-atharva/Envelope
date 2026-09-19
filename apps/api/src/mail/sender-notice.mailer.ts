import { receivesSigningLink } from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import type { DeclinedNoticeJob, ExpiredNoticeJob } from './mail.types';
import { MailTransportService } from './mail-transport.service';
import type { SigningLinkResult } from './signing-link.mailer';
import { renderDeclinedEmail, renderExpiredEmail } from './templates';

/** Emails to the sender about their envelope: someone declined, or it expired. */
@Injectable()
export class SenderNoticeMailer {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transport: MailTransportService,
    private readonly config: AppConfig,
    @InjectPinoLogger(SenderNoticeMailer.name) private readonly logger: PinoLogger,
  ) {}

  async sendDeclined(job: DeclinedNoticeJob): Promise<SigningLinkResult> {
    const recipient = await this.prisma.recipient.findFirst({
      where: { id: job.recipientId, envelopeId: job.envelopeId, status: 'DECLINED' },
      include: {
        envelope: { include: { owner: { select: { email: true, fullName: true } } } },
      },
    });
    if (!recipient?.declinedReason) {
      this.logger.warn(
        { envelopeId: job.envelopeId, recipientId: job.recipientId },
        'Decline notice not sent: no declined recipient found',
      );
      return { skipped: 'no declined recipient' };
    }

    const { envelope } = recipient;
    const envelopeUrl = new URL(`/dashboard/envelopes/${envelope.id}`, this.config.APP_URL);
    return this.transport.send(
      renderDeclinedEmail({
        to: envelope.owner.email,
        senderName: envelope.owner.fullName,
        recipientName: recipient.name,
        envelopeTitle: envelope.title,
        reason: recipient.declinedReason,
        envelopeUrl: envelopeUrl.toString(),
      }),
      job.template,
    );
  }

  /**
   * The deadline passed. Skipped if the sender has already extended or
   * cancelled it by the time this runs: the news would be stale.
   */
  async sendExpired(job: ExpiredNoticeJob): Promise<SigningLinkResult> {
    const envelope = await this.prisma.envelope.findUnique({
      where: { id: job.envelopeId },
      include: {
        owner: { select: { email: true, fullName: true } },
        recipients: { orderBy: [{ routingOrder: 'asc' }, { createdAt: 'asc' }] },
      },
    });
    if (envelope?.status !== 'EXPIRED' || !envelope.expiresAt) {
      this.logger.info(
        { envelopeId: job.envelopeId, status: envelope?.status },
        'Expiry notice not sent: no longer expired',
      );
      return { skipped: 'no longer expired' };
    }

    const envelopeUrl = new URL(`/dashboard/envelopes/${envelope.id}`, this.config.APP_URL);
    return this.transport.send(
      renderExpiredEmail({
        to: envelope.owner.email,
        senderName: envelope.owner.fullName,
        envelopeTitle: envelope.title,
        deadline: envelope.expiresAt,
        waitingFor: envelope.recipients
          .filter((r) => receivesSigningLink(r.role) && r.status !== 'SIGNED')
          .map((r) => r.name),
        envelopeUrl: envelopeUrl.toString(),
      }),
      job.template,
    );
  }
}
