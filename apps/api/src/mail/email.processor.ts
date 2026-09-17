import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfig } from '../config/app-config';
import { EMAIL_QUEUE } from '../queue/queue.module';
import type { EmailJobData, RenderedEmail } from './mail.types';
import { MailTransportService } from './mail-transport.service';
import { renderWelcomeEmail } from './templates';

/**
 * Worker side of email. Every log line written while a job runs carries the job
 * id and the id of the API request that queued it.
 */
@Processor(EMAIL_QUEUE, { concurrency: 5 })
export class EmailProcessor extends WorkerHost {
  constructor(
    private readonly transport: MailTransportService,
    private readonly config: AppConfig,
    @InjectPinoLogger(EmailProcessor.name) private readonly logger: PinoLogger,
  ) {
    super();
  }

  private render(data: EmailJobData): RenderedEmail {
    switch (data.template) {
      case 'welcome':
        return renderWelcomeEmail(data, this.config.APP_URL);
    }
  }

  process(job: Job<EmailJobData>): Promise<{ messageId: string }> {
    return this.logger.runInContext(
      async () => {
        const started = performance.now();
        this.logger.info(
          { attempt: job.attemptsMade + 1, maxAttempts: job.opts.attempts ?? 1 },
          'Email job started',
        );
        const result = await this.transport.send(this.render(job.data), job.data.template);
        this.logger.info(
          { messageId: result.messageId, durationMs: Math.round(performance.now() - started) },
          'Email job completed',
        );
        return result;
      },
      {
        bindings: {
          queue: EMAIL_QUEUE,
          jobId: job.id,
          template: job.data.template,
          requestId: job.data.requestId,
        },
      },
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<EmailJobData> | undefined, error: Error): void {
    const maxAttempts = job?.opts.attempts ?? 1;
    const attemptsMade = job?.attemptsMade ?? maxAttempts;
    const fields = {
      queue: EMAIL_QUEUE,
      jobId: job?.id,
      template: job?.data.template,
      requestId: job?.data.requestId,
      attemptsMade,
      maxAttempts,
      err: error,
    };
    if (attemptsMade < maxAttempts) {
      this.logger.warn(fields, 'Email job failed; it will be retried');
    } else {
      this.logger.error({ ...fields, alert: true }, 'Email job failed permanently');
    }
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string): void {
    this.logger.warn(
      { queue: EMAIL_QUEUE, jobId },
      'Email job stalled; it will be picked up again',
    );
  }

  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.logger.error({ queue: EMAIL_QUEUE, err: error }, 'Email worker error');
  }
}
