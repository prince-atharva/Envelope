import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import type { DeclinedNoticeJob } from './mail.types';
import { MailTransportService } from './mail-transport.service';
import type { SigningLinkResult } from './signing-link.mailer';
import { renderDeclinedEmail } from './templates';

/** Emails to the sender about their envelope. For now: someone declined. */
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
}
