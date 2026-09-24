import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import type { SweepResult } from './expiry-sweep.service';

/** Rows deleted per batch. A run keeps batching until one comes back short. */
const CLEANUP_BATCH = 5_000;
/** However many rows have piled up, one run does not run forever. */
const MAX_BATCHES_PER_RUN = 200;

/**
 * Deletes refresh-token rows well past their expiry (100M-row scale
 * follow-up, docs/16 step 14). Nothing else ever deletes a Session row —
 * every login, refresh and rotation adds one and none is ever removed — so
 * without this the table only grows.
 *
 * Batched, each batch its own statement: a single unbounded DELETE would
 * hold its row locks over however many million rows have piled up since the
 * last run, and over the parent User rows they reference.
 */
@Injectable()
export class SessionCleanupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    @InjectPinoLogger(SessionCleanupService.name) private readonly logger: PinoLogger,
  ) {}

  async run(now = new Date()): Promise<SweepResult> {
    const cutoff = new Date(
      now.getTime() - this.config.SESSION_RETENTION_DAYS * 24 * 3600 * 1000,
    ).toISOString();

    let changed = 0;
    let failed = 0;
    for (let batchCount = 0; batchCount < MAX_BATCHES_PER_RUN; batchCount += 1) {
      try {
        // Timestamps are stored as UTC without a zone, so `cutoff` is
        // converted explicitly, as the envelope locks do.
        const deleted = await this.prisma.$queryRaw<{ id: string }[]>`
          DELETE FROM "Session"
           WHERE id IN (
             SELECT id FROM "Session"
              WHERE "expiresAt" < (${cutoff}::timestamptz AT TIME ZONE 'UTC')
              LIMIT ${CLEANUP_BATCH}
           )
          RETURNING id`;
        changed += deleted.length;
        if (deleted.length < CLEANUP_BATCH) break;
      } catch (error) {
        failed += 1;
        this.logger.error({ err: error }, 'Session cleanup batch failed');
        break;
      }
    }
    return { scanned: changed, changed, failed };
  }
}
