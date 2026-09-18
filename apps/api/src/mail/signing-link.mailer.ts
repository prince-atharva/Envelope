import { receivesSigningLink } from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditService, SYSTEM_ACTOR } from '../audit/audit.service';
import { AppConfig } from '../config/app-config';
import type { Envelope, Recipient } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { mintSigningToken, signingUrl, tokenRef } from '../signing/signing-token';
import type { SigningLinkEmailJob } from './mail.types';
import { MailTransportService } from './mail-transport.service';
import { renderSigningLinkEmail } from './templates';

/** Envelope statuses in which a link is still worth sending. */
const OPEN_ENVELOPE = ['SENT', 'DELIVERED', 'PARTIALLY_SIGNED'] as const;
/** Invited and not yet finished. PENDING has not been invited; SIGNED and DECLINED are done. */
const AWAITING_RECIPIENT = ['SENT', 'DELIVERED', 'VIEWED'] as const;

export type SigningLinkResult = { messageId: string } | { skipped: string };

/**
 * Why a queued invitation or reminder should not go out any more. The state can
 * change between queueing and sending: the person may have signed, someone may
 * have declined, or the envelope may have expired.
 */
export function whyNotSend(
  recipient: Pick<Recipient, 'role' | 'status' | 'tokenUsedAt'>,
  envelope: Pick<Envelope, 'status' | 'expiresAt'>,
  now: Date,
): string | null {
  if (!(OPEN_ENVELOPE as readonly string[]).includes(envelope.status)) return 'envelope closed';
  if (!receivesSigningLink(recipient.role)) return 'role receives no link';
  if (
    recipient.tokenUsedAt ||
    !(AWAITING_RECIPIENT as readonly string[]).includes(recipient.status)
  ) {
    return recipient.status === 'PENDING' ? 'not their turn' : 'already finished';
  }
  if (envelope.expiresAt && envelope.expiresAt <= now) return 'envelope expired';
  return null;
}

/**
 * Sends invitations and reminders from the worker (ADR 0009).
 *
 * The job carries only ids. A fresh token is minted here, its HMAC is stored,
 * and the raw value goes into the email and is then dropped. It is never
 * queued, stored or logged. Every email replaces the previous link.
 */
@Injectable()
export class SigningLinkMailer {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly transport: MailTransportService,
    private readonly config: AppConfig,
    @InjectPinoLogger(SigningLinkMailer.name) private readonly logger: PinoLogger,
  ) {}

  async send(job: SigningLinkEmailJob): Promise<SigningLinkResult> {
    const ids = { envelopeId: job.envelopeId, recipientId: job.recipientId };
    const now = new Date();

    const prepared = await this.prisma.$transaction(async (tx) => {
      const found = await tx.recipient.findFirst({
        where: { id: job.recipientId, envelopeId: job.envelopeId },
        include: { envelope: { include: { owner: { select: { fullName: true } } } } },
      });
      if (!found) return { sent: false, reason: 'recipient not found' } as const;

      const { envelope, ...recipient } = found;
      const reason = whyNotSend(recipient, envelope, now);
      if (reason) return { sent: false, reason } as const;

      const { rawToken, tokenHash } = mintSigningToken(this.config.SIGNING_TOKEN_SECRET);
      // Conditional on what was just checked, so a signature or decline that
      // commits in the meantime wins and no link is sent.
      const claimed = await tx.recipient.updateMany({
        where: {
          id: recipient.id,
          status: { in: [...AWAITING_RECIPIENT] },
          tokenUsedAt: null,
          envelope: { status: { in: [...OPEN_ENVELOPE] } },
        },
        data: { tokenHash, tokenExpiresAt: envelope.expiresAt },
      });
      if (claimed.count === 0) return { sent: false, reason: 'changed while sending' } as const;
      return { sent: true, rawToken, tokenHash, recipient, envelope } as const;
    });

    if (!prepared.sent) {
      this.logger.info({ ...ids, reason: prepared.reason }, 'Signing email not sent');
      return { skipped: prepared.reason };
    }

    const { rawToken, tokenHash, recipient, envelope } = prepared;
    if (!envelope.expiresAt) throw new Error('A sent envelope has no expiry');

    const email = renderSigningLinkEmail({
      kind: job.template,
      to: recipient.email,
      recipientName: recipient.name,
      action: recipient.role === 'APPROVER' ? 'approve' : 'sign',
      senderName: envelope.owner.fullName,
      envelopeTitle: envelope.title,
      message: envelope.message,
      expiresAt: envelope.expiresAt,
      signingUrl: signingUrl(this.config.APP_URL, rawToken),
    });
    const { messageId } = await this.transport.send(email, job.template);

    await this.prisma.$transaction(async (tx) => {
      await tx.recipient.update({ where: { id: recipient.id }, data: { notifiedAt: new Date() } });
      await this.audit.record(tx, {
        envelopeId: envelope.id,
        recipientId: recipient.id,
        action: 'EMAIL_SENT',
        ...SYSTEM_ACTOR,
        metadata: { kind: job.template },
      });
    });

    this.logger.info(
      { ...ids, kind: job.template, tokenRef: tokenRef(tokenHash), messageId },
      'Signing link emailed',
    );
    return { messageId };
  }
}
