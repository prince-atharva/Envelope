import { randomUUID } from 'node:crypto';
import { DRAFT_RETENTION_DAYS, VOIDED_RETENTION_DAYS } from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditService, SYSTEM_ACTOR } from '../audit/audit.service';
import { lockEnvelope } from '../prisma/envelope-locks';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { SweepResult } from './expiry-sweep.service';

/** Envelopes purged per run. Any more wait for the next run. */
const SWEEP_BATCH = 200;
const DAY_MS = 24 * 3600 * 1000;

/**
 * Removes storage objects from an old, unsent draft or a cancelled/declined
 * envelope; never touches a completed envelope's sealed file (Object Lock
 * forbids it before its own retention date) and never touches `AuditTrail`
 * (ADR 0014). A legal hold excludes an envelope from every run.
 */
@Injectable()
export class RetentionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    @InjectPinoLogger(RetentionService.name) private readonly logger: PinoLogger,
  ) {}

  async run(now = new Date()): Promise<SweepResult> {
    const draftCutoff = new Date(now.getTime() - DRAFT_RETENTION_DAYS * DAY_MS);
    const voidedCutoff = new Date(now.getTime() - VOIDED_RETENTION_DAYS * DAY_MS);

    // The retention_candidates partial index (status, updatedAt) excludes
    // held and already-purged rows; this OR still needs two different
    // cutoffs, one per status family, so it cannot be a single range scan —
    // acceptable, since each branch alone hits the index directly.
    const candidates = await this.prisma.envelope.findMany({
      where: {
        purgedAt: null,
        legalHoldAt: null,
        OR: [
          { status: 'DRAFT', updatedAt: { lte: draftCutoff } },
          { status: { in: ['VOIDED', 'DECLINED'] }, updatedAt: { lte: voidedCutoff } },
        ],
      },
      select: { id: true },
      orderBy: { updatedAt: 'asc' },
      take: SWEEP_BATCH,
    });

    let changed = 0;
    let failed = 0;
    for (const { id } of candidates) {
      try {
        const purged = await this.purge(id, now);
        if (purged) {
          changed += 1;
          this.logger.info({ envelopeId: id, ...purged }, 'Envelope purged');
        }
      } catch (error) {
        failed += 1;
        this.logger.error({ err: error, envelopeId: id }, 'Envelope could not be purged');
      }
    }
    return { scanned: candidates.length, changed, failed };
  }

  private async purge(
    envelopeId: string,
    now: Date,
  ): Promise<{ objectsDeleted: number; recipientsPseudonymised: number } | null> {
    // Re-checked under the row lock: a hold placed after this envelope was
    // listed as a candidate must still stop the purge.
    const claim = await this.prisma.$transaction(async (tx) => {
      const status = await lockEnvelope(tx, envelopeId);
      if (!status || !['DRAFT', 'VOIDED', 'DECLINED'].includes(status)) return null;
      const envelope = await tx.envelope.findUnique({
        where: { id: envelopeId },
        select: {
          purgedAt: true,
          legalHoldAt: true,
          versions: { select: { fileUrl: true, isFinal: true } },
          recipients: { select: { id: true, signatureImageKey: true, initialsImageKey: true } },
        },
      });
      if (!envelope || envelope.purgedAt || envelope.legalHoldAt) return null;

      await tx.envelope.update({ where: { id: envelopeId }, data: { purgedAt: now } });
      for (const recipient of envelope.recipients) {
        await tx.recipient.update({
          where: { id: recipient.id },
          data: { name: 'Removed', email: `purged-${randomUUID()}@removed.invalid` },
        });
      }
      await this.audit.record(tx, {
        envelopeId,
        action: 'ENVELOPE_PURGED',
        ...SYSTEM_ACTOR,
        metadata: {
          fromStatus: status,
          versionCount: envelope.versions.length,
          recipientCount: envelope.recipients.length,
        },
      });
      return envelope;
    });
    if (!claim) return null;

    // After commit: storage deletes are not transactional with the database,
    // so the row is marked purged first — a failed delete here is retried
    // by never being skipped (purgedAt is already set, so this envelope is
    // no longer a candidate; a stray object left behind is a leak to clean
    // up by hand, not a repeat of the sweep, which is the safer failure mode
    // for something that must never delete an envelope's evidence twice).
    let objectsDeleted = 0;
    for (const version of claim.versions) {
      if (version.isFinal) continue; // never reachable in practice; guarded anyway
      await this.storage.delete(version.fileUrl).then(
        () => {
          objectsDeleted += 1;
        },
        (error: unknown) => {
          this.logger.warn(
            { err: error, envelopeId, key: version.fileUrl },
            'Storage object could not be deleted',
          );
        },
      );
    }
    for (const recipient of claim.recipients) {
      for (const key of [recipient.signatureImageKey, recipient.initialsImageKey]) {
        if (!key) continue;
        await this.storage.delete(key).then(
          () => {
            objectsDeleted += 1;
          },
          (error: unknown) => {
            this.logger.warn(
              { err: error, envelopeId, key },
              'Storage object could not be deleted',
            );
          },
        );
      }
    }

    return { objectsDeleted, recipientsPseudonymised: claim.recipients.length };
  }
}
