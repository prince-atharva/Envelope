import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { ClsService } from 'nestjs-cls';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { BULK_QUEUE } from '../queue/queue.module';

/** Data stored in Redis for each bulk job: the batch id only. The rows live in Postgres (ADR 0028). */
export interface BulkJobData {
  batchId: string;
  requestId?: string;
}

/** API side of bulk send: queues one job per accepted batch. */
@Injectable()
export class BulkQueueService implements OnModuleInit {
  constructor(
    @InjectQueue(BULK_QUEUE) private readonly queue: Queue<BulkJobData>,
    private readonly cls: ClsService,
    @InjectPinoLogger(BulkQueueService.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.queue.on('error', (error) => {
      this.logger.error({ err: error, queue: BULK_QUEUE }, 'Bulk queue error');
    });
  }

  /** One job per batch: queuing the same batch twice runs it once. */
  async enqueue(batchId: string): Promise<string | undefined> {
    const data: BulkJobData = {
      batchId,
      requestId: this.cls.isActive() ? this.cls.getId() : undefined,
    };
    const job = await this.queue.add('bulk', data, { jobId: `bulk-${batchId}` });
    this.logger.info({ queue: BULK_QUEUE, jobId: job.id, batchId }, 'Bulk job enqueued');
    return job.id;
  }
}
