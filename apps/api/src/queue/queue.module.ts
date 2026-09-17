import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config';

export const EMAIL_QUEUE = 'email';

/** Days a finished job's data is kept in Redis (for inspection), then removed. */
const KEEP_COMPLETED_SECONDS = 24 * 3600;
const KEEP_FAILED_SECONDS = 14 * 24 * 3600;
export const EMAIL_MAX_ATTEMPTS = 5;

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
  ],
  exports: [BullModule],
})
export class QueueModule {}
