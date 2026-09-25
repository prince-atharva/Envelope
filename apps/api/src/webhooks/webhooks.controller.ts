import {
  type CreateWebhookEndpointInput,
  type CreateWebhookEndpointResponse,
  createWebhookEndpointSchema,
  type ListWebhookDeliveriesQuery,
  listWebhookDeliveriesQuerySchema,
  type UpdateWebhookEndpointInput,
  updateWebhookEndpointSchema,
  type WebhookDeliverySummary,
  type WebhookEndpointSummary,
} from '@envelope/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { Roles } from '../auth/roles.decorator';
import { LIMITS, RateLimit } from '../common/throttling/keyed-rate-limit.guard';
import { UuidParamPipe } from '../common/validation/uuid-param.pipe';
import { openApiSchema, ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { WebhooksService } from './webhooks.service';

/**
 * Webhook endpoints (docs/08, docs/18): ADMIN or OWNER only, JWT session
 * only — never reachable by an API key this phase.
 */
@ApiTags('webhooks')
@ApiBearerAuth()
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  @Roles('ADMIN')
  @ApiOperation({ summary: "List the tenant's webhook endpoints" })
  list(@CurrentUser() user: AuthenticatedUser): Promise<WebhookEndpointSummary[]> {
    return this.webhooks.list(user.tenantId);
  }

  @Post()
  @Roles('ADMIN')
  @RateLimit(LIMITS.lifecycle)
  @ApiOperation({ summary: 'Register a webhook endpoint; the signing secret is shown once' })
  @ApiBody({ schema: openApiSchema(createWebhookEndpointSchema) })
  create(
    @Body(new ZodValidationPipe(createWebhookEndpointSchema)) body: CreateWebhookEndpointInput,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CreateWebhookEndpointResponse> {
    return this.webhooks.create(body, user);
  }

  @Patch(':id')
  @Roles('ADMIN')
  @RateLimit(LIMITS.lifecycle)
  @ApiOperation({ summary: 'Change a webhook endpoint: URL, description, subscribed events' })
  @ApiBody({ schema: openApiSchema(updateWebhookEndpointSchema) })
  update(
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(updateWebhookEndpointSchema)) body: UpdateWebhookEndpointInput,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WebhookEndpointSummary> {
    return this.webhooks.update(id, body, user);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(200)
  @RateLimit(LIMITS.lifecycle)
  @ApiOperation({
    summary: 'Deactivate a webhook endpoint (the endpoint and its delivery history are kept)',
  })
  deactivate(
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WebhookEndpointSummary> {
    return this.webhooks.deactivate(id, user);
  }

  @Post(':id/redrive')
  @Roles('ADMIN')
  @HttpCode(200)
  @RateLimit(LIMITS.lifecycle)
  @ApiOperation({
    summary:
      'Redrive a failed or exhausted delivery. NOTE: :id is a delivery id here, not an endpoint id (docs/08)',
  })
  redrive(
    @Param('id', UuidParamPipe) deliveryId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WebhookDeliverySummary> {
    return this.webhooks.redriveDelivery(deliveryId, user);
  }

  @Get(':id/deliveries')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Recent delivery attempts for one endpoint, newest first' })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100 },
  })
  listDeliveries(
    @Param('id', UuidParamPipe) id: string,
    @Query(new ZodValidationPipe(listWebhookDeliveriesQuerySchema))
    query: ListWebhookDeliveriesQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WebhookDeliverySummary[]> {
    return this.webhooks.listDeliveries(id, user, query.limit);
  }
}
