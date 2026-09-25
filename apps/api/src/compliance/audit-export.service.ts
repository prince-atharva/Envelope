import type { AuditExportDocument, AuditExportEvent } from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { verifyChain } from '../audit/audit-chain';
import type { AuthenticatedUser, ClientInfo } from '../auth/auth.types';
import { AppException } from '../common/errors/app-exception';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

/**
 * Audit export (docs/17 step 9, AUD-06). JSON carries everything
 * `verifyChain()` needs, so someone with only the file — no access to this
 * platform — can recompute the chain themselves. Reuses the exact chain
 * logic the nightly check uses (audit/audit-chain.ts), rather than a second
 * implementation that could quietly drift from it.
 */
@Injectable()
export class AuditExportService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    @InjectPinoLogger(AuditExportService.name) private readonly logger: PinoLogger,
  ) {}

  async export(
    envelopeId: string,
    user: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<AuditExportDocument> {
    // Tenant-scoped: confirms the envelope is this tenant's before the
    // unscoped AuditTrail read below.
    const envelope = await this.tenantPrisma.client.envelope.findUnique({
      where: { id: envelopeId },
      select: { id: true },
    });
    if (!envelope) throw new AppException('NOT_FOUND', 'Envelope not found.');

    const rows = await this.tenantPrisma.client.auditTrail.findMany({
      where: { envelopeId },
      orderBy: { sequence: 'asc' },
    });
    const verification = verifyChain(rows);

    const events: AuditExportEvent[] = rows.map((row) => ({
      sequence: row.sequence,
      action: row.action,
      timestamp: row.timestamp.toISOString(),
      actorUserId: row.actorUserId,
      recipientId: row.recipientId,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      metadata: row.metadata,
      prevHash: row.prevHash,
      eventHash: row.eventHash,
    }));

    await this.tenantPrisma.client.$transaction((tx) =>
      this.audit.record(tx, {
        envelopeId,
        action: 'AUDIT_EXPORTED',
        actorUserId: user.id,
        ipAddress: client.ip,
        userAgent: client.userAgent,
        metadata: { eventCount: events.length, valid: verification.valid },
      }),
    );

    this.logger.info(
      { envelopeId, userId: user.id, eventCount: events.length, valid: verification.valid },
      'Audit trail exported',
    );

    return {
      envelopeId,
      exportedAt: new Date().toISOString(),
      algorithm: 'SHA-256(prevHash | action | timestamp | canonicalJson(payload))',
      events,
      verification: verification.valid
        ? { valid: true }
        : {
            valid: false,
            brokenAtSequence: verification.brokenAt.sequence,
            reason: verification.brokenAt.reason,
          },
    };
  }
}

const CSV_COLUMNS = [
  'sequence',
  'action',
  'timestamp',
  'actorUserId',
  'recipientId',
  'ipAddress',
  'userAgent',
  'metadata',
] as const;

function csvField(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The human/disclosure format: the same rows, without the hashes (docs/17 step 9). */
export function toCsv(doc: AuditExportDocument): string {
  const header = CSV_COLUMNS.join(',');
  const rows = doc.events.map((event) =>
    CSV_COLUMNS.map((column) =>
      csvField(column === 'metadata' ? JSON.stringify(event.metadata ?? null) : event[column]),
    ).join(','),
  );
  return [header, ...rows].join('\n');
}
