import { randomUUID } from 'node:crypto';
import type { WebhookEventPayload, WebhookEventType } from '@envelope/shared';
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

    // Shared by every endpoint's delivery of this occurrence (docs/08), so a
    // receiver's dedup-on-event.id logic is meaningful even with more than
    // one endpoint registered.
    const eventId = `evt_${randomUUID()}`;
    const payload: WebhookEventPayload = {
      id: eventId,
      type,
      createdAt: new Date().toISOString(),
      data,
    };

    const created = await this.prisma.webhookDelivery.createManyAndReturn({
      data: targets.map((endpoint) => ({
        tenantId,
        webhookEndpointId: endpoint.id,
        eventId,
        eventType: type,
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
   * Re-enqueues an existing delivery row unchanged (docs/08: "redrivable").
   * A fresh jobId, distinct from the original `delivery-${id}`: BullMQ keeps
   * failed jobs for `removeOnFail`'s window, so reusing the id could collide
   * with a job that still exists.
   */
  async redrive(deliveryId: string): Promise<void> {
    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'PENDING', attempts: 0, lastError: null, lastStatusCode: null },
    });
    await this.queue.add(
      'redrive',
      { deliveryId },
      { jobId: `delivery-${deliveryId}-redrive-${Date.now()}` },
    );
  }
}
