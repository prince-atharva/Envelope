import {
  type ExtendEnvelopeInput,
  type ExtendEnvelopeResponse,
  isTerminalEnvelope,
  receivesSigningLink,
} from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser, ClientInfo } from '../auth/auth.types';
import { AppException } from '../common/errors/app-exception';
import { MailQueueService } from '../mail/mail-queue.service';
import { lockEnvelope } from '../prisma/envelope-locks';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { SealQueueService } from '../sealing/seal-queue.service';

const DAY_MS = 24 * 3600 * 1000;
/** Invited and not finished: the people whose turn it is. */
const AWAITING = ['SENT', 'DELIVERED', 'VIEWED'] as const;

/**
 * Giving an envelope more time (docs/16 step 7, ADR 0013). Works before the
 * deadline, and after it, when it reopens an envelope the sweep paused.
 *
 * The routing does not move here: signatures made before the deadline are
 * stamped, and the next people invited, by the seal worker's resume job, so an
 * extension never races a stamping round.
 */
@Injectable()
export class ExtendService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailQueueService,
    private readonly seal: SealQueueService,
    @InjectPinoLogger(ExtendService.name) private readonly logger: PinoLogger,
  ) {}

  async extend(
    envelopeId: string,
    input: ExtendEnvelopeInput,
    user: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<ExtendEnvelopeResponse> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.expiresInDays * DAY_MS);

    const result = await this.tenantPrisma.client.$transaction(async (tx) => {
      // Tenant-scoped first: the raw lock below is not.
      const visible = await tx.envelope.findUnique({
        where: { id: envelopeId },
        select: { id: true },
      });
      if (!visible) throw new AppException('NOT_FOUND', 'Envelope not found.');

      const status = await lockEnvelope(tx, envelopeId);
      if (!status) throw new AppException('NOT_FOUND', 'Envelope not found.');
      if (status === 'DRAFT') {
        throw new AppException('CONFLICT', 'This envelope has not been sent yet.');
      }
      if (isTerminalEnvelope(status)) {
        this.logger.info({ envelopeId, status }, 'Extend refused: envelope closed');
        throw new AppException('ENVELOPE_TERMINAL', 'This document is closed.', {
          reason: status,
        });
      }

      const envelope = await tx.envelope.findUnique({
        where: { id: envelopeId },
        include: { recipients: true },
      });
      if (!envelope) throw new AppException('NOT_FOUND', 'Envelope not found.');

      const resumed = status === 'EXPIRED';
      const anyoneSigned = envelope.recipients.some(
        (r) => receivesSigningLink(r.role) && r.status === 'SIGNED',
      );
      const toStatus = resumed ? (anyoneSigned ? 'PARTIALLY_SIGNED' : 'SENT') : status;

      await tx.envelope.update({
        where: { id: envelopeId },
        data: { expiresAt, status: toStatus },
      });
      // A link that still works keeps working to the new deadline, in case the
      // new email is slow (ADR 0013, amending ADR 0009).
      await tx.recipient.updateMany({
        where: { envelopeId, tokenHash: { not: null }, tokenUsedAt: null },
        data: { tokenExpiresAt: expiresAt },
      });
      // A new deadline gets its own "expires soon" email.
      await tx.recipient.updateMany({
        where: { envelopeId, expiryWarnedAt: { not: null } },
        data: { expiryWarnedAt: null },
      });
      await this.audit.record(tx, {
        envelopeId,
        action: 'ENVELOPE_EXTENDED',
        actorUserId: user.id,
        ipAddress: client.ip,
        userAgent: client.userAgent,
        metadata: {
          fromStatus: status,
          toStatus,
          previousExpiresAt: envelope.expiresAt?.toISOString() ?? null,
          expiresAt: expiresAt.toISOString(),
          expiresInDays: input.expiresInDays,
        },
      });

      const notify = envelope.recipients
        .filter(
          (r) =>
            receivesSigningLink(r.role) &&
            !r.tokenUsedAt &&
            (AWAITING as readonly string[]).includes(r.status),
        )
        .map((r) => r.id);
      return { resumed, toStatus, previousExpiresAt: envelope.expiresAt, notify };
    });

    // After commit. A failed email is logged; the sender can remind them.
    for (const recipientId of result.notify) {
      try {
        await this.mail.enqueueSigningLink('extended', envelopeId, recipientId);
      } catch (error) {
        this.logger.error(
          { err: error, alert: true, envelopeId, recipientId },
          'Extension email could not be queued; a reminder will send it',
        );
      }
    }
    if (result.resumed) {
      try {
        await this.seal.enqueueResume(envelopeId, now);
      } catch (error) {
        // Signatures made before the deadline stay unstamped until the next
        // signature or extension queues a seal job.
        this.logger.error(
          { err: error, alert: true, envelopeId },
          'Resume seal job could not be queued',
        );
      }
    }

    this.logger.info(
      {
        envelopeId,
        resumed: result.resumed,
        toStatus: result.toStatus,
        expiresInDays: input.expiresInDays,
        notified: result.notify.length,
      },
      result.resumed ? 'Expired envelope extended and resumed' : 'Envelope deadline extended',
    );
    return {
      id: envelopeId,
      status: result.toStatus,
      expiresAt: expiresAt.toISOString(),
      previousExpiresAt: result.previousExpiresAt?.toISOString() ?? null,
      resumed: result.resumed,
      notified: result.notify,
    };
  }
}
