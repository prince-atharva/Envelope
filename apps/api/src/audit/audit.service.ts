import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { AuditTrail, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { type ChainVerification, computeEventHash, verifyChain } from './audit-chain';

/**
 * The part of a transaction client the audit writer needs. Narrow on purpose, so
 * both the plain and the tenant-scoped client's transactions satisfy it.
 */
export interface AuditTransaction {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<number>;
  auditTrail: {
    findFirst(args: {
      where: { envelopeId: string };
      orderBy: { sequence: 'desc' };
      select: { sequence: true; eventHash: true };
    }): PromiseLike<{ sequence: number; eventHash: string } | null>;
    create(args: { data: Prisma.AuditTrailUncheckedCreateInput }): PromiseLike<AuditTrail>;
  };
}

/**
 * Every audit action the system records. Extended as later phases add events.
 *
 * Draft events (everything but ENVELOPE_CREATED here) never fill the
 * `recipientId` COLUMN, because that foreign key is RESTRICT and would make the
 * recipient impossible to remove from the draft. The id goes in `metadata`.
 */
export type AuditAction =
  | 'ENVELOPE_CREATED'
  | 'ENVELOPE_UPDATED'
  | 'RECIPIENT_ADDED'
  | 'RECIPIENT_UPDATED'
  | 'RECIPIENT_REMOVED'
  | 'FIELDS_SAVED';

export interface AuditEventInput {
  envelopeId: string;
  action: AuditAction;
  ipAddress: string;
  userAgent: string;
  recipientId?: string;
  actorUserId?: string;
  metadata?: Prisma.InputJsonObject;
}

/**
 * The append-only, hash-chained audit trail (docs/05). Events are written inside
 * the caller's transaction, so an event and the change it records commit
 * together or not at all. The database role cannot update or delete them.
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(AuditService.name) private readonly logger: PinoLogger,
  ) {}

  async record(tx: AuditTransaction, input: AuditEventInput): Promise<AuditTrail> {
    try {
      // Serialise writers per envelope so two events can never claim the same place in the chain.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.envelopeId}, 0))`;

      const previous = await tx.auditTrail.findFirst({
        where: { envelopeId: input.envelopeId },
        orderBy: { sequence: 'desc' },
        select: { sequence: true, eventHash: true },
      });

      const fields = {
        envelopeId: input.envelopeId,
        sequence: (previous?.sequence ?? 0) + 1,
        action: input.action,
        timestamp: new Date(),
        recipientId: input.recipientId ?? null,
        actorUserId: input.actorUserId ?? null,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        metadata: input.metadata ?? null,
      };
      const prevHash = previous?.eventHash ?? null;
      const eventHash = computeEventHash(prevHash, fields);

      const event = await tx.auditTrail.create({
        data: { ...fields, metadata: input.metadata, prevHash, eventHash },
      });
      this.logger.info(
        {
          envelopeId: event.envelopeId,
          action: event.action,
          sequence: event.sequence,
          eventHash: event.eventHash,
        },
        'Audit event recorded',
      );
      return event;
    } catch (error) {
      // An audit write failure means the evidence trail is at risk: page someone.
      this.logger.error(
        { err: error, alert: true, envelopeId: input.envelopeId, action: input.action },
        'Audit event could not be recorded',
      );
      throw error;
    }
  }

  /** Recomputes an envelope's chain. Breaks are logged as errors with `alert: true`. */
  async verify(envelopeId: string): Promise<ChainVerification> {
    const events = await this.prisma.auditTrail.findMany({
      where: { envelopeId },
      orderBy: { sequence: 'asc' },
    });
    const result = verifyChain(events);
    if (!result.valid) {
      this.logger.error(
        { alert: true, envelopeId, brokenAt: result.brokenAt },
        'Audit chain verification failed',
      );
    }
    return result;
  }
}
