import { type TemplatePerson, templatePersonSchema } from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { z } from 'zod';
import type { AuthenticatedUser, ClientInfo } from '../auth/auth.types';
import { AppException } from '../common/errors/app-exception';
import { type BulkBatch, type BulkBatchRow, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SendingService } from '../sending/sending.service';
import { TemplatesService } from '../templates/templates.service';

/** Pending rows read at a time. */
const PAGE = 25;

const peopleSchema = z.array(templatePersonSchema);

/**
 * Worker side of bulk send (docs/20, ADR 0028): creates, and sends if asked, the
 * envelope of each pending row of a batch, one row at a time.
 *
 * A row fails alone. A retried job, or a crashed one picked up again, only
 * touches rows that are still PENDING; a row whose envelope is already made
 * (its id was written in the creating transaction) is only sent.
 */
@Injectable()
export class BulkRunner {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
    private readonly templates: TemplatesService,
    private readonly sending: SendingService,
    @InjectPinoLogger(BulkRunner.name) private readonly logger: PinoLogger,
  ) {}

  async run(batchId: string): Promise<void> {
    const started = performance.now();
    const batch = await this.prisma.bulkBatch.findUnique({
      where: { id: batchId },
      include: { createdBy: { select: { role: true } } },
    });
    if (!batch) {
      this.logger.warn({ batchId }, 'Bulk job for a batch that no longer exists');
      return;
    }
    if (batch.status === 'COMPLETED') return;

    const template = await this.prisma.template.findUnique({
      where: { id: batch.templateId },
      select: { reminderIntervalDays: true },
    });
    const user: AuthenticatedUser = {
      id: batch.createdById,
      tenantId: batch.tenantId,
      sessionId: `bulk:${batch.id}`,
      role: batch.createdBy.role,
    };
    const client: ClientInfo = { ip: batch.clientIp, userAgent: batch.clientUserAgent };
    const reminderIntervalDays = template?.reminderIntervalDays ?? null;

    this.logger.info(
      { batchId, tenantId: batch.tenantId, totalRows: batch.totalRows },
      'Bulk batch started',
    );
    for (;;) {
      const rows = await this.prisma.bulkBatchRow.findMany({
        where: { batchId, status: 'PENDING' },
        orderBy: { rowIndex: 'asc' },
        take: PAGE,
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        // The tenant-scoped services read the tenant from the request context;
        // a job has none, so each row runs in its own.
        await this.cls.run(async () => {
          this.cls.set('tenantId', batch.tenantId);
          await this.processRow(batch, row, user, client, reminderIntervalDays);
        });
      }
    }

    const [succeeded, failed] = await Promise.all([
      this.prisma.bulkBatchRow.count({ where: { batchId, status: 'SUCCEEDED' } }),
      this.prisma.bulkBatchRow.count({ where: { batchId, status: 'FAILED' } }),
    ]);
    await this.prisma.bulkBatch.updateMany({
      where: { id: batchId, status: 'PROCESSING' },
      data: {
        status: 'COMPLETED',
        succeededRows: succeeded,
        failedRows: failed,
        finishedAt: new Date(),
      },
    });
    this.logger.info(
      {
        batchId,
        tenantId: batch.tenantId,
        totalRows: batch.totalRows,
        succeededRows: succeeded,
        failedRows: failed,
        durationMs: Math.round(performance.now() - started),
      },
      'Bulk batch completed',
    );
  }

  private async processRow(
    batch: BulkBatch,
    row: BulkBatchRow,
    user: AuthenticatedUser,
    client: ClientInfo,
    reminderIntervalDays: number | null,
  ): Promise<void> {
    try {
      let envelopeId = row.envelopeId;
      if (!envelopeId) {
        const recipients: TemplatePerson[] = peopleSchema.parse(row.recipients);
        const made = await this.templates.instantiate(
          user,
          batch.templateId,
          {
            recipients,
            message: batch.message ?? undefined,
            externalId: row.externalId ?? undefined,
            metadata: (row.metadata as Record<string, string> | null) ?? undefined,
          },
          client,
          // Committed with the envelope, so there is never an envelope the row does not know.
          async (tx, createdId) => {
            await tx.bulkBatchRow.updateMany({
              where: { id: row.id },
              data: { envelopeId: createdId },
            });
          },
        );
        envelopeId = made.envelopeId;
      }
      if (batch.sendOnCreate) {
        try {
          await this.sending.send(
            envelopeId,
            reminderIntervalDays === null ? {} : { reminderIntervalDays },
            user,
            client,
          );
        } catch (error) {
          // Sent by an earlier attempt that died before it marked the row.
          if (!(error instanceof AppException && error.code === 'ENVELOPE_NOT_DRAFT')) throw error;
        }
      }
      await this.prisma.bulkBatchRow.update({
        where: { id: row.id },
        data: { status: 'SUCCEEDED', recipients: Prisma.DbNull, errorCode: null },
      });
      await this.prisma.bulkBatch.update({
        where: { id: batch.id },
        data: { succeededRows: { increment: 1 } },
      });
      this.logger.info(
        { batchId: batch.id, rowIndex: row.rowIndex, envelopeId, sent: batch.sendOnCreate },
        'Bulk row succeeded',
      );
    } catch (error) {
      const code = error instanceof AppException ? error.code : 'INTERNAL_ERROR';
      this.logger[error instanceof AppException ? 'warn' : 'error'](
        {
          err: error instanceof AppException ? undefined : error,
          batchId: batch.id,
          rowIndex: row.rowIndex,
          code,
        },
        'Bulk row failed',
      );
      await this.prisma.bulkBatchRow.update({
        where: { id: row.id },
        data: { status: 'FAILED', errorCode: code },
      });
      await this.prisma.bulkBatch.update({
        where: { id: batch.id },
        data: { failedRows: { increment: 1 } },
      });
    }
  }
}
