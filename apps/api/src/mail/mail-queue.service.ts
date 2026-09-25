import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { ClsService } from 'nestjs-cls';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { AlertMessage } from '../alert/alert.service';
import { maskEmail } from '../logging/redact';
import { EMAIL_QUEUE } from '../queue/queue.module';
import type {
  AlertEmailJob,
  CompletedEmailJob,
  DeclinedNoticeJob,
  DownloadRenewedJob,
  EmailJobData,
  ExpiredNoticeJob,
  MoreTimeRequestedJob,
  SigningLinkEmailJob,
  UserInvitedJob,
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

  /**
   * Same as enqueueSigningLink, for several recipients in one Redis round
   * trip instead of one call each (100M-row scale follow-up, docs/16 step
   * 14) — remind() and enqueueInvitations() can each name up to a tenant's
   * whole recipient limit. Each job keeps the same deduping jobId a single
   * call would have given it.
   */
  async enqueueSigningLinksBulk(
    entries: readonly {
      template: SigningLinkEmailJob['template'];
      envelopeId: string;
      recipientId: string;
      invitedAt?: Date;
    }[],
  ): Promise<void> {
    if (entries.length === 0) return;
    const requestId = this.cls.isActive() ? this.cls.getId() : undefined;
    const jobs = entries.map(({ template, envelopeId, recipientId, invitedAt }) => {
      const data: SigningLinkEmailJob = { template, envelopeId, recipientId, requestId };
      const jobId =
        template === 'invitation'
          ? `invitation-${recipientId}-${invitedAt?.getTime() ?? 0}`
          : `${template}-${recipientId}-${Date.now()}`;
      return { name: template, data, opts: { jobId } };
    });
    const created = await this.queue.addBulk(jobs);
    this.logger.info(
      { queue: EMAIL_QUEUE, count: created.length, template: entries[0]?.template },
      'Email jobs enqueued in bulk',
    );
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

  /** Same as enqueueVoided, for everyone a cancelled envelope notifies, in one round trip. */
  async enqueueVoidedBulk(
    entries: readonly { envelopeId: string; recipientId: string }[],
  ): Promise<void> {
    if (entries.length === 0) return;
    const requestId = this.cls.isActive() ? this.cls.getId() : undefined;
    const jobs = entries.map(({ envelopeId, recipientId }) => {
      const data: VoidedNoticeJob = { template: 'voided', envelopeId, recipientId, requestId };
      return { name: data.template, data, opts: { jobId: `voided-${envelopeId}-${recipientId}` } };
    });
    const created = await this.queue.addBulk(jobs);
    this.logger.info(
      { queue: EMAIL_QUEUE, count: created.length, template: 'voided' },
      'Email jobs enqueued in bulk',
    );
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

  /** Invites someone to a tenant (docs/17 step 6). One job per user id. */
  async enqueueUserInvited(userId: string): Promise<string | undefined> {
    const data: UserInvitedJob = {
      template: 'user-invited',
      userId,
      requestId: this.cls.isActive() ? this.cls.getId() : undefined,
    };
    const job = await this.queue.add(data.template, data, { jobId: `user-invited-${userId}` });
    this.logger.info(
      { queue: EMAIL_QUEUE, jobId: job.id, template: data.template, userId },
      'Email job enqueued',
    );
    return job.id;
  }

  /** A fresh link after an old completion download link expired (docs/17 step 10). */
  async enqueueDownloadRenewed(
    envelopeId: string,
    recipientId: string | null,
    downloadId: string,
  ): Promise<string | undefined> {
    const data: DownloadRenewedJob = {
      template: 'download-renewed',
      envelopeId,
      recipientId,
      downloadId,
      requestId: this.cls.isActive() ? this.cls.getId() : undefined,
    };
    const job = await this.queue.add(data.template, data, {
      jobId: `download-renewed-${downloadId}-${Date.now()}`,
    });
    this.logger.info(
      { queue: EMAIL_QUEUE, jobId: job.id, template: data.template, envelopeId, downloadId },
      'Email job enqueued',
    );
    return job.id;
  }

  /** An alert raised in the API, for the worker to email. Gated before it gets here. */
  async enqueueAlert(alert: AlertMessage): Promise<string | undefined> {
    const data: AlertEmailJob = {
      template: 'alert',
      key: alert.key,
      summary: alert.summary,
      fields: alert.fields,
      service: alert.service,
      raisedAt: alert.raisedAt.toISOString(),
      requestId: this.cls.isActive() ? this.cls.getId() : undefined,
    };
    const job = await this.queue.add(data.template, data, {
      jobId: `alert-${alert.key}-${alert.raisedAt.getTime()}`,
    });
    this.logger.info(
      { queue: EMAIL_QUEUE, jobId: job.id, template: data.template, alertKey: alert.key },
      'Email job enqueued',
    );
    return job.id;
  }
}
