import {
  checkReadyToSend,
  type ProblemFieldError,
  type ReadinessIssue,
  recipientsDueInvitation,
  type SendEnvelopeInput,
  type SendEnvelopeResponse,
} from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser, ClientInfo } from '../auth/auth.types';
import { AppException } from '../common/errors/app-exception';
import { AppConfig } from '../config/app-config';
import { toFieldInfo, toRecipientInfo } from '../drafts/draft-mappers';
import { MailQueueService } from '../mail/mail-queue.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

const DAY_MS = 24 * 3600 * 1000;

function notReady(issues: ReadinessIssue[]): AppException {
  const errors: ProblemFieldError[] = issues.map((issue) => ({
    path:
      'recipientId' in issue
        ? `recipients.${issue.recipientId}`
        : 'fieldId' in issue
          ? `fields.${issue.fieldId}`
          : 'recipients',
    message: issue.message,
  }));
  // docs/08 names RECIPIENT_HAS_NO_FIELDS; anything else gets the general code.
  const code = issues.some((issue) => issue.code === 'RECIPIENT_HAS_NO_FIELDS')
    ? 'RECIPIENT_HAS_NO_FIELDS'
    : 'NOT_READY_TO_SEND';
  return new AppException(code, issues[0]?.message, { errors });
}

/**
 * Sending an envelope (docs/08, POST /envelopes/:id/send).
 *
 * One transaction moves the draft to SENT, marks whoever is due first as
 * invited, and writes ENVELOPE_SENT. The invitations are queued after it
 * commits; the worker mints each link as it sends (ADR 0009).
 */
@Injectable()
export class SendingService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailQueueService,
    private readonly config: AppConfig,
    @InjectPinoLogger(SendingService.name) private readonly logger: PinoLogger,
  ) {}

  private get db() {
    return this.tenantPrisma.client;
  }

  async send(
    envelopeId: string,
    input: SendEnvelopeInput,
    user: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<SendEnvelopeResponse> {
    const started = performance.now();
    const sentAt = new Date();
    const expiresInDays = input.expiresInDays ?? this.config.SIGNING_DEFAULT_EXPIRY_DAYS;
    const expiresAt = new Date(sentAt.getTime() + expiresInDays * DAY_MS);

    const { invited, sequential, recipientCount } = await this.db.$transaction(async (tx) => {
      // Takes the envelope's row lock, so a draft edit racing this send waits
      // for it and then finds the envelope no longer a draft.
      const claimed = await tx.envelope.updateMany({
        where: { id: envelopeId, status: 'DRAFT' },
        data: { draftRevision: { increment: 1 } },
      });
      if (claimed.count === 0) {
        const existing = await tx.envelope.findUnique({
          where: { id: envelopeId },
          select: { id: true },
        });
        if (!existing) throw new AppException('NOT_FOUND', 'Envelope not found.');
        throw new AppException('ENVELOPE_NOT_DRAFT', 'This envelope has already been sent.');
      }

      const envelope = await tx.envelope.findUnique({
        where: { id: envelopeId },
        include: {
          recipients: { orderBy: [{ routingOrder: 'asc' }, { createdAt: 'asc' }] },
          fields: true,
        },
      });
      if (!envelope) throw new AppException('NOT_FOUND', 'Envelope not found.');

      // The same list the review screen shows, so the button and the server agree.
      const issues = checkReadyToSend({
        recipients: envelope.recipients.map(toRecipientInfo),
        fields: envelope.fields.map(toFieldInfo),
      });
      if (issues.length > 0) {
        this.logger.info(
          { envelopeId, issues: issues.map((issue) => issue.code) },
          'Send refused: envelope not ready',
        );
        throw notReady(issues);
      }

      const due = recipientsDueInvitation(envelope.recipients, envelope.sequentialSigning);
      await tx.envelope.update({
        where: { id: envelopeId },
        data: {
          status: 'SENT',
          sentAt,
          expiresAt,
          ...(input.message === undefined ? {} : { message: input.message }),
        },
      });
      await tx.recipient.updateMany({
        where: { envelopeId, id: { in: due.map((recipient) => recipient.id) } },
        data: { status: 'SENT', invitedAt: sentAt },
      });
      await this.audit.record(tx, {
        envelopeId,
        action: 'ENVELOPE_SENT',
        actorUserId: user.id,
        ipAddress: client.ip,
        userAgent: client.userAgent,
        metadata: {
          recipients: envelope.recipients.length,
          invited: due.length,
          sequential: envelope.sequentialSigning,
          expiresInDays,
        },
      });

      return {
        invited: due.map((recipient) => recipient.id),
        sequential: envelope.sequentialSigning,
        recipientCount: envelope.recipients.length,
      };
    });

    await this.enqueueInvitations(envelopeId, invited);

    this.logger.info(
      {
        envelopeId,
        recipients: recipientCount,
        invited: invited.length,
        sequential,
        expiresInDays,
        durationMs: Math.round(performance.now() - started),
      },
      'Envelope sent',
    );

    return {
      id: envelopeId,
      status: 'SENT',
      sentAt: sentAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      invited: invited.map((id) => ({ id, status: 'SENT' })),
    };
  }

  /**
   * Queues one invitation per person. The send has already committed, so a
   * queue failure is logged for follow-up rather than undoing it: the sender's
   * reminder button re-sends to anyone never emailed.
   */
  async enqueueInvitations(envelopeId: string, recipientIds: readonly string[]): Promise<void> {
    for (const recipientId of recipientIds) {
      try {
        await this.mail.enqueueSigningLink('invitation', envelopeId, recipientId);
      } catch (error) {
        this.logger.error(
          { err: error, alert: true, envelopeId, recipientId },
          'Invitation could not be queued; a reminder will send it',
        );
      }
    }
  }
}
