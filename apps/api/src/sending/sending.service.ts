import {
  checkReadyToSend,
  currentRoutingGroup,
  isOpenEnvelope,
  nextReminderAt,
  type ProblemFieldError,
  REMINDER_COOLDOWN_HOURS,
  type ReadinessIssue,
  type RemindInput,
  type RemindResponse,
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
import { WebhookQueueService } from '../webhooks/webhook-queue.service';

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
    private readonly webhooks: WebhookQueueService,
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
    const reminderIntervalDays =
      input.reminderIntervalDays === undefined
        ? this.config.AUTO_REMINDER_DEFAULT_DAYS || null
        : input.reminderIntervalDays;

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
          reminderIntervalDays,
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
          reminderIntervalDays,
        },
      });

      return {
        invited: due.map((recipient) => recipient.id),
        sequential: envelope.sequentialSigning,
        recipientCount: envelope.recipients.length,
      };
    });

    await this.enqueueInvitations(envelopeId, invited, sentAt);
    await this.webhooks.enqueue(user.tenantId, 'envelope.sent', {
      envelopeId,
      envelopeStatus: 'SENT',
      sentAt: sentAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      recipientCount,
      invitedCount: invited.length,
    });

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
   * POST /envelopes/:id/remind (docs/08). Reminds everyone whose turn it is and
   * who has not finished, or only the people named. Each reminder carries a new
   * link, and the previous one stops working (ADR 0009).
   *
   * One reminder per person per day. Someone whose invitation never reached the
   * mail server is exempt, so this is also how a failed invitation is re-sent.
   */
  async remind(
    envelopeId: string,
    input: RemindInput,
    user: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<RemindResponse> {
    const now = new Date();

    const { reminded, skipped, retryAfterSeconds } = await this.db.$transaction(async (tx) => {
      // Locks the envelope row, so two reminder clicks cannot both get through.
      const locked = await tx.envelope.updateMany({
        where: { id: envelopeId },
        data: { updatedAt: now },
      });
      if (locked.count === 0) throw new AppException('NOT_FOUND', 'Envelope not found.');

      const envelope = await tx.envelope.findUnique({
        where: { id: envelopeId },
        include: { recipients: true, versions: { select: { createdByRecipientId: true } } },
      });
      if (!envelope) throw new AppException('NOT_FOUND', 'Envelope not found.');
      if (envelope.status === 'DRAFT') {
        throw new AppException('CONFLICT', 'This envelope has not been sent yet.');
      }
      // Overdue, whether or not the sweep has paused it yet: a reminder would
      // carry a link that does not work (docs/16 step 6).
      if (
        envelope.status === 'EXPIRED' ||
        (isOpenEnvelope(envelope.status) && envelope.expiresAt && envelope.expiresAt <= now)
      ) {
        this.logger.info({ envelopeId }, 'Reminder refused: envelope expired');
        throw new AppException(
          'ENVELOPE_EXPIRED',
          'This document has passed its deadline. Give more time before sending a reminder.',
        );
      }
      if (!isOpenEnvelope(envelope.status)) {
        throw new AppException('ENVELOPE_TERMINAL', 'This envelope is closed.');
      }

      const byId = new Map(envelope.recipients.map((recipient) => [recipient.id, recipient]));
      const unknown = (input.recipientIds ?? []).filter((id) => !byId.has(id));
      if (unknown.length > 0) throw new AppException('NOT_FOUND', 'Recipient not found.');

      // A signature not yet stamped into a version keeps the turn, so nobody is
      // reminded (or first invited) before they can see it (ADR 0003).
      const stamped = new Set(
        envelope.versions.flatMap((v) => (v.createdByRecipientId ? [v.createdByRecipientId] : [])),
      );
      const turn = new Set(
        currentRoutingGroup(envelope.recipients, envelope.sequentialSigning, stamped).map(
          (r) => r.id,
        ),
      );
      const targets = input.recipientIds ?? [...turn];

      const due: string[] = [];
      const refused: RemindResponse['skipped'] = [];
      let soonest = Number.POSITIVE_INFINITY;
      for (const id of targets) {
        const recipient = byId.get(id);
        if (!recipient) continue;
        if (recipient.status === 'SIGNED' || recipient.status === 'DECLINED') {
          refused.push({ recipientId: id, reason: 'FINISHED' });
        } else if (!turn.has(id)) {
          refused.push({ recipientId: id, reason: 'NOT_THEIR_TURN' });
        } else if (nextReminderAt(recipient) > now.getTime()) {
          refused.push({ recipientId: id, reason: 'TOO_SOON' });
          soonest = Math.min(soonest, nextReminderAt(recipient));
        } else {
          due.push(id);
        }
      }

      if (due.length > 0) {
        await tx.recipient.updateMany({
          where: { envelopeId, id: { in: due } },
          data: { lastRemindedAt: now },
        });
        // Someone whose turn it is but who was never marked invited (a failed
        // queue at send time) is invited now.
        await tx.recipient.updateMany({
          where: { envelopeId, id: { in: due }, status: 'PENDING' },
          data: { status: 'SENT', invitedAt: now },
        });
        for (const recipientId of due) {
          await this.audit.record(tx, {
            envelopeId,
            recipientId,
            action: 'REMINDER_REQUESTED',
            actorUserId: user.id,
            ipAddress: client.ip,
            userAgent: client.userAgent,
          });
        }
      }

      return {
        reminded: due,
        skipped: refused,
        retryAfterSeconds: Number.isFinite(soonest)
          ? Math.max(1, Math.ceil((soonest - now.getTime()) / 1000))
          : undefined,
      };
    });

    if (reminded.length === 0 && retryAfterSeconds !== undefined) {
      this.logger.info(
        { envelopeId, skipped: skipped.length },
        'Reminder refused: sent too recently',
      );
      throw new AppException(
        'REMINDER_TOO_SOON',
        `A reminder was sent in the last ${REMINDER_COOLDOWN_HOURS} hours.`,
        { headers: { 'Retry-After': String(retryAfterSeconds) } },
      );
    }

    try {
      await this.mail.enqueueSigningLinksBulk(
        reminded.map((recipientId) => ({ template: 'reminder' as const, envelopeId, recipientId })),
      );
    } catch (error) {
      this.logger.error({ err: error, alert: true, envelopeId }, 'Reminders could not be queued');
      throw new AppException('SERVICE_UNAVAILABLE', 'The reminder could not be sent. Try again.');
    }

    this.logger.info(
      { envelopeId, reminded: reminded.length, skipped: skipped.length },
      'Reminders requested',
    );
    return { reminded, skipped };
  }

  /**
   * Queues one invitation per person. The send has already committed, so a
   * queue failure is logged for follow-up rather than undoing it: the sender's
   * reminder button re-sends to anyone never emailed.
   */
  async enqueueInvitations(
    envelopeId: string,
    recipientIds: readonly string[],
    invitedAt: Date,
  ): Promise<void> {
    try {
      await this.mail.enqueueSigningLinksBulk(
        recipientIds.map((recipientId) => ({
          template: 'invitation' as const,
          envelopeId,
          recipientId,
          invitedAt,
        })),
      );
    } catch (error) {
      this.logger.error(
        { err: error, alert: true, envelopeId, recipientIds },
        'Invitations could not be queued; a reminder will send them',
      );
    }
  }
}
