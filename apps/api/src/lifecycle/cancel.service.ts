import {
  isTerminalEnvelope,
  receivesSigningLink,
  type VoidEnvelopeInput,
  type VoidEnvelopeResponse,
} from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser, ClientInfo } from '../auth/auth.types';
import { assertCanManage } from '../auth/ownership';
import { AppException } from '../common/errors/app-exception';
import { MailQueueService } from '../mail/mail-queue.service';
import { lockEnvelope } from '../prisma/envelope-locks';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { WebhookQueueService } from '../webhooks/webhook-queue.service';

/**
 * Cancelling a sent envelope, or discarding a draft (docs/16 step 4).
 *
 * Nothing is revoked one link at a time: every signing route already refuses a
 * VOIDED envelope first (the token guardian), a link being minted waits on the
 * envelope lock and then finds it closed, and a seal round finds it no longer
 * sealable. Committing the status is what stops everything.
 */
@Injectable()
export class CancelService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailQueueService,
    private readonly webhooks: WebhookQueueService,
    @InjectPinoLogger(CancelService.name) private readonly logger: PinoLogger,
  ) {}

  async void(
    envelopeId: string,
    input: VoidEnvelopeInput,
    user: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<VoidEnvelopeResponse> {
    const voidedAt = new Date();

    const { fromStatus, notify } = await this.tenantPrisma.client.$transaction(async (tx) => {
      // Through the tenant filter first: the raw lock below is not scoped, so
      // another tenant's envelope must be a 404 before it is ever locked.
      const visible = await tx.envelope.findUnique({
        where: { id: envelopeId },
        select: { id: true, ownerId: true, legalHoldAt: true },
      });
      if (!visible) throw new AppException('NOT_FOUND', 'Envelope not found.');
      assertCanManage(visible.ownerId, user);
      if (visible.legalHoldAt) {
        throw new AppException(
          'ENVELOPE_ON_LEGAL_HOLD',
          'This document is on legal hold and cannot be cancelled. Release the hold first.',
        );
      }

      // Waits for any signature, decline, link or seal holding the envelope,
      // then sees the status they left behind.
      const status = await lockEnvelope(tx, envelopeId);
      if (!status) throw new AppException('NOT_FOUND', 'Envelope not found.');
      if (isTerminalEnvelope(status)) {
        this.logger.info({ envelopeId, status }, 'Cancel refused: envelope already closed');
        throw new AppException('ENVELOPE_TERMINAL', closedDetail(status), { reason: status });
      }

      const discarded = status === 'DRAFT';
      const reason = input.reason ?? null;
      if (!discarded && !reason) {
        throw new AppException('VALIDATION_FAILED', 'Give a reason for cancelling.', {
          errors: [{ path: 'reason', message: 'Tell the people you sent it to why.' }],
        });
      }

      await tx.envelope.update({
        where: { id: envelopeId },
        data: { status: 'VOIDED', voidedAt, voidReason: reason, voidedByUserId: user.id },
      });
      await this.audit.record(tx, {
        envelopeId,
        action: 'ENVELOPE_VOIDED',
        actorUserId: user.id,
        ipAddress: client.ip,
        userAgent: client.userAgent,
        // The reason itself stays out of the audit trail (docs/16 step 3).
        metadata: discarded
          ? { fromStatus: status, discarded: true }
          : { fromStatus: status, reasonLength: reason?.length ?? 0 },
      });

      const recipients = discarded
        ? []
        : await tx.recipient.findMany({
            where: { envelopeId },
            select: { id: true, role: true },
          });
      return {
        fromStatus: status,
        notify: recipients.filter((r) => receivesSigningLink(r.role)).map((r) => r.id),
      };
    });

    // After commit. A queue failure is not a reason to undo the cancel: the
    // links are already dead, and only the courtesy email is lost.
    let queued = 0;
    try {
      await this.mail.enqueueVoidedBulk(notify.map((recipientId) => ({ envelopeId, recipientId })));
      queued = notify.length;
    } catch (error) {
      this.logger.error(
        { err: error, alert: true, envelopeId, recipientCount: notify.length },
        'Cancellation notices could not be queued',
      );
    }

    await this.webhooks.enqueue(user.tenantId, 'envelope.voided', {
      envelopeId,
      envelopeStatus: 'VOIDED',
      voidedAt: voidedAt.toISOString(),
      fromStatus,
    });

    const discarded = fromStatus === 'DRAFT';
    this.logger.info(
      { envelopeId, fromStatus, discarded, notices: queued },
      discarded ? 'Draft discarded' : 'Envelope cancelled',
    );
    return { id: envelopeId, status: 'VOIDED', voidedAt: voidedAt.toISOString(), discarded };
  }
}

function closedDetail(status: string): string {
  switch (status) {
    case 'COMPLETED':
      return 'This document is already signed by everyone, so it cannot be cancelled.';
    case 'DECLINED':
      return 'This document was declined, so it is already closed.';
    default:
      return 'This document is already cancelled.';
  }
}
