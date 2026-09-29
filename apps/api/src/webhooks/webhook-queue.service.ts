import { randomUUID } from 'node:crypto';
import {
  WEBHOOK_API_VERSION,
  WEBHOOK_TEST_EVENT_TYPE,
  type WebhookEventPayload,
  type WebhookEventType,
} from '@envelope/shared';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WEBHOOK_DELIVERY_QUEUE } from '../queue/queue.module';
import type { WebhookDeliveryJobData } from './webhook-delivery.types';

/**
 * API and worker side alike: enqueues a webhook delivery for every active,
 * subscribed endpoint of a tenant (docs/08, "Webhooks"; docs/18). Call this
 * after the transaction that caused the event has committed, never inside
 * it — a BullMQ job must never reference a row that might still roll back
 * (the existing precedent: `sending.service.ts`'s invitation enqueue runs
 * after, not inside, its `$transaction`).
 */
@Injectable()
export class WebhookQueueService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(WEBHOOK_DELIVERY_QUEUE) private readonly queue: Queue<WebhookDeliveryJobData>,
    @InjectPinoLogger(WebhookQueueService.name) private readonly logger: PinoLogger,
  ) {}

  async enqueue(
    tenantId: string,
    type: WebhookEventType,
    data: Record<string, unknown>,
  ): Promise<void> {
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, subscribedEvents: true },
    });
    const targets = endpoints.filter(
      (e) => e.subscribedEvents.length === 0 || e.subscribedEvents.includes(type),
    );
    if (targets.length === 0) {
      this.logger.debug({ tenantId, type }, 'Webhook event has no subscribed endpoints');
      return;
    }

    // A title only a partner's own record wouldn't otherwise carry, added
    // here rather than at each of the 9 call sites (docs/18 workstream 8).
    // Draft-only edits can't race this: every emitter fires only after its
    // own transaction (which may itself have changed the title) commits.
    const envelopeId = typeof data.envelopeId === 'string' ? data.envelopeId : undefined;
    const envelope = envelopeId
      ? await this.prisma.envelope.findUnique({
          where: { id: envelopeId, tenantId },
          select: { title: true },
        })
      : null;

    // Shared by every endpoint's delivery of this occurrence (docs/08), so a
    // receiver's dedup-on-event.id logic is meaningful even with more than
    // one endpoint registered.
    const eventId = `evt_${randomUUID()}`;
    const payload: WebhookEventPayload = {
      id: eventId,
      type,
      apiVersion: WEBHOOK_API_VERSION,
      createdAt: new Date().toISOString(),
      data: envelope ? { ...data, envelopeTitle: envelope.title } : data,
    };

    const created = await this.prisma.webhookDelivery.createManyAndReturn({
      data: targets.map((endpoint) => ({
        tenantId,
        webhookEndpointId: endpoint.id,
        eventId,
        eventType: type,
        envelopeId: envelopeId ?? null,
        payload: payload as unknown as Prisma.InputJsonValue,
      })),
      select: { id: true },
    });

    await this.queue.addBulk(
      created.map((delivery) => ({
        name: type,
        data: { deliveryId: delivery.id },
        opts: { jobId: `delivery-${delivery.id}` },
      })),
    );
    this.logger.info(
      { tenantId, type, eventId, endpoints: targets.length },
      'Webhook deliveries enqueued',
    );
  }

  /**
   * One test delivery to one endpoint (docs/18 workstream 9): a single
   * attempt, so a failure is reported once instead of retried for 15 hours,
   * and never counted toward auto-disable or alerting. Unlike `enqueue`, it
   * goes to the named endpoint even if that endpoint is inactive or not
   * subscribed to anything, since checking a receiver is the point.
   */
  async enqueueTest(tenantId: string, endpointId: string): Promise<string> {
    const eventId = `evt_${randomUUID()}`;
    const payload: WebhookEventPayload = {
      id: eventId,
      type: WEBHOOK_TEST_EVENT_TYPE,
      apiVersion: WEBHOOK_API_VERSION,
      createdAt: new Date().toISOString(),
      data: { message: 'This is a test event sent from Envelope. No action is needed.' },
    };
    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        tenantId,
        webhookEndpointId: endpointId,
        eventId,
        eventType: WEBHOOK_TEST_EVENT_TYPE,
        envelopeId: null,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    await this.queue.add(
      WEBHOOK_TEST_EVENT_TYPE,
      { deliveryId: delivery.id },
      { jobId: `delivery-${delivery.id}`, attempts: 1 },
    );
    this.logger.info(
      { tenantId, webhookEndpointId: endpointId, deliveryId: delivery.id, eventId },
      'Webhook test delivery enqueued',
    );
    return delivery.id;
  }

  /**
   * Re-enqueues an existing delivery row (docs/08: "redrivable"). `attempts`
   * is left as-is, not reset: it is a lifetime count across every redrive
   * (docs/18 workstream 8), not this job run's own count, so a delivery
   * redriven after 6 failed attempts and failing once more correctly shows
   * 7, not 1. A fresh jobId, distinct from the original `delivery-${id}`:
   * BullMQ keeps failed jobs for `removeOnFail`'s window, so reusing the id
   * could collide with a job that still exists.
   */
  async redrive(deliveryId: string): Promise<void> {
    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'PENDING',
        lastError: null,
        lastStatusCode: null,
        nextAttemptAt: null,
      },
    });
    await this.queue.add(
      'redrive',
      { deliveryId },
      { jobId: `delivery-${deliveryId}-redrive-${Date.now()}` },
    );
  }
}
