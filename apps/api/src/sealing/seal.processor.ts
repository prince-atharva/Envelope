import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AlertService } from '../alert/alert.service';
import { SEAL_QUEUE } from '../queue/queue.module';
import type { SealJobData } from './seal-queue.service';
import { type CatchUpResult, SealingService } from './sealing.service';

/**
 * Worker side of sealing. Envelopes are sealed in parallel up to the
 * concurrency; one envelope is only ever sealed by one job at a time, which
 * SealingService's lock ensures. Every log line of a job carries its ids.
 */
@Processor(SEAL_QUEUE, { concurrency: 2 })
export class SealProcessor extends WorkerHost {
  constructor(
    private readonly sealing: SealingService,
    private readonly alerts: AlertService,
    @InjectPinoLogger(SealProcessor.name) private readonly logger: PinoLogger,
  ) {
    super();
  }

  process(job: Job<SealJobData>): Promise<CatchUpResult> {
    return this.logger.runInContext(
      async () => {
        const started = performance.now();
        this.logger.info(
          { attempt: job.attemptsMade + 1, maxAttempts: job.opts.attempts ?? 1 },
          'Seal job started',
        );
        const result = await this.sealing.catchUp(job.data.envelopeId);
        this.logger.info(
          { ...result, durationMs: Math.round(performance.now() - started) },
          'Seal job completed',
        );
        return result;
      },
      {
        bindings: {
          queue: SEAL_QUEUE,
          jobId: job.id,
          envelopeId: job.data.envelopeId,
          recipientId: job.data.recipientId,
          requestId: job.data.requestId,
        },
      },
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<SealJobData> | undefined, error: Error): void {
    const maxAttempts = job?.opts.attempts ?? 1;
    const attemptsMade = job?.attemptsMade ?? maxAttempts;
    const fields = {
      queue: SEAL_QUEUE,
      jobId: job?.id,
      envelopeId: job?.data.envelopeId,
      requestId: job?.data.requestId,
      attemptsMade,
      maxAttempts,
      err: error,
    };
    if (attemptsMade < maxAttempts) {
      this.logger.warn(fields, 'Seal job failed; it will be retried');
    } else {
      // The next signer is not invited until this version exists.
      void this.alerts.raise(
        'seal-job-failed',
        'Seal job failed permanently',
        {
          queue: SEAL_QUEUE,
          jobId: job?.id ?? null,
          envelopeId: job?.data.envelopeId ?? null,
          requestId: job?.data.requestId ?? null,
          attemptsMade,
        },
        error,
      );
    }
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string): void {
    this.logger.warn({ queue: SEAL_QUEUE, jobId }, 'Seal job stalled; it will be picked up again');
  }

  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.logger.error({ queue: SEAL_QUEUE, err: error }, 'Seal worker error');
  }
}
