import type { ReminderSettingsInput, ReminderSettingsResponse } from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser, ClientInfo } from '../auth/auth.types';
import { assertCanManage } from '../auth/ownership';
import { AppException } from '../common/errors/app-exception';
import { lockEnvelope } from '../prisma/envelope-locks';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { canChangeReminders } from './reminder-rules';

/**
 * Turning automatic reminders on or off, or changing how often, after sending
 * (docs/16 step 10). A draft's choice is made in the send dialog instead.
 */
@Injectable()
export class ReminderSettingsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    @InjectPinoLogger(ReminderSettingsService.name) private readonly logger: PinoLogger,
  ) {}

  async update(
    envelopeId: string,
    input: ReminderSettingsInput,
    user: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<ReminderSettingsResponse> {
    const from = await this.tenantPrisma.client.$transaction(async (tx) => {
      const envelope = await tx.envelope.findUnique({
        where: { id: envelopeId },
        select: { reminderIntervalDays: true, ownerId: true },
      });
      if (!envelope) throw new AppException('NOT_FOUND', 'Envelope not found.');
      assertCanManage(envelope.ownerId, user);

      const status = await lockEnvelope(tx, envelopeId);
      if (!status) throw new AppException('NOT_FOUND', 'Envelope not found.');
      if (status === 'DRAFT') {
        throw new AppException('CONFLICT', 'Choose reminders when you send it.');
      }
      if (!canChangeReminders(status)) {
        throw new AppException('ENVELOPE_TERMINAL', 'This document is closed.', {
          reason: status,
        });
      }
      if (envelope.reminderIntervalDays === input.intervalDays)
        return envelope.reminderIntervalDays;

      await tx.envelope.update({
        where: { id: envelopeId },
        data: { reminderIntervalDays: input.intervalDays },
      });
      await this.audit.record(tx, {
        envelopeId,
        action: 'REMINDERS_CHANGED',
        actorUserId: user.id,
        ipAddress: client.ip,
        userAgent: client.userAgent,
        metadata: { from: envelope.reminderIntervalDays, to: input.intervalDays },
      });
      return envelope.reminderIntervalDays;
    });

    if (from !== input.intervalDays) {
      this.logger.info(
        { envelopeId, from, to: input.intervalDays },
        'Automatic reminder settings changed',
      );
    }
    return { id: envelopeId, reminderIntervalDays: input.intervalDays };
  }
}
