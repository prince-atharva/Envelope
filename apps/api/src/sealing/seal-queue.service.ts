import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { ClsService } from 'nestjs-cls';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { SEAL_QUEUE } from '../queue/queue.module';

/** Data stored in Redis for each seal job: ids only. */
export interface SealJobData {
  envelopeId: string;
  /**
   * The signer whose submission queued it; absent when an extension did. The
   * worker works from the database, not this.
   */
  recipientId?: string;
  requestId?: string;
}

/** API side of sealing: queues a seal job when someone finishes signing (ADR 0006). */
@Injectable()
export class SealQueueService implements OnModuleInit {
  constructor(
    @InjectQueue(SEAL_QUEUE) private readonly queue: Queue<SealJobData>,
    private readonly cls: ClsService,
    @InjectPinoLogger(SealQueueService.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.queue.on('error', (error) => {
      this.logger.error({ err: error, queue: SEAL_QUEUE }, 'Seal queue error');
    });
  }

  /**
   * One job per signature, so calling this twice for the same signer queues it
   * once. The job stamps whatever is outstanding for the envelope, so a job
   * that arrives late finds nothing to do, and one job can catch up on several.
   */
  async enqueue(envelopeId: string, recipientId: string): Promise<string | undefined> {
    const data: SealJobData = {
      envelopeId,
      recipientId,
      requestId: this.cls.isActive() ? this.cls.getId() : undefined,
    };
    const job = await this.queue.add('seal', data, { jobId: `seal-${recipientId}` });
    this.logger.info(
      { queue: SEAL_QUEUE, jobId: job.id, envelopeId, recipientId },
      'Seal job enqueued',
    );
    return job.id;
  }

  /**
   * After an expired envelope is extended: stamps signatures made before the
   * deadline, which waited while it was paused (ADR 0013), and invites whoever
   * is due next. One job per extension.
   */
  async enqueueResume(envelopeId: string, extendedAt: Date): Promise<string | undefined> {
    const data: SealJobData = {
      envelopeId,
      requestId: this.cls.isActive() ? this.cls.getId() : undefined,
    };
    const job = await this.queue.add('seal', data, {
      jobId: `resume-${envelopeId}-${extendedAt.getTime()}`,
    });
    this.logger.info({ queue: SEAL_QUEUE, jobId: job.id, envelopeId }, 'Resume seal job enqueued');
    return job.id;
  }
}
