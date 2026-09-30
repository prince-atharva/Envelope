import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditService, SYSTEM_ACTOR } from '../audit/audit.service';
import { MailQueueService } from '../mail/mail-queue.service';
import { lockEnvelope } from '../prisma/envelope-locks';
import { PrismaService } from '../prisma/prisma.service';
import type { MailEvent } from './mail-event-adapters';

export type MailEventOutcome = 'recorded' | 'ignored';

/**
 * Records what a mail provider reports about a message we sent (docs/20, ADR 0029).
 * The audit trail only ever gains a row; `MailDelivery` holds the current state.
 *
 * Nothing here reveals whether a message id exists: an id we never sent is
 * answered exactly like one we did.
 */
@Injectable()
export class MailEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailQueueService,
    @InjectPinoLogger(MailEventsService.name) private readonly logger: PinoLogger,
  ) {}

  async record(event: MailEvent): Promise<MailEventOutcome> {
    const delivery = await this.prisma.mailDelivery.findUnique({
      where: { messageId: event.messageId },
    });
    if (!delivery) {
      this.logger.debug({ type: event.type }, 'Mail event for a message we have no record of');
      return 'ignored';
    }

    const changed = await this.prisma.$transaction(async (tx) => {
      // Before the audit lock: docs/18, workstream 11 (audit lock order).
      await lockEnvelope(tx, delivery.envelopeId);
      // Only a message still marked SENT can be claimed, so a repeat, and a complaint after a
      // bounce, change nothing: providers deliver at least once.
      const claimed = await tx.mailDelivery.updateMany({
        where: { id: delivery.id, status: 'SENT' },
        data: { status: event.type },
      });
      if (claimed.count === 0) return false;
      await this.audit.record(tx, {
        envelopeId: delivery.envelopeId,
        recipientId: delivery.recipientId ?? undefined,
        action: event.type === 'BOUNCED' ? 'EMAIL_BOUNCED' : 'EMAIL_COMPLAINED',
        ...SYSTEM_ACTOR,
        // The provider's own explanation often repeats the address, so it stays out of the trail.
        metadata: { kind: delivery.template },
      });
      return true;
    });
    if (!changed) {
      this.logger.debug(
        { deliveryId: delivery.id, type: event.type },
        'Mail event already recorded',
      );
      return 'ignored';
    }

    this.logger.warn(
      {
        envelopeId: delivery.envelopeId,
        recipientId: delivery.recipientId,
        deliveryId: delivery.id,
        kind: delivery.template,
      },
      event.type === 'BOUNCED' ? 'Mail delivery bounced' : 'Mail delivery complained',
    );
    // After the commit, like every other job (AGENTS.md): the sender is told.
    if (delivery.recipientId) {
      await this.mail.enqueueDeliveryFailedNotice(
        delivery.envelopeId,
        delivery.recipientId,
        delivery.id,
      );
    }
    return 'recorded';
  }
}
