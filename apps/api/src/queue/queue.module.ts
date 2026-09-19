import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config';

export const EMAIL_QUEUE = 'email';
/** Stamps signatures into document versions and seals the final one (ADR 0006). */
export const SEAL_QUEUE = 'seal';
/** Scheduled housekeeping: the expiry sweep, and later reminders and the audit check (docs/16). */
export const MAINTENANCE_QUEUE = 'maintenance';

/** Days a finished job's data is kept in Redis (for inspection), then removed. */
const KEEP_COMPLETED_SECONDS = 24 * 3600;
const KEEP_FAILED_SECONDS = 14 * 24 * 3600;
export const EMAIL_MAX_ATTEMPTS = 5;
export const SEAL_MAX_ATTEMPTS = 5;
/** 5s, 10s, 20s, 40s: long enough for storage or the database to come back. */
const SEAL_RETRY_BASE_DELAY_MS = 5000;

/**
 * BullMQ on Redis (docs/03, "Asynchronous Processing"). Shared by the API, which
 * only adds jobs, and the worker, which processes them.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        connection: { url: config.REDIS_URL, maxRetriesPerRequest: null },
        prefix: config.QUEUE_PREFIX,
      }),
    }),
    BullModule.registerQueueAsync({
      name: EMAIL_QUEUE,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        defaultJobOptions: {
          attempts: EMAIL_MAX_ATTEMPTS,
          // 10s, 20s, 40s, 80s by default.
          backoff: { type: 'exponential', delay: config.EMAIL_RETRY_BASE_DELAY_MS },
          removeOnComplete: { age: KEEP_COMPLETED_SECONDS },
          removeOnFail: { age: KEEP_FAILED_SECONDS },
        },
      }),
    }),
    BullModule.registerQueue({
      name: SEAL_QUEUE,
      defaultJobOptions: {
        attempts: SEAL_MAX_ATTEMPTS,
        backoff: { type: 'exponential', delay: SEAL_RETRY_BASE_DELAY_MS },
        removeOnComplete: { age: KEEP_COMPLETED_SECONDS },
        removeOnFail: { age: KEEP_FAILED_SECONDS },
      },
    }),
    BullModule.registerQueue({
      name: MAINTENANCE_QUEUE,
      defaultJobOptions: {
        // A failed run is not retried: the next tick does the same work.
        attempts: 1,
        // Not kept: each run logs its own summary. A kept job occupies its
        // schedule slot, and a restarted worker's scheduler skips forward past
        // every occupied slot, which delayed the first run by many intervals.
        removeOnComplete: true,
        removeOnFail: { age: KEEP_FAILED_SECONDS },
      },
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
