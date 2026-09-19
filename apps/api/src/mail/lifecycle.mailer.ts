import { receivesSigningLink } from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditService, SYSTEM_ACTOR } from '../audit/audit.service';
import type { Envelope, Recipient } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { VoidedNoticeJob } from './mail.types';
import { MailTransportService } from './mail-transport.service';
import type { SigningLinkResult } from './signing-link.mailer';
import { renderVoidedEmail } from './templates';

/**
 * Why a queued cancellation notice should not go out. A person whose turn
 * never came was never emailed, so there is nothing to tell them.
 */
export function whyNotSendVoided(
  recipient: Pick<Recipient, 'role' | 'notifiedAt'>,
  envelope: Pick<Envelope, 'status'>,
): string | null {
  if (envelope.status !== 'VOIDED') return 'envelope not cancelled';
  if (!receivesSigningLink(recipient.role)) return 'role receives no link';
  if (!recipient.notifiedAt) return 'never emailed';
  return null;
}

/** Emails to signers and approvers about what happened to an envelope after it was sent. */
@Injectable()
export class LifecycleMailer {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly transport: MailTransportService,
    @InjectPinoLogger(LifecycleMailer.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * The sender cancelled. Sent only to someone the mail server had accepted an
   * email for by the time this runs: a person whose turn never came has
   * nothing to be told about, and an invitation racing the cancel has either
   * been sent (and so is covered) or stopped at the envelope lock.
   */
  async sendVoided(job: VoidedNoticeJob): Promise<SigningLinkResult> {
    const ids = { envelopeId: job.envelopeId, recipientId: job.recipientId };
    const recipient = await this.prisma.recipient.findFirst({
      where: { id: job.recipientId, envelopeId: job.envelopeId },
      include: { envelope: { include: { owner: { select: { fullName: true } } } } },
    });

    if (!recipient) {
      this.logger.warn(ids, 'Cancellation notice not sent: recipient not found');
      return { skipped: 'recipient not found' };
    }
    const { envelope } = recipient;
    const skip = whyNotSendVoided(recipient, envelope);
    if (skip || !envelope.voidReason) {
      this.logger.info({ ...ids, reason: skip }, 'Cancellation notice not sent');
      return { skipped: skip ?? 'no reason recorded' };
    }

    const { messageId } = await this.transport.send(
      renderVoidedEmail({
        to: recipient.email,
        recipientName: recipient.name,
        senderName: envelope.owner.fullName,
        envelopeTitle: envelope.title,
        reason: envelope.voidReason,
      }),
      job.template,
    );

    await this.prisma.$transaction(async (tx) => {
      await this.audit.record(tx, {
        envelopeId: envelope.id,
        recipientId: recipient.id,
        action: 'EMAIL_SENT',
        ...SYSTEM_ACTOR,
        metadata: { kind: 'voided' },
      });
    });

    this.logger.info({ ...ids, messageId }, 'Cancellation notice emailed');
    return { messageId };
  }
}
