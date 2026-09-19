import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AlertService } from '../alert/alert.service';
import { AppConfig } from '../config/app-config';
import { EMAIL_QUEUE } from '../queue/queue.module';
import { CompletionMailer } from './completion.mailer';
import { LifecycleMailer } from './lifecycle.mailer';
import type { EmailJobData } from './mail.types';
import { MailTransportService } from './mail-transport.service';
import { SenderNoticeMailer } from './sender-notice.mailer';
import { SigningLinkMailer, type SigningLinkResult } from './signing-link.mailer';
import { renderAlertEmail, renderWelcomeEmail } from './templates';

/**
 * Worker side of email. Every log line written while a job runs carries the job
 * id and the id of the API request that queued it.
 */
@Processor(EMAIL_QUEUE, { concurrency: 5 })
export class EmailProcessor extends WorkerHost {
  constructor(
    private readonly transport: MailTransportService,
    private readonly signingLinks: SigningLinkMailer,
    private readonly senderNotices: SenderNoticeMailer,
    private readonly completions: CompletionMailer,
    private readonly lifecycle: LifecycleMailer,
    private readonly config: AppConfig,
    private readonly alerts: AlertService,
    @InjectPinoLogger(EmailProcessor.name) private readonly logger: PinoLogger,
  ) {
    super();
  }

  private deliver(data: EmailJobData): Promise<SigningLinkResult> {
    switch (data.template) {
      case 'welcome':
        return this.transport.send(renderWelcomeEmail(data, this.config.APP_URL), data.template);
      case 'invitation':
      case 'reminder':
      case 'extended':
      case 'expiry-warning':
        return this.signingLinks.send(data);
      case 'declined':
        return this.senderNotices.sendDeclined(data);
      case 'expired':
        return this.senderNotices.sendExpired(data);
      case 'more-time-requested':
        return this.senderNotices.sendMoreTimeRequested(data);
      case 'alert':
        // Queued by the API, which checked the gate and that ALERT_EMAIL is set.
        return this.config.ALERT_EMAIL
          ? this.transport.send(
              renderAlertEmail({
                ...data,
                to: this.config.ALERT_EMAIL,
                raisedAt: new Date(data.raisedAt),
                appUrl: this.config.APP_URL,
              }),
              data.template,
            )
          : Promise.resolve({ skipped: 'ALERT_EMAIL not set' });
      case 'completed':
        return this.completions.send(data);
      case 'voided':
        return this.lifecycle.sendVoided(data);
    }
  }

  process(job: Job<EmailJobData>): Promise<SigningLinkResult> {
    return this.logger.runInContext(
      async () => {
        const started = performance.now();
        this.logger.info(
          { attempt: job.attemptsMade + 1, maxAttempts: job.opts.attempts ?? 1 },
          'Email job started',
        );
        const result = await this.deliver(job.data);
        this.logger.info(
          { ...result, durationMs: Math.round(performance.now() - started) },
          'skipped' in result ? 'Email job completed without sending' : 'Email job completed',
        );
        return result;
      },
      {
        bindings: {
          queue: EMAIL_QUEUE,
          jobId: job.id,
          template: job.data.template,
          requestId: job.data.requestId,
          ...('envelopeId' in job.data ? { envelopeId: job.data.envelopeId } : {}),
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
      void this.alerts.raise(
        `email-job-failed:${job?.data.template ?? 'unknown'}`,
        'Email job failed permanently',
        {
          queue: EMAIL_QUEUE,
          jobId: job?.id ?? null,
          template: job?.data.template ?? null,
          envelopeId: job && 'envelopeId' in job.data ? job.data.envelopeId : null,
          requestId: job?.data.requestId ?? null,
          attemptsMade,
        },
        error,
      );
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
