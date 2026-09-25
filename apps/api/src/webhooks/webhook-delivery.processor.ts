import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AlertService } from '../alert/alert.service';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { WEBHOOK_DELIVERY_QUEUE } from '../queue/queue.module';
import {
  DEFAULT_WEBHOOK_RETRY_SCHEDULE_MS,
  parseWebhookRetrySchedule,
  WEBHOOK_MAX_ATTEMPTS,
} from '../queue/webhook-retry-schedule';
import type { WebhookDeliveryJobData } from './webhook-delivery.types';
import { WebhookSecretCipher } from './webhook-secret-cipher';
import { signWebhookPayload } from './webhook-signature';
import { assertWebhookUrlIsSafe } from './webhook-url-guard';

/** "A 2xx within 5 seconds counts as success" (docs/08, "Delivery"). */
const DELIVERY_TIMEOUT_MS = 5000;

/**
 * A `@Processor` decorator's options are built at class-definition time,
 * before Nest's dependency injection runs, so this reads `process.env`
 * directly rather than the injected `AppConfig` — safe because the function
 * itself only executes later, per failed attempt, once the process's
 * environment is fully loaded.
 */
function webhookBackoffStrategy(attemptsMade: number): number {
  const schedule = parseWebhookRetrySchedule(process.env.WEBHOOK_RETRY_SCHEDULE_MS ?? '');
  return (
    schedule[attemptsMade - 1] ??
    schedule[schedule.length - 1] ??
    DEFAULT_WEBHOOK_RETRY_SCHEDULE_MS[5]
  );
}

/**
 * Signs and sends one webhook delivery attempt (docs/08, "Webhooks";
 * docs/18). Worker-side only, like `mail/email.processor.ts`, whose
 * structure this mirrors: load by id, attempt, record the outcome, let
 * BullMQ's registered backoff schedule the next try.
 */
@Processor(WEBHOOK_DELIVERY_QUEUE, {
  concurrency: 3,
  settings: { backoffStrategy: webhookBackoffStrategy },
})
export class WebhookDeliveryProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: WebhookSecretCipher,
    private readonly alerts: AlertService,
    private readonly config: AppConfig,
    @InjectPinoLogger(WebhookDeliveryProcessor.name) private readonly logger: PinoLogger,
  ) {
    super();
  }

  async process(job: Job<WebhookDeliveryJobData>): Promise<void> {
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: job.data.deliveryId },
      include: { webhookEndpoint: true },
    });
    if (!delivery) {
      this.logger.warn({ deliveryId: job.data.deliveryId }, 'Webhook delivery row missing');
      return;
    }
    // Already delivered: a stalled job picked up again, or a redrive that
    // raced a delivery that had just succeeded.
    if (delivery.status === 'SUCCEEDED') return;

    const attempt = job.attemptsMade + 1;
    const rawBody = JSON.stringify(delivery.payload);
    let statusCode: number | undefined;
    let errorMessage: string | undefined;

    try {
      // Re-checked here, not just at registration: DNS can rebind between
      // the two (docs/18).
      await assertWebhookUrlIsSafe(delivery.webhookEndpoint.url, {
        allowInsecureLocal: this.config.WEBHOOK_ALLOW_INSECURE_LOCAL_URLS,
      });
      const secret = this.cipher.decrypt(delivery.webhookEndpoint.secretCiphertext);
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = signWebhookPayload(secret, timestamp, rawBody);

      const res = await fetch(delivery.webhookEndpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Signature-Timestamp': String(timestamp),
          'X-Signature': `sha256=${signature}`,
        },
        body: rawBody,
        // A webhook receiver is verified as a public, non-private address once;
        // following a redirect would fetch a second, unchecked URL.
        redirect: 'manual',
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      });
      statusCode = res.status;
      if (res.ok) {
        await this.prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'SUCCEEDED',
            attempts: attempt,
            lastAttemptAt: new Date(),
            lastStatusCode: res.status,
            lastError: null,
          },
        });
        this.logger.info(
          {
            deliveryId: delivery.id,
            eventType: delivery.eventType,
            attempt,
            statusCode: res.status,
          },
          'Webhook delivered',
        );
        return;
      }
      errorMessage = `HTTP ${res.status}`;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Unknown error';
    }

    await this.prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: 'FAILED',
        attempts: attempt,
        lastAttemptAt: new Date(),
        lastStatusCode: statusCode ?? null,
        lastError: errorMessage ?? 'Unknown error',
      },
    });
    throw new Error(`Webhook delivery ${delivery.id} failed: ${errorMessage}`);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<WebhookDeliveryJobData> | undefined, error: Error): Promise<void> {
    const maxAttempts = job?.opts.attempts ?? WEBHOOK_MAX_ATTEMPTS;
    const attemptsMade = job?.attemptsMade ?? maxAttempts;
    const deliveryId = job?.data.deliveryId;
    const fields = {
      queue: WEBHOOK_DELIVERY_QUEUE,
      deliveryId,
      attemptsMade,
      maxAttempts,
      err: error,
    };

    if (attemptsMade < maxAttempts) {
      this.logger.warn(fields, 'Webhook delivery failed; it will be retried');
      return;
    }

    if (deliveryId) {
      await this.prisma.webhookDelivery
        .update({ where: { id: deliveryId }, data: { status: 'EXHAUSTED' } })
        .catch((updateError: unknown) => {
          this.logger.warn(
            { deliveryId, err: updateError },
            'Could not mark webhook delivery exhausted',
          );
        });
    }
    void this.alerts.raise(
      'webhook-delivery-exhausted',
      'A webhook delivery failed permanently',
      { deliveryId: deliveryId ?? null, attemptsMade },
      error,
    );
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string): void {
    this.logger.warn(
      { queue: WEBHOOK_DELIVERY_QUEUE, jobId },
      'Webhook delivery job stalled; it will be picked up again',
    );
  }

  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.logger.error(
      { queue: WEBHOOK_DELIVERY_QUEUE, err: error },
      'Webhook delivery worker error',
    );
  }
}
