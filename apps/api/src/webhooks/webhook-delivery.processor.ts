import {
  WEBHOOK_DELIVERY_HEADERS,
  WEBHOOK_TEST_EVENT_TYPE,
  webhookUserAgent,
} from '@envelope/shared';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AlertService } from '../alert/alert.service';
import { AppConfig } from '../config/app-config';
import { MailQueueService } from '../mail/mail-queue.service';
import { PrismaService } from '../prisma/prisma.service';
import { WEBHOOK_DELIVERY_QUEUE } from '../queue/queue.module';
import {
  DEFAULT_WEBHOOK_RETRY_SCHEDULE_MS,
  parseWebhookRetrySchedule,
  WEBHOOK_MAX_ATTEMPTS,
} from '../queue/webhook-retry-schedule';
import { APP_VERSION } from '../version';
import type { WebhookDeliveryJobData } from './webhook-delivery.types';
import { WebhookSecretCipher } from './webhook-secret-cipher';
import { buildWebhookSignatureHeader } from './webhook-signature';
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
    private readonly mail: MailQueueService,
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

    // The lifetime count across redrives (docs/18 workstream 8): `attempts`
    // is never reset by redrive() any more, so this keeps counting from
    // wherever an earlier redrive left off, rather than restarting at 1.
    const lifetimeAttempt = delivery.attempts + 1;
    const rawBody = JSON.stringify(delivery.payload);
    let statusCode: number | undefined;
    let errorMessage: string | undefined;

    try {
      // Re-checked here, not just at registration: DNS can rebind between
      // the two (docs/18).
      await assertWebhookUrlIsSafe(delivery.webhookEndpoint.url, {
        allowInsecureLocal: this.config.WEBHOOK_ALLOW_INSECURE_LOCAL_URLS,
      });
      const endpoint = delivery.webhookEndpoint;
      // Read at send time, not enqueue time, so a rotation takes effect for
      // deliveries already queued (docs/18 workstream 9).
      const secrets = [this.cipher.decrypt(endpoint.secretCiphertext)];
      if (
        endpoint.previousSecretCiphertext &&
        endpoint.previousSecretExpiresAt &&
        endpoint.previousSecretExpiresAt.getTime() > Date.now()
      ) {
        secrets.push(this.cipher.decrypt(endpoint.previousSecretCiphertext));
      }
      const timestamp = Math.floor(Date.now() / 1000);

      const res = await fetch(delivery.webhookEndpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': webhookUserAgent(APP_VERSION),
          [WEBHOOK_DELIVERY_HEADERS.signatureTimestamp]: String(timestamp),
          [WEBHOOK_DELIVERY_HEADERS.signature]: buildWebhookSignatureHeader(
            secrets,
            timestamp,
            rawBody,
          ),
          [WEBHOOK_DELIVERY_HEADERS.eventId]: delivery.eventId,
          [WEBHOOK_DELIVERY_HEADERS.eventType]: delivery.eventType,
          [WEBHOOK_DELIVERY_HEADERS.deliveryId]: delivery.id,
          [WEBHOOK_DELIVERY_HEADERS.attempt]: String(lifetimeAttempt),
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
            attempts: { increment: 1 },
            lastAttemptAt: new Date(),
            nextAttemptAt: null,
            lastStatusCode: res.status,
            lastError: null,
          },
        });
        this.logger.info(
          {
            deliveryId: delivery.id,
            eventType: delivery.eventType,
            attempt: lifetimeAttempt,
            statusCode: res.status,
          },
          'Webhook delivered',
        );
        if (delivery.eventType !== WEBHOOK_TEST_EVENT_TYPE) {
          await this.resetFailureStreak(delivery.webhookEndpointId);
        }
        return;
      }
      errorMessage = `HTTP ${res.status}`;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Unknown error';
    }

    // job.attemptsMade is this job run's own count (redrive starts a fresh
    // job), the same input BullMQ's registered backoff strategy just used to
    // schedule the next try, if any — recomputing it here gives the same
    // delay to show as "next retry at", without inventing a second source.
    const jobAttemptsMade = job.attemptsMade + 1;
    const willRetry = jobAttemptsMade < (job.opts.attempts ?? WEBHOOK_MAX_ATTEMPTS);
    await this.prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: 'FAILED',
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
        nextAttemptAt: willRetry
          ? new Date(Date.now() + webhookBackoffStrategy(jobAttemptsMade))
          : null,
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
    // A test delivery is a one-off check the admin is watching (docs/18
    // workstream 9): nobody needs paging about it, and it says nothing about
    // whether real events are getting through.
    if (job?.name === WEBHOOK_TEST_EVENT_TYPE) return;
    if (deliveryId) await this.recordExhaustion(deliveryId);
    void this.alerts.raise(
      'webhook-delivery-exhausted',
      'A webhook delivery failed permanently',
      { deliveryId: deliveryId ?? null, attemptsMade },
      error,
    );
  }

  /** Any real success ends a streak: "consecutive" failures (docs/18 workstream 9). */
  private async resetFailureStreak(endpointId: string): Promise<void> {
    await this.prisma.webhookEndpoint
      .updateMany({
        where: { id: endpointId, consecutiveFailures: { gt: 0 } },
        data: { consecutiveFailures: 0 },
      })
      .catch((error: unknown) => {
        this.logger.warn({ endpointId, err: error }, 'Could not reset webhook failure streak');
      });
  }

  /**
   * Counts one more real delivery that ran out of retries and, at the
   * threshold, turns the endpoint off and tells its admins (docs/18
   * workstream 9). The increment is atomic; the conditional `updateMany`
   * means that when several deliveries cross the threshold together, exactly
   * one of them disables the endpoint and sends the emails.
   */
  private async recordExhaustion(deliveryId: string): Promise<void> {
    try {
      const delivery = await this.prisma.webhookDelivery.findUnique({
        where: { id: deliveryId },
        select: { webhookEndpointId: true, attempts: true },
      });
      if (!delivery) return;
      // A manual retry that fails again is the same bad event, not a new one:
      // only a delivery's first run of attempts counts toward the streak.
      if (delivery.attempts > WEBHOOK_MAX_ATTEMPTS) return;
      const endpointId = delivery.webhookEndpointId;
      const endpoint = await this.prisma.webhookEndpoint.update({
        where: { id: endpointId },
        data: { consecutiveFailures: { increment: 1 } },
        select: { tenantId: true, isActive: true, consecutiveFailures: true },
      });
      const threshold = this.config.WEBHOOK_AUTO_DISABLE_THRESHOLD;
      if (!endpoint.isActive || endpoint.consecutiveFailures < threshold) return;

      const disabledAt = new Date();
      const { count } = await this.prisma.webhookEndpoint.updateMany({
        where: { id: endpointId, isActive: true },
        data: {
          isActive: false,
          disabledAt,
          disabledReason: `Turned off automatically: ${threshold} deliveries in a row failed every retry.`,
        },
      });
      if (count === 0) return;

      const admins = await this.prisma.user.findMany({
        where: {
          tenantId: endpoint.tenantId,
          isServiceAccount: false,
          role: { in: ['OWNER', 'ADMIN'] },
          // A pending invitation is not yet a person who can act on this.
          inviteTokenHash: null,
        },
        select: { id: true },
      });
      await this.mail.enqueueWebhookDisabled(
        endpointId,
        disabledAt,
        admins.map((admin) => admin.id),
      );
      this.logger.warn(
        {
          webhookEndpointId: endpointId,
          tenantId: endpoint.tenantId,
          threshold,
          notified: admins.length,
        },
        'Webhook endpoint disabled after repeated failures',
      );
    } catch (error) {
      this.logger.error(
        { deliveryId, err: error },
        'Could not record webhook failure or disable the endpoint',
      );
    }
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
