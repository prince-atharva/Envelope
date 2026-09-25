import { randomBytes } from 'node:crypto';
import type {
  CreateWebhookEndpointInput,
  CreateWebhookEndpointResponse,
  UpdateWebhookEndpointInput,
  WebhookDeliverySummary,
  WebhookEndpointSummary,
  WebhookEventType,
} from '@envelope/shared';
import { MAX_WEBHOOK_ENDPOINTS_PER_TENANT } from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AppException } from '../common/errors/app-exception';
import type { WebhookDelivery, WebhookEndpoint } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookSecretCipher } from './webhook-secret-cipher';
import { assertWebhookUrlIsSafe } from './webhook-url-guard';

const SECRET_PREFIX = 'whsec_';
const DISPLAY_PREFIX_LENGTH = 12;
const DEFAULT_DELIVERIES_LIMIT = 50;
const MAX_DELIVERIES_LIMIT = 100;

function toEndpointSummary(endpoint: WebhookEndpoint): WebhookEndpointSummary {
  return {
    id: endpoint.id,
    url: endpoint.url,
    description: endpoint.description,
    secretDisplayHint: endpoint.secretDisplayHint,
    subscribedEvents: endpoint.subscribedEvents as WebhookEventType[],
    isActive: endpoint.isActive,
    createdAt: endpoint.createdAt.toISOString(),
    updatedAt: endpoint.updatedAt.toISOString(),
  };
}

function toDeliverySummary(delivery: WebhookDelivery): WebhookDeliverySummary {
  return {
    id: delivery.id,
    eventId: delivery.eventId,
    eventType: delivery.eventType as WebhookEventType,
    status: delivery.status,
    attempts: delivery.attempts,
    lastAttemptAt: delivery.lastAttemptAt?.toISOString() ?? null,
    lastStatusCode: delivery.lastStatusCode,
    lastError: delivery.lastError,
    createdAt: delivery.createdAt.toISOString(),
  };
}

/** A tenant's registered webhook endpoints (docs/08, "Webhooks"; docs/18). */
@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: WebhookSecretCipher,
    @InjectPinoLogger(WebhooksService.name) private readonly logger: PinoLogger,
  ) {}

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
    const count = await this.prisma.webhookEndpoint.count({ where: { tenantId: actor.tenantId } });
    if (count >= MAX_WEBHOOK_ENDPOINTS_PER_TENANT) {
      throw new AppException('WEBHOOK_ENDPOINT_LIMIT_REACHED');
    }
    await assertWebhookUrlIsSafe(input.url);

    const rawSecret = `${SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
    const endpoint = await this.prisma.webhookEndpoint.create({
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
    if (input.url !== undefined) await assertWebhookUrlIsSafe(input.url);

    const updated = await this.prisma.webhookEndpoint.update({
      where: { id },
      data: {
        ...(input.url !== undefined ? { url: input.url } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.subscribedEvents !== undefined
          ? { subscribedEvents: input.subscribedEvents }
          : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
    this.logger.info(
      { webhookEndpointId: id, tenantId: actor.tenantId, updatedBy: actor.id },
      'Webhook endpoint updated',
    );
    return toEndpointSummary(updated);
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

  private async findInTenant(id: string, tenantId: string): Promise<WebhookEndpoint> {
    const endpoint = await this.prisma.webhookEndpoint.findFirst({ where: { id, tenantId } });
    if (!endpoint) throw new AppException('NOT_FOUND', 'Webhook endpoint not found.');
    return endpoint;
  }
}
