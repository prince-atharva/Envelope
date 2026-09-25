import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { WEBHOOK_MAX_ATTEMPTS } from './webhook-retry-schedule';

export const EMAIL_QUEUE = 'email';
/** Stamps signatures into document versions and seals the final one (ADR 0006). */
export const SEAL_QUEUE = 'seal';
/** Scheduled housekeeping: the expiry sweep, and later reminders and the audit check (docs/16). */
export const MAINTENANCE_QUEUE = 'maintenance';
/** Outbound event notifications to a tenant's registered endpoints (docs/08, docs/18). */
export const WEBHOOK_DELIVERY_QUEUE = 'webhook-delivery';

/** Days a finished job's data is kept in Redis (for inspection), then removed. */
const KEEP_COMPLETED_SECONDS = 24 * 3600;
const KEEP_FAILED_SECONDS = 14 * 24 * 3600;
export const EMAIL_MAX_ATTEMPTS = 5;
export const SEAL_MAX_ATTEMPTS = 5;
/** 5s, 10s, 20s, 40s: long enough for storage or the database to come back. */
const SEAL_RETRY_BASE_DELAY_MS = 5000;

/**
 * The named custom backoff strategy the worker registers
 * (`webhook-delivery.processor.ts`) for WEBHOOK_DELIVERY_QUEUE, since
 * BullMQ's built-in exponential backoff cannot produce the exact schedule
 * docs/08 documents. See `webhook-retry-schedule.ts` for the delay values.
 */
export const WEBHOOK_BACKOFF_TYPE = 'webhook-delivery-schedule';

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
    BullModule.registerQueue({
      name: WEBHOOK_DELIVERY_QUEUE,
      defaultJobOptions: {
        attempts: WEBHOOK_MAX_ATTEMPTS,
        backoff: { type: WEBHOOK_BACKOFF_TYPE },
        removeOnComplete: { age: KEEP_COMPLETED_SECONDS },
        // Kept the full retention window (docs/08): a delivery row stays
        // redrivable for 7 days, and the job itself is one place to see why.
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
