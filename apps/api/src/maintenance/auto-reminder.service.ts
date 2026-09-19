import { OPEN_ENVELOPE_STATUSES } from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditService, SYSTEM_ACTOR } from '../audit/audit.service';
import { AppConfig } from '../config/app-config';
import { MailQueueService } from '../mail/mail-queue.service';
import { lockOpenEnvelope } from '../prisma/envelope-locks';
import { PrismaService } from '../prisma/prisma.service';
import { type AutomaticEmail, automaticEmailFor, RECENTLY_SEEN_MS } from './auto-reminder-rules';
import type { SweepResult } from './expiry-sweep.service';

/** People emailed per run. Any more wait for the next run. */
const REMINDER_BATCH = 500;
/** Invited and not finished: the people whose turn it is. */
const AWAITING = ['SENT', 'DELIVERED', 'VIEWED'] as const;

/**
 * Automatic reminders and the "expires soon" email (docs/16 step 10).
 *
 * The query only picks people who could be due, oldest contact first, so
 * people not yet due never fill a batch. Each one is then decided again under
 * the envelope's lock and claimed with a compare-and-set on lastRemindedAt, so
 * overlapping runs email a person once. Setting lastRemindedAt also makes the
 * sender's own Remind button wait a day after an automatic email.
 */
@Injectable()
export class AutoReminderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailQueueService,
    private readonly config: AppConfig,
    @InjectPinoLogger(AutoReminderService.name) private readonly logger: PinoLogger,
  ) {}

  async run(now = new Date()): Promise<SweepResult> {
    const at = now.toISOString();
    const seenBefore = new Date(now.getTime() - RECENTLY_SEEN_MS).toISOString();
    const warningHours = this.config.EXPIRY_WARNING_HOURS;
    // Timestamps are stored as UTC without a zone, so `now` is converted
    // explicitly, as the envelope locks do.
    const candidates = await this.prisma.$queryRaw<{ id: string; envelopeId: string }[]>`
      SELECT r.id, r."envelopeId"
        FROM "Recipient" r
        JOIN "Envelope" e ON e.id = r."envelopeId"
       WHERE e.status::text = ANY(${[...OPEN_ENVELOPE_STATUSES]}::text[])
         AND e."reminderIntervalDays" IS NOT NULL
         AND e."expiresAt" > (${at}::timestamptz AT TIME ZONE 'UTC')
         AND r.role::text IN ('SIGNER', 'APPROVER')
         AND r.status::text = ANY(${[...AWAITING]}::text[])
         AND r."tokenUsedAt" IS NULL
         AND (r."lastSeenAt" IS NULL
              OR r."lastSeenAt" <= (${seenBefore}::timestamptz AT TIME ZONE 'UTC'))
         AND GREATEST(r."invitedAt", r."notifiedAt", r."lastRemindedAt") IS NOT NULL
         AND (
           GREATEST(r."invitedAt", r."notifiedAt", r."lastRemindedAt")
             <= (${at}::timestamptz AT TIME ZONE 'UTC') - e."reminderIntervalDays" * interval '1 day'
           OR (r."expiryWarnedAt" IS NULL
               AND e."expiresAt" <= (${at}::timestamptz AT TIME ZONE 'UTC')
                                    + ${warningHours} * interval '1 hour')
         )
       ORDER BY GREATEST(r."invitedAt", r."notifiedAt", r."lastRemindedAt") ASC
       LIMIT ${REMINDER_BATCH}`;

    let changed = 0;
    let failed = 0;
    for (const { id, envelopeId } of candidates) {
      try {
        const kind = await this.claim(envelopeId, id, now, warningHours);
        if (!kind) continue;
        changed += 1;
        await this.send(kind, envelopeId, id);
      } catch (error) {
        failed += 1;
        this.logger.error({ err: error, envelopeId, recipientId: id }, 'Automatic reminder failed');
      }
    }
    return { scanned: candidates.length, changed, failed };
  }

  /** Decides again under the envelope lock, then claims the person. */
  private claim(
    envelopeId: string,
    recipientId: string,
    now: Date,
    warningHours: number,
  ): Promise<AutomaticEmail | null> {
    return this.prisma.$transaction(async (tx) => {
      // Open and within its deadline, held until commit: a cancel or the
      // expiry sweep cannot slip in between the decision and the claim.
      if (!(await lockOpenEnvelope(tx, envelopeId, now))) return null;
      const recipient = await tx.recipient.findFirst({
        where: { id: recipientId, envelopeId },
        include: { envelope: { select: { reminderIntervalDays: true, expiresAt: true } } },
      });
      if (!recipient) return null;
      const kind = automaticEmailFor(recipient, recipient.envelope, now, warningHours);
      if (!kind) return null;

      const claimed = await tx.recipient.updateMany({
        where: {
          id: recipientId,
          lastRemindedAt: recipient.lastRemindedAt,
          status: { in: [...AWAITING] },
          tokenUsedAt: null,
        },
        data: {
          lastRemindedAt: now,
          ...(kind === 'expiry-warning' ? { expiryWarnedAt: now } : {}),
        },
      });
      if (claimed.count === 0) return null;
      await this.audit.record(tx, {
        envelopeId,
        recipientId,
        action: 'REMINDER_SCHEDULED',
        ...SYSTEM_ACTOR,
        metadata: { kind },
      });
      return kind;
    });
  }

  /** After commit. A queue failure loses one email; the next interval sends another. */
  private async send(kind: AutomaticEmail, envelopeId: string, recipientId: string) {
    try {
      await this.mail.enqueueSigningLink(
        kind === 'interval' ? 'reminder' : 'expiry-warning',
        envelopeId,
        recipientId,
      );
      this.logger.info({ envelopeId, recipientId, kind }, 'Automatic reminder queued');
    } catch (error) {
      this.logger.error(
        { err: error, alert: true, envelopeId, recipientId, kind },
        'Automatic reminder could not be queued',
      );
    }
  }
}
