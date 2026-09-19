import { OPEN_ENVELOPE_STATUSES } from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditService, SYSTEM_ACTOR } from '../audit/audit.service';
import { MailQueueService } from '../mail/mail-queue.service';
import { lockEnvelope } from '../prisma/envelope-locks';
import { PrismaService } from '../prisma/prisma.service';

/** Envelopes paused per run. Any more wait for the next run, a few minutes later. */
const SWEEP_BATCH = 200;

/** What one maintenance run did, for its summary log line. */
export interface SweepResult {
  scanned: number;
  changed: number;
  failed: number;
  /** Problems found rather than fixed: audit chains that do not check out. */
  broken?: number;
}

type Outcome =
  | { expired: true; expiredAt: Date; unsigned: number }
  | { expired: false; reason: string };

/**
 * Pauses envelopes whose deadline has passed with signatures missing (ADR 0013).
 *
 * Runs can overlap: a stalled job runs again, or several workers share the
 * schedule. Each envelope is therefore claimed under its row lock and checked
 * again there, so it is expired once, with one audit event and one email.
 */
@Injectable()
export class ExpirySweepService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailQueueService,
    @InjectPinoLogger(ExpirySweepService.name) private readonly logger: PinoLogger,
  ) {}

  async run(now = new Date()): Promise<SweepResult> {
    const candidates = await this.prisma.envelope.findMany({
      where: { status: { in: [...OPEN_ENVELOPE_STATUSES] }, expiresAt: { lte: now } },
      select: { id: true },
      orderBy: { expiresAt: 'asc' },
      take: SWEEP_BATCH,
    });

    let changed = 0;
    let failed = 0;
    for (const { id } of candidates) {
      try {
        const outcome = await this.expire(id, now);
        if (!outcome.expired) {
          this.logger.debug({ envelopeId: id, reason: outcome.reason }, 'Envelope not expired');
          continue;
        }
        changed += 1;
        this.logger.info({ envelopeId: id, unsigned: outcome.unsigned }, 'Envelope expired');
        await this.notifySender(id, outcome.expiredAt);
      } catch (error) {
        failed += 1;
        this.logger.error({ err: error, envelopeId: id }, 'Envelope could not be expired');
      }
    }
    return { scanned: candidates.length, changed, failed };
  }

  private expire(envelopeId: string, now: Date): Promise<Outcome> {
    return this.prisma.$transaction(async (tx) => {
      const status = await lockEnvelope(tx, envelopeId);
      if (!status || !(OPEN_ENVELOPE_STATUSES as readonly string[]).includes(status)) {
        return { expired: false, reason: `now ${status?.toLowerCase() ?? 'gone'}` };
      }
      // Read under the lock: an extension may have moved the deadline since
      // the candidates were listed.
      const envelope = await tx.envelope.findUnique({
        where: { id: envelopeId },
        select: { expiresAt: true },
      });
      if (!envelope?.expiresAt || envelope.expiresAt > now) {
        return { expired: false, reason: 'deadline moved' };
      }

      const unsigned = await tx.recipient.count({
        where: {
          envelopeId,
          role: { in: ['SIGNER', 'APPROVER'] },
          status: { notIn: ['SIGNED', 'DECLINED'] },
        },
      });
      // Everyone signed in time; the seal is still to run. Not overdue.
      if (unsigned === 0) return { expired: false, reason: 'everyone signed' };

      await tx.envelope.update({
        where: { id: envelopeId },
        data: { status: 'EXPIRED', expiredAt: now },
      });
      await this.audit.record(tx, {
        envelopeId,
        action: 'ENVELOPE_EXPIRED',
        ...SYSTEM_ACTOR,
        metadata: { unsigned, fromStatus: status },
      });
      return { expired: true, expiredAt: now, unsigned };
    });
  }

  /** After commit. A queue failure loses only the email; the envelope page shows it expired. */
  private async notifySender(envelopeId: string, expiredAt: Date): Promise<void> {
    try {
      await this.mail.enqueueExpired(envelopeId, expiredAt);
    } catch (error) {
      this.logger.error(
        { err: error, alert: true, envelopeId },
        'Expiry notice could not be queued',
      );
    }
  }
}
