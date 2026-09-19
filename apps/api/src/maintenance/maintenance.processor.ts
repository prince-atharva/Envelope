import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AlertService } from '../alert/alert.service';
import { MAINTENANCE_QUEUE } from '../queue/queue.module';
import { AuditChainCheckService } from './audit-chain-check.service';
import { AutoReminderService } from './auto-reminder.service';
import { ExpirySweepService, type SweepResult } from './expiry-sweep.service';
import {
  AUDIT_CHAIN_CHECK_JOB,
  AUTO_REMINDERS_JOB,
  EXPIRY_SWEEP_JOB,
} from './maintenance.scheduler';

/**
 * Worker side of the scheduled jobs, one at a time. Each run logs one summary
 * line: the job, what it looked at, what it changed and how long it took.
 */
@Processor(MAINTENANCE_QUEUE, { concurrency: 1 })
export class MaintenanceProcessor extends WorkerHost {
  constructor(
    private readonly expiry: ExpirySweepService,
    private readonly reminders: AutoReminderService,
    private readonly chainCheck: AuditChainCheckService,
    private readonly alerts: AlertService,
    @InjectPinoLogger(MaintenanceProcessor.name) private readonly logger: PinoLogger,
  ) {
    super();
  }

  private runJob(name: string): Promise<SweepResult> {
    switch (name) {
      case EXPIRY_SWEEP_JOB:
        return this.expiry.run();
      case AUTO_REMINDERS_JOB:
        return this.reminders.run();
      case AUDIT_CHAIN_CHECK_JOB:
        return this.chainCheck.run();
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
        const problems = result.failed + (result.broken ?? 0);
        if (result.changed > 0 || problems > 0 || job.name === AUDIT_CHAIN_CHECK_JOB) {
          // The nightly check always reports, so a quiet night is visible too.
          this.logger[problems > 0 ? 'warn' : 'info'](fields, 'Maintenance job completed');
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
    void this.alerts.raise(
      `maintenance-job-failed:${job?.name ?? 'unknown'}`,
      'Maintenance job failed; the next scheduled run will try again',
      { queue: MAINTENANCE_QUEUE, jobId: job?.id ?? null, job: job?.name ?? null },
      error,
    );
  }

  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.logger.error({ queue: MAINTENANCE_QUEUE, err: error }, 'Maintenance worker error');
  }
}
