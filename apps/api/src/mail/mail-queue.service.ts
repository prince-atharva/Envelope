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
  ExpiredNoticeJob,
  MoreTimeRequestedJob,
  SigningLinkEmailJob,
  VoidedNoticeJob,
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
   * An invitation is queued at most once per invitation (the recipient and the
   * time their turn began), however many times this is called. A later,
   * genuine re-invite has a new `invitedAt` and so a new job: finished jobs stay
   * in Redis for a day, and would otherwise swallow it. Reminders are each their
   * own job.
   */
  async enqueueSigningLink(
    template: SigningLinkEmailJob['template'],
    envelopeId: string,
    recipientId: string,
    invitedAt?: Date,
  ): Promise<string | undefined> {
    const data: SigningLinkEmailJob = {
      template,
      envelopeId,
      recipientId,
      requestId: this.cls.isActive() ? this.cls.getId() : undefined,
    };
    const jobId =
      template === 'invitation'
        ? `invitation-${recipientId}-${invitedAt?.getTime() ?? 0}`
        : `${template}-${recipientId}-${Date.now()}`;
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

  /**
   * Tells one person the envelope was cancelled. One job per person and
   * envelope: an envelope is cancelled at most once.
   */
  async enqueueVoided(envelopeId: string, recipientId: string): Promise<string | undefined> {
    const data: VoidedNoticeJob = {
      template: 'voided',
      envelopeId,
      recipientId,
      requestId: this.cls.isActive() ? this.cls.getId() : undefined,
    };
    const job = await this.queue.add(data.template, data, {
      jobId: `voided-${envelopeId}-${recipientId}`,
    });
    this.logger.info(
      { queue: EMAIL_QUEUE, jobId: job.id, template: data.template, envelopeId, recipientId },
      'Email job enqueued',
    );
    return job.id;
  }

  /**
   * Tells the sender the envelope expired. One job per expiry: an envelope
   * extended and later expired again gets a second notice.
   */
  async enqueueExpired(envelopeId: string, expiredAt: Date): Promise<string | undefined> {
    const data: ExpiredNoticeJob = {
      template: 'expired',
      envelopeId,
      requestId: this.cls.isActive() ? this.cls.getId() : undefined,
    };
    const job = await this.queue.add(data.template, data, {
      jobId: `expired-${envelopeId}-${expiredAt.getTime()}`,
    });
    this.logger.info(
      { queue: EMAIL_QUEUE, jobId: job.id, template: data.template, envelopeId },
      'Email job enqueued',
    );
    return job.id;
  }

  /** Tells the sender someone asked for more time. One job per request, at most one a day. */
  async enqueueMoreTimeRequested(
    envelopeId: string,
    recipientId: string,
    requestedAt: Date,
  ): Promise<string | undefined> {
    const data: MoreTimeRequestedJob = {
      template: 'more-time-requested',
      envelopeId,
      recipientId,
      requestId: this.cls.isActive() ? this.cls.getId() : undefined,
    };
    const job = await this.queue.add(data.template, data, {
      jobId: `more-time-${recipientId}-${requestedAt.getTime()}`,
    });
    this.logger.info(
      { queue: EMAIL_QUEUE, jobId: job.id, template: data.template, envelopeId, recipientId },
      'Email job enqueued',
    );
    return job.id;
  }
}
