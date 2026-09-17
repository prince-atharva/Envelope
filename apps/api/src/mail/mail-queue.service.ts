import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { ClsService } from 'nestjs-cls';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { maskEmail } from '../logging/redact';
import { EMAIL_QUEUE } from '../queue/queue.module';
import type { EmailJobData, WelcomeEmailJob } from './mail.types';

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
}
