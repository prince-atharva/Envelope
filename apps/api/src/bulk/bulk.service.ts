import { randomUUID } from 'node:crypto';
import {
  type BulkBatchAccepted,
  type BulkBatchDetail,
  type BulkBatchListResponse,
  type CreateBulkBatchInput,
  MAX_BULK_ROWS,
} from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { AuthenticatedUser, ClientInfo } from '../auth/auth.types';
import { ownerScopeOf } from '../auth/ownership';
import { AppException } from '../common/errors/app-exception';
import type { Prisma } from '../generated/prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { toBatchDetail, toBatchSummary } from './bulk-mappers';
import { BulkQueueService } from './bulk-queue.service';

const MAX_LISTED = 100;

const TEMPLATE_NAME = { template: { select: { name: true } } } as const;

/**
 * Accepting and reading bulk batches (docs/20, ADR 0028). Accepting only
 * stores the batch and its rows and queues one job; the worker creates the
 * envelopes (`bulk-runner.service.ts`).
 */
@Injectable()
export class BulkService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly queue: BulkQueueService,
    @InjectPinoLogger(BulkService.name) private readonly logger: PinoLogger,
  ) {}

  private get db() {
    return this.tenantPrisma.client;
  }

  async accept(
    user: AuthenticatedUser,
    templateId: string,
    input: CreateBulkBatchInput,
    client: ClientInfo,
  ): Promise<BulkBatchAccepted> {
    if (input.rows.length > MAX_BULK_ROWS) {
      throw new AppException(
        'BULK_TOO_LARGE',
        `A batch can have at most ${MAX_BULK_ROWS} rows; this one has ${input.rows.length}.`,
      );
    }
    const template = await this.db.template.findFirst({
      where: { id: templateId },
      select: { id: true, archivedAt: true },
    });
    if (!template) throw new AppException('TEMPLATE_NOT_FOUND');
    if (template.archivedAt) throw new AppException('TEMPLATE_ARCHIVED');

    // Rows whose people do not match the template's roles are not refused here:
    // each is reported as failed with its own code when the worker reaches it, so
    // one typo does not cost a partner the other 499 rows (ADR 0028).
    const batchId = randomUUID();
    await this.db.$transaction(async (tx) => {
      await tx.bulkBatch.create({
        data: {
          id: batchId,
          tenantId: user.tenantId,
          templateId,
          createdById: user.id,
          sendOnCreate: input.send,
          message: input.message,
          totalRows: input.rows.length,
          clientIp: client.ip,
          clientUserAgent: client.userAgent,
        },
      });
      await tx.bulkBatchRow.createMany({
        data: input.rows.map((row, rowIndex) => ({
          batchId,
          rowIndex,
          recipients: row.recipients as unknown as Prisma.InputJsonArray,
          externalId: row.externalId,
          ...(row.metadata ? { metadata: row.metadata } : {}),
        })),
      });
    });

    try {
      await this.queue.enqueue(batchId);
    } catch (error) {
      // Without a job nothing would ever run it; do not leave a batch that looks busy forever.
      this.logger.error({ err: error, batchId }, 'Bulk batch could not be queued; removing it');
      await this.db.bulkBatch.deleteMany({ where: { id: batchId } }).catch(() => undefined);
      throw new AppException('SERVICE_UNAVAILABLE', 'The batch could not be started. Try again.');
    }

    this.logger.info(
      {
        batchId,
        templateId,
        tenantId: user.tenantId,
        userId: user.id,
        rows: input.rows.length,
        send: input.send,
      },
      'Bulk batch accepted',
    );
    return { batchId };
  }

  async list(user: AuthenticatedUser): Promise<BulkBatchListResponse> {
    const createdById = ownerScopeOf(user);
    const rows = await this.db.bulkBatch.findMany({
      where: createdById ? { createdById } : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_LISTED,
      include: TEMPLATE_NAME,
    });
    return { batches: rows.map(toBatchSummary) };
  }

  async get(id: string, user: AuthenticatedUser): Promise<BulkBatchDetail> {
    const createdById = ownerScopeOf(user);
    const row = await this.db.bulkBatch.findFirst({
      where: { id, ...(createdById ? { createdById } : {}) },
      include: {
        ...TEMPLATE_NAME,
        // Never the recipients column: it holds email addresses.
        rows: {
          orderBy: { rowIndex: 'asc' },
          select: { rowIndex: true, status: true, envelopeId: true, errorCode: true },
        },
      },
    });
    if (!row) throw new AppException('BULK_BATCH_NOT_FOUND');
    return toBatchDetail(row);
  }
}
