import { randomBytes } from 'node:crypto';
import type {
  CreateWebhookEndpointInput,
  CreateWebhookEndpointResponse,
  ListWebhookDeliveriesPageQuery,
  RotateWebhookSecretInput,
  RotateWebhookSecretResponse,
  UpdateWebhookEndpointInput,
  WebhookDeliveryPage,
  WebhookDeliverySummary,
  WebhookEndpointSummary,
  WebhookEventType,
} from '@envelope/shared';
import {
  MAX_WEBHOOK_ENDPOINT_ROWS_PER_TENANT,
  MAX_WEBHOOK_ENDPOINTS_PER_TENANT,
  WEBHOOK_TEST_EVENT_TYPE,
} from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AppException } from '../common/errors/app-exception';
import { AppConfig } from '../config/app-config';
import type { Prisma, WebhookDelivery, WebhookEndpoint } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookQueueService } from './webhook-queue.service';
import { WebhookSecretCipher } from './webhook-secret-cipher';
import { assertWebhookUrlIsSafe } from './webhook-url-guard';

const SECRET_PREFIX = 'whsec_';
const DISPLAY_PREFIX_LENGTH = 12;
const DEFAULT_DELIVERIES_LIMIT = 50;
const MAX_DELIVERIES_LIMIT = 100;
/** "Failed deliveries are retained 7 days" (docs/08, "Delivery"). */
const REDRIVABLE_WINDOW_MS = 7 * 24 * 3600 * 1000;

interface DeliveryCursor {
  createdAt: Date;
  id: string;
}

/** Same idiom as envelopes.service.ts's own cursor (docs/18 workstream 8 step 8.4). */
function encodeDeliveryCursor(delivery: Pick<WebhookDelivery, 'createdAt' | 'id'>): string {
  return Buffer.from(`${delivery.createdAt.toISOString()}|${delivery.id}`).toString('base64url');
}

function decodeDeliveryCursor(cursor: string): DeliveryCursor {
  const [timestamp, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const createdAt = new Date(timestamp ?? '');
  if (!id || Number.isNaN(createdAt.getTime())) {
    throw new AppException('BAD_REQUEST', 'The page cursor is invalid.');
  }
  return { createdAt, id };
}

function toEndpointSummary(endpoint: WebhookEndpoint): WebhookEndpointSummary {
  return {
    id: endpoint.id,
    url: endpoint.url,
    description: endpoint.description,
    secretDisplayHint: endpoint.secretDisplayHint,
    subscribedEvents: endpoint.subscribedEvents as WebhookEventType[],
    isActive: endpoint.isActive,
    secretRotatedAt: endpoint.secretRotatedAt?.toISOString() ?? null,
    // Only a window that is still open: an elapsed one no longer changes what is signed.
    previousSecretExpiresAt:
      endpoint.previousSecretCiphertext &&
      endpoint.previousSecretExpiresAt &&
      endpoint.previousSecretExpiresAt.getTime() > Date.now()
        ? endpoint.previousSecretExpiresAt.toISOString()
        : null,
    consecutiveFailures: endpoint.consecutiveFailures,
    disabledAt: endpoint.disabledAt?.toISOString() ?? null,
    disabledReason: endpoint.disabledReason,
    createdAt: endpoint.createdAt.toISOString(),
    updatedAt: endpoint.updatedAt.toISOString(),
  };
}

function toDeliverySummary(delivery: WebhookDelivery): WebhookDeliverySummary {
  const payload = delivery.payload as { data?: Record<string, unknown> } | null;
  return {
    id: delivery.id,
    eventId: delivery.eventId,
    eventType: delivery.eventType as WebhookEventType,
    data: payload?.data ?? {},
    status: delivery.status,
    attempts: delivery.attempts,
    lastAttemptAt: delivery.lastAttemptAt?.toISOString() ?? null,
    nextAttemptAt: delivery.nextAttemptAt?.toISOString() ?? null,
    lastStatusCode: delivery.lastStatusCode,
    lastError: delivery.lastError,
    createdAt: delivery.createdAt.toISOString(),
    webhookEndpointId: delivery.webhookEndpointId,
    envelopeId: delivery.envelopeId,
  };
}

/** A tenant's registered webhook endpoints (docs/08, "Webhooks"; docs/18). */
@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: WebhookSecretCipher,
    private readonly webhookQueue: WebhookQueueService,
    private readonly config: AppConfig,
    @InjectPinoLogger(WebhooksService.name) private readonly logger: PinoLogger,
  ) {}

  private newRawSecret(): string {
    return `${SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
  }

  private urlCheckOptions() {
    return { allowInsecureLocal: this.config.WEBHOOK_ALLOW_INSECURE_LOCAL_URLS };
  }

  async list(tenantId: string): Promise<WebhookEndpointSummary[]> {
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return endpoints.map(toEndpointSummary);
  }

  async create(
    input: CreateWebhookEndpointInput,
    actor: AuthenticatedUser,
  ): Promise<CreateWebhookEndpointResponse> {
    await assertWebhookUrlIsSafe(input.url, this.urlCheckOptions());

    const rawSecret = this.newRawSecret();
    const endpoint = await this.prisma.$transaction(async (tx) => {
      await this.lockTenantEndpoints(tx, actor.tenantId);
      await this.assertRoomForTotal(tx, actor.tenantId);
      await this.assertRoomForActive(tx, actor.tenantId);
      return tx.webhookEndpoint.create({
        data: {
          tenantId: actor.tenantId,
          url: input.url,
          description: input.description ?? null,
          secretCiphertext: this.cipher.encrypt(rawSecret),
          secretDisplayHint: rawSecret.slice(0, DISPLAY_PREFIX_LENGTH),
          subscribedEvents: input.subscribedEvents,
          createdByUserId: actor.id,
        },
      });
    });

    this.logger.info(
      { webhookEndpointId: endpoint.id, tenantId: actor.tenantId, createdBy: actor.id },
      'Webhook endpoint registered',
    );
    return { endpoint: toEndpointSummary(endpoint), rawSecret };
  }

  async update(
    id: string,
    input: UpdateWebhookEndpointInput,
    actor: AuthenticatedUser,
  ): Promise<WebhookEndpointSummary> {
    await this.findInTenant(id, actor.tenantId);
    if (input.url !== undefined) {
      await assertWebhookUrlIsSafe(input.url, this.urlCheckOptions());
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockTenantEndpoints(tx, actor.tenantId);
      const current = await tx.webhookEndpoint.findFirst({
        where: { id, tenantId: actor.tenantId },
      });
      if (!current) throw new AppException('NOT_FOUND', 'Webhook endpoint not found.');
      // Reactivating takes an active slot, so it faces the same cap as creating.
      if (input.isActive === true && !current.isActive) {
        await this.assertRoomForActive(tx, actor.tenantId);
      }
      return tx.webhookEndpoint.update({
        where: { id },
        data: {
          ...(input.url !== undefined ? { url: input.url } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.subscribedEvents !== undefined
            ? { subscribedEvents: input.subscribedEvents }
            : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          // A fresh start: otherwise the very next failure would trip the
          // threshold again, and the banner would outlive the problem.
          ...(input.isActive === true && !current.isActive
            ? { consecutiveFailures: 0, disabledAt: null, disabledReason: null }
            : {}),
        },
      });
    });
    this.logger.info(
      {
        webhookEndpointId: id,
        tenantId: actor.tenantId,
        updatedBy: actor.id,
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      },
      'Webhook endpoint updated',
    );
    return toEndpointSummary(updated);
  }

  /**
   * Replaces the signing secret (docs/18 workstream 9). The new secret is
   * returned once. With `overlapHours > 0` the secret being replaced keeps
   * signing alongside it until the window ends, so a receiver can switch
   * without a gap; rotating again inside a window drops the older secret,
   * since only one previous secret is kept.
   */
  async rotateSecret(
    id: string,
    input: RotateWebhookSecretInput,
    actor: AuthenticatedUser,
  ): Promise<RotateWebhookSecretResponse> {
    const rawSecret = this.newRawSecret();
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      // Two simultaneous rotations must each replace a secret they actually
      // read, or the second would leave the first's new secret in no column.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`webhook-secret:${id}`}, 3))`;
      const endpoint = await tx.webhookEndpoint.findFirst({
        where: { id, tenantId: actor.tenantId },
      });
      if (!endpoint) throw new AppException('NOT_FOUND', 'Webhook endpoint not found.');
      const overlap = input.overlapHours > 0;
      return tx.webhookEndpoint.update({
        where: { id },
        data: {
          secretCiphertext: this.cipher.encrypt(rawSecret),
          secretDisplayHint: rawSecret.slice(0, DISPLAY_PREFIX_LENGTH),
          secretRotatedAt: now,
          previousSecretCiphertext: overlap ? endpoint.secretCiphertext : null,
          previousSecretExpiresAt: overlap
            ? new Date(now.getTime() + input.overlapHours * 3600 * 1000)
            : null,
        },
      });
    });
    this.logger.info(
      {
        webhookEndpointId: id,
        tenantId: actor.tenantId,
        rotatedBy: actor.id,
        overlapHours: input.overlapHours,
      },
      'Webhook secret rotated',
    );
    return { endpoint: toEndpointSummary(updated), rawSecret };
  }

  /**
   * Deactivates the endpoint; the row and its delivery history stay, the
   * same idiom `ApiKeyService.revoke` uses rather than a hard delete
   * (`WebhookDelivery.webhookEndpointId` is a RESTRICT foreign key, so a
   * real delete would fail once any delivery has been attempted).
   */
  async deactivate(id: string, actor: AuthenticatedUser): Promise<WebhookEndpointSummary> {
    const endpoint = await this.findInTenant(id, actor.tenantId);
    if (!endpoint.isActive) return toEndpointSummary(endpoint);

    const updated = await this.prisma.webhookEndpoint.update({
      where: { id },
      data: { isActive: false },
    });
    this.logger.info(
      { webhookEndpointId: id, tenantId: actor.tenantId, deactivatedBy: actor.id },
      'Webhook endpoint deactivated',
    );
    return toEndpointSummary(updated);
  }

  /**
   * Permanently removes an inactive endpoint and its delivery history
   * (docs/18 workstream 9). Deliveries go first, in the same transaction: the
   * foreign key is RESTRICT. Pending queue jobs for them find no row and end.
   */
  async deletePermanently(id: string, actor: AuthenticatedUser): Promise<void> {
    const deliveriesDeleted = await this.prisma.$transaction(async (tx) => {
      await this.lockTenantEndpoints(tx, actor.tenantId);
      const endpoint = await tx.webhookEndpoint.findFirst({
        where: { id, tenantId: actor.tenantId },
      });
      if (!endpoint) throw new AppException('NOT_FOUND', 'Webhook endpoint not found.');
      if (endpoint.isActive) throw new AppException('WEBHOOK_ENDPOINT_ACTIVE');
      const { count } = await tx.webhookDelivery.deleteMany({ where: { webhookEndpointId: id } });
      await tx.webhookEndpoint.delete({ where: { id } });
      return count;
    });
    this.logger.info(
      { webhookEndpointId: id, tenantId: actor.tenantId, deletedBy: actor.id, deliveriesDeleted },
      'Webhook endpoint permanently deleted',
    );
  }

  /**
   * One lock per tenant for everything that changes how many endpoints it
   * has or how many are active, so two simultaneous creates or reactivations
   * cannot both take the last slot.
   */
  private async lockTenantEndpoints(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`webhook-endpoints:${tenantId}`}, 3))`;
  }

  private async assertRoomForActive(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
    const active = await tx.webhookEndpoint.count({ where: { tenantId, isActive: true } });
    if (active >= MAX_WEBHOOK_ENDPOINTS_PER_TENANT) {
      throw new AppException('WEBHOOK_ENDPOINT_LIMIT_REACHED');
    }
  }

  private async assertRoomForTotal(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
    const total = await tx.webhookEndpoint.count({ where: { tenantId } });
    if (total >= MAX_WEBHOOK_ENDPOINT_ROWS_PER_TENANT) {
      throw new AppException('WEBHOOK_ENDPOINT_TOTAL_LIMIT_REACHED');
    }
  }

  async listDeliveries(
    id: string,
    actor: AuthenticatedUser,
    limit = DEFAULT_DELIVERIES_LIMIT,
  ): Promise<WebhookDeliverySummary[]> {
    await this.findInTenant(id, actor.tenantId);
    const deliveries = await this.prisma.webhookDelivery.findMany({
      where: { webhookEndpointId: id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), MAX_DELIVERIES_LIMIT),
    });
    return deliveries.map(toDeliverySummary);
  }

  /**
   * Sends one `webhook.test` event to check the receiver (docs/18 workstream
   * 9). Returns the PENDING delivery straight away; the worker records the
   * outcome, which the deliveries list then shows.
   */
  async sendTest(id: string, actor: AuthenticatedUser): Promise<WebhookDeliverySummary> {
    await this.findInTenant(id, actor.tenantId);
    const deliveryId = await this.webhookQueue.enqueueTest(actor.tenantId, id);
    this.logger.info(
      { webhookEndpointId: id, deliveryId, tenantId: actor.tenantId, requestedBy: actor.id },
      'Webhook test event requested',
    );
    const delivery = await this.prisma.webhookDelivery.findUniqueOrThrow({
      where: { id: deliveryId },
    });
    return toDeliverySummary(delivery);
  }

  /**
   * `id` here is a WebhookDelivery id, not a WebhookEndpoint id (docs/08:
   * `POST /v1/webhooks/:id/redrive`) — worth this explicit note since every
   * other route under `/webhooks/:id` takes an endpoint id. Only a
   * FAILED or EXHAUSTED delivery inside the 7-day retention window can be
   * redriven; the stored payload is replayed byte-for-byte.
   */
  async redriveDelivery(
    deliveryId: string,
    actor: AuthenticatedUser,
  ): Promise<WebhookDeliverySummary> {
    const delivery = await this.prisma.webhookDelivery.findFirst({
      where: { id: deliveryId, tenantId: actor.tenantId },
    });
    if (!delivery) throw new AppException('NOT_FOUND', 'Webhook delivery not found.');
    // A test delivery is one attempt by design; redriving it would give it the
    // full retry schedule and, on failure, count toward auto-disable.
    const redrivable =
      delivery.eventType !== WEBHOOK_TEST_EVENT_TYPE &&
      (delivery.status === 'FAILED' || delivery.status === 'EXHAUSTED') &&
      Date.now() - delivery.createdAt.getTime() <= REDRIVABLE_WINDOW_MS;
    if (!redrivable) throw new AppException('WEBHOOK_DELIVERY_NOT_REDRIVABLE');

    await this.webhookQueue.redrive(delivery.id);
    this.logger.info(
      { webhookDeliveryId: delivery.id, tenantId: actor.tenantId, redrivenBy: actor.id },
      'Webhook delivery redriven',
    );
    const refreshed = await this.prisma.webhookDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
    });
    return toDeliverySummary(refreshed);
  }

  /**
   * Tenant-wide, filterable delivery browsing (docs/18 workstream 8 step
   * 8.4), alongside the existing per-endpoint `listDeliveries` above, which
   * is kept — this route is additive, not a replacement.
   */
  async listDeliveriesPage(
    actor: AuthenticatedUser,
    query: ListWebhookDeliveriesPageQuery,
  ): Promise<WebhookDeliveryPage> {
    const cursor = query.cursor ? decodeDeliveryCursor(query.cursor) : undefined;
    const rows = await this.prisma.webhookDelivery.findMany({
      where: {
        tenantId: actor.tenantId,
        ...(query.endpointId ? { webhookEndpointId: query.endpointId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.eventType ? { eventType: query.eventType } : {}),
        ...(query.eventId ? { eventId: query.eventId } : {}),
        ...(query.envelopeId ? { envelopeId: query.envelopeId } : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(toDeliverySummary),
      nextCursor: rows.length > query.limit && last ? encodeDeliveryCursor(last) : null,
    };
  }

  async getDelivery(id: string, actor: AuthenticatedUser): Promise<WebhookDeliverySummary> {
    const delivery = await this.prisma.webhookDelivery.findFirst({
      where: { id, tenantId: actor.tenantId },
    });
    if (!delivery) throw new AppException('NOT_FOUND', 'Webhook delivery not found.');
    return toDeliverySummary(delivery);
  }

  private async findInTenant(id: string, tenantId: string): Promise<WebhookEndpoint> {
    const endpoint = await this.prisma.webhookEndpoint.findFirst({ where: { id, tenantId } });
    if (!endpoint) throw new AppException('NOT_FOUND', 'Webhook endpoint not found.');
    return endpoint;
  }
}
