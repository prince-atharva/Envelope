import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { MAINTENANCE_QUEUE } from '../queue/queue.module';
import { ExpirySweepService, type SweepResult } from './expiry-sweep.service';
import { EXPIRY_SWEEP_JOB } from './maintenance.scheduler';

/**
 * Worker side of the scheduled jobs, one at a time. Each run logs one summary
 * line: the job, what it looked at, what it changed and how long it took.
 */
@Processor(MAINTENANCE_QUEUE, { concurrency: 1 })
export class MaintenanceProcessor extends WorkerHost {
  constructor(
    private readonly expiry: ExpirySweepService,
    @InjectPinoLogger(MaintenanceProcessor.name) private readonly logger: PinoLogger,
  ) {
    super();
  }

  private runJob(name: string): Promise<SweepResult> {
    switch (name) {
      case EXPIRY_SWEEP_JOB:
        return this.expiry.run();
      default:
        throw new Error(`Unknown maintenance job "${name}"`);
    }
  }

  process(job: Job): Promise<SweepResult> {
    return this.logger.runInContext(
      async () => {
        const started = performance.now();
        const result = await this.runJob(job.name);
        const fields = { ...result, durationMs: Math.round(performance.now() - started) };
        // A quiet run is routine; say more only when it did something or failed.
        if (result.changed > 0 || result.failed > 0) {
          this.logger[result.failed > 0 ? 'warn' : 'info'](fields, 'Maintenance job completed');
        } else {
          this.logger.debug(fields, 'Maintenance job completed');
        }
        return result;
      },
      { bindings: { queue: MAINTENANCE_QUEUE, jobId: job.id, job: job.name } },
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.error(
      { queue: MAINTENANCE_QUEUE, jobId: job?.id, job: job?.name, err: error, alert: true },
      'Maintenance job failed; the next scheduled run will try again',
    );
  }

  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.logger.error({ queue: MAINTENANCE_QUEUE, err: error }, 'Maintenance worker error');
  }
}
