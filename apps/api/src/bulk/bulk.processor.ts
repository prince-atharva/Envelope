import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { BULK_QUEUE } from '../queue/queue.module';
import type { BulkJobData } from './bulk-queue.service';
import { BulkRunner } from './bulk-runner.service';

/** Worker side of the bulk queue: one job is one batch (ADR 0028). */
@Processor(BULK_QUEUE, { concurrency: 2 })
export class BulkProcessor extends WorkerHost {
  constructor(
    private readonly runner: BulkRunner,
    @InjectPinoLogger(BulkProcessor.name) private readonly logger: PinoLogger,
  ) {
    super();
  }

  async process(job: Job<BulkJobData>): Promise<void> {
    this.logger.info(
      { jobId: job.id, batchId: job.data.batchId, requestId: job.data.requestId },
      'Bulk job started',
    );
    await this.runner.run(job.data.batchId);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<BulkJobData> | undefined, error: Error): void {
    this.logger.error(
      { err: error, jobId: job?.id, batchId: job?.data.batchId, attemptsMade: job?.attemptsMade },
      'Bulk job failed',
    );
  }
}
