import {
  type CreateWebhookEndpointInput,
  type CreateWebhookEndpointResponse,
  createWebhookEndpointSchema,
  type ListWebhookDeliveriesPageQuery,
  type ListWebhookDeliveriesQuery,
  listWebhookDeliveriesPageQuerySchema,
  listWebhookDeliveriesQuerySchema,
  type RotateWebhookSecretInput,
  type RotateWebhookSecretResponse,
  rotateWebhookSecretSchema,
  type UpdateWebhookEndpointInput,
  updateWebhookEndpointSchema,
  type WebhookDeliveryPage,
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

  @Post(':id/rotate-secret')
  @Roles('ADMIN')
  @HttpCode(200)
  @RateLimit(LIMITS.lifecycle)
  @ApiOperation({
    summary:
      'Rotate the signing secret. The new secret is shown once; the old one keeps verifying for overlapHours (default 24, 0-72)',
  })
  @ApiBody({ schema: openApiSchema(rotateWebhookSecretSchema) })
  rotateSecret(
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(rotateWebhookSecretSchema)) body: RotateWebhookSecretInput,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<RotateWebhookSecretResponse> {
    return this.webhooks.rotateSecret(id, body, user);
  }

  @Post(':id/test')
  @Roles('ADMIN')
  @HttpCode(202)
  @RateLimit(LIMITS.lifecycle)
  @ApiOperation({
    summary:
      'Send one webhook.test event to this endpoint. One attempt, no retries; it never counts toward auto-disable',
  })
  sendTest(
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WebhookDeliverySummary> {
    return this.webhooks.sendTest(id, user);
  }

  @Delete(':id/permanent')
  @Roles('ADMIN')
  @HttpCode(204)
  @RateLimit(LIMITS.lifecycle)
  @ApiOperation({
    summary:
      'Permanently delete an inactive endpoint and its delivery history. An active endpoint must be deactivated first',
  })
  async deletePermanently(
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.webhooks.deletePermanently(id, user);
  }

  @Post(':id/redrive')
  @Roles('ADMIN')
  @HttpCode(200)
  @RateLimit(LIMITS.lifecycle)
  @ApiOperation({
    summary:
      'Redrive a failed or exhausted delivery. NOTE: :id is a delivery id here, not an endpoint id (docs/08)',
    deprecated: true,
    description:
      'Deprecated: use POST /webhooks/deliveries/:id/retry instead (docs/18 workstream 8 step 8.4). Kept for existing callers.',
  })
  redrive(
    @Param('id', UuidParamPipe) deliveryId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WebhookDeliverySummary> {
    return this.webhooks.redriveDelivery(deliveryId, user);
  }

  @Get('deliveries')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Recent delivery attempts across every endpoint, newest first, filterable and paged',
  })
  listDeliveriesPage(
    @Query(new ZodValidationPipe(listWebhookDeliveriesPageQuerySchema))
    query: ListWebhookDeliveriesPageQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WebhookDeliveryPage> {
    return this.webhooks.listDeliveriesPage(user, query);
  }

  @Get('deliveries/:id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'One delivery attempt, by delivery id' })
  getDelivery(
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WebhookDeliverySummary> {
    return this.webhooks.getDelivery(id, user);
  }

  @Post('deliveries/:id/retry')
  @Roles('ADMIN')
  @HttpCode(200)
  @RateLimit(LIMITS.lifecycle)
  @ApiOperation({
    summary:
      'Retry a failed or exhausted delivery (an alias for POST /webhooks/:id/redrive, with a clearer id)',
  })
  retryDelivery(
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WebhookDeliverySummary> {
    return this.webhooks.redriveDelivery(id, user);
  }

  @Get(':id/deliveries')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Recent delivery attempts for one endpoint, newest first',
    deprecated: true,
    description:
      'Deprecated: use GET /webhooks/deliveries?endpointId=:id instead (docs/18 workstream 8 step 8.4), which adds filtering and paging. Kept for existing callers.',
  })
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
