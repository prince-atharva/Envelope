import type { LegalHoldInput, LegalHoldResponse } from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser, ClientInfo } from '../auth/auth.types';
import { AppException } from '../common/errors/app-exception';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

/**
 * Legal hold (docs/07, docs/17 step 7): overrides every retention sweep
 * until released. Available whatever the envelope's status — a hold is
 * often placed in anticipation of a dispute, before signing has even
 * finished — so this does not take the envelope-status lock the way a
 * status transition does; it only ever changes three columns.
 */
@Injectable()
export class LegalHoldService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    @InjectPinoLogger(LegalHoldService.name) private readonly logger: PinoLogger,
  ) {}

  async place(
    envelopeId: string,
    input: LegalHoldInput,
    user: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<LegalHoldResponse> {
    const legalHoldAt = new Date();
    const result = await this.tenantPrisma.client.$transaction(async (tx) => {
      const envelope = await tx.envelope.findUnique({
        where: { id: envelopeId },
        select: { id: true, legalHoldAt: true },
      });
      if (!envelope) throw new AppException('NOT_FOUND', 'Envelope not found.');

      await tx.envelope.update({
        where: { id: envelopeId },
        data: { legalHoldAt, legalHoldReason: input.reason, legalHoldByUserId: user.id },
      });
      await this.audit.record(tx, {
        envelopeId,
        action: 'LEGAL_HOLD_PLACED',
        actorUserId: user.id,
        ipAddress: client.ip,
        userAgent: client.userAgent,
        // The reason itself stays out of the audit trail, like a void reason
        // (docs/16 step 3): it is sender-facing text, not evidence.
        metadata: { reasonLength: input.reason.length, replacedExisting: !!envelope.legalHoldAt },
      });
      return { alreadyHeld: !!envelope.legalHoldAt };
    });

    this.logger.info(
      { envelopeId, userId: user.id, replaced: result.alreadyHeld },
      'Legal hold placed',
    );
    return {
      id: envelopeId,
      legalHoldAt: legalHoldAt.toISOString(),
      legalHoldReason: input.reason,
    };
  }

  async release(
    envelopeId: string,
    user: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<LegalHoldResponse> {
    await this.tenantPrisma.client.$transaction(async (tx) => {
      const envelope = await tx.envelope.findUnique({
        where: { id: envelopeId },
        select: { id: true, legalHoldAt: true },
      });
      if (!envelope) throw new AppException('NOT_FOUND', 'Envelope not found.');
      if (!envelope.legalHoldAt) {
        throw new AppException('BAD_REQUEST', 'This document is not on legal hold.');
      }

      await tx.envelope.update({
        where: { id: envelopeId },
        data: { legalHoldAt: null, legalHoldReason: null, legalHoldByUserId: null },
      });
      await this.audit.record(tx, {
        envelopeId,
        action: 'LEGAL_HOLD_RELEASED',
        actorUserId: user.id,
        ipAddress: client.ip,
        userAgent: client.userAgent,
      });
    });

    this.logger.info({ envelopeId, userId: user.id }, 'Legal hold released');
    return { id: envelopeId, legalHoldAt: null, legalHoldReason: null };
  }
}
