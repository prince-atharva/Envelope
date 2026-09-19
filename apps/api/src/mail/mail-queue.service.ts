import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { ClsService } from 'nestjs-cls';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { maskEmail } from '../logging/redact';
import { EMAIL_QUEUE } from '../queue/queue.module';
import type {
  CompletedEmailJob,
  DeclinedNoticeJob,
  EmailJobData,
  SigningLinkEmailJob,
  WelcomeEmailJob,
} from './mail.types';

/** API side of email: puts jobs on the queue. The worker does the sending. */
@Injectable()
export class MailQueueService implements OnModuleInit {
  constructor(
    @InjectQueue(EMAIL_QUEUE) private readonly queue: Queue<EmailJobData>,
    private readonly cls: ClsService,
    @InjectPinoLogger(MailQueueService.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.queue.on('error', (error) => {
      this.logger.error({ err: error, queue: EMAIL_QUEUE }, 'Email queue error');
    });
  }

  async enqueueWelcome(input: {
    userId: string;
    to: string;
    fullName: string;
    workspaceName: string;
  }): Promise<string | undefined> {
    const data: WelcomeEmailJob = {
      template: 'welcome',
      to: input.to,
      fullName: input.fullName,
      workspaceName: input.workspaceName,
      requestId: this.cls.isActive() ? this.cls.getId() : undefined,
    };
    // One welcome email per user, even if this is called twice.
    const job = await this.queue.add(data.template, data, { jobId: `welcome-${input.userId}` });
    this.logger.info(
      { queue: EMAIL_QUEUE, jobId: job.id, template: data.template, to: maskEmail(input.to) },
      'Email job enqueued',
    );
    return job.id;
  }

  /**
   * Queues an invitation or a reminder. Only ids go on the queue: the worker
   * mints the link when it sends (ADR 0009).
   *
   * An invitation is queued at most once per recipient, however many times this
   * is called. Reminders are each their own job.
   */
  async enqueueSigningLink(
    template: SigningLinkEmailJob['template'],
    envelopeId: string,
    recipientId: string,
  ): Promise<string | undefined> {
    const data: SigningLinkEmailJob = {
      template,
      envelopeId,
      recipientId,
      requestId: this.cls.isActive() ? this.cls.getId() : undefined,
    };
    const jobId =
      template === 'invitation'
        ? `invitation-${recipientId}`
        : `reminder-${recipientId}-${Date.now()}`;
    const job = await this.queue.add(template, data, { jobId });
    this.logger.info(
      { queue: EMAIL_QUEUE, jobId: job.id, template, envelopeId, recipientId },
      'Email job enqueued',
    );
    return job.id;
  }

  /** Tells the sender someone declined. Once per envelope: only one person can end it. */
  async enqueueDeclinedNotice(
    envelopeId: string,
    recipientId: string,
  ): Promise<string | undefined> {
    const data: DeclinedNoticeJob = {
      template: 'declined',
      envelopeId,
      recipientId,
      requestId: this.cls.isActive() ? this.cls.getId() : undefined,
    };
    const job = await this.queue.add(data.template, data, { jobId: `declined-${envelopeId}` });
    this.logger.info(
      { queue: EMAIL_QUEUE, jobId: job.id, template: data.template, envelopeId, recipientId },
      'Email job enqueued',
    );
    return job.id;
  }

  /**
   * The finished document to one person; `null` is the sender. One job per
   * person and envelope: calling this again while the job is kept in Redis adds
   * nothing, and the worker skips anyone already sent their copy.
   */
  async enqueueCompleted(
    envelopeId: string,
    recipientId: string | null,
  ): Promise<string | undefined> {
    const data: CompletedEmailJob = {
      template: 'completed',
      envelopeId,
      recipientId,
      requestId: this.cls.isActive() ? this.cls.getId() : undefined,
    };
    const job = await this.queue.add(data.template, data, {
      jobId: `completed-${envelopeId}-${recipientId ?? 'sender'}`,
    });
    this.logger.info(
      { queue: EMAIL_QUEUE, jobId: job.id, template: data.template, envelopeId, recipientId },
      'Email job enqueued',
    );
    return job.id;
  }
}
