import {
  type ApiKeySummary,
  type CreateApiKeyInput,
  type CreateApiKeyResponse,
  createApiKeySchema,
} from '@envelope/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { Roles } from '../auth/roles.decorator';
import { LIMITS, RateLimit } from '../common/throttling/keyed-rate-limit.guard';
import { UuidParamPipe } from '../common/validation/uuid-param.pipe';
import { openApiSchema, ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { ApiKeyService } from './api-key.service';

/**
 * Tenant-scoped API keys (docs/08, docs/18): ADMIN or OWNER only, JWT session
 * only — key management is never itself reachable by an API key this phase.
 */
@ApiTags('api-keys')
@ApiBearerAuth()
@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeyService) {}

  @Get()
  @Roles('ADMIN')
  @ApiOperation({ summary: "List the tenant's API keys" })
  list(@CurrentUser() user: AuthenticatedUser): Promise<ApiKeySummary[]> {
    return this.apiKeys.list(user.tenantId);
  }

  @Post()
  @Roles('ADMIN')
  @RateLimit(LIMITS.lifecycle)
  @ApiOperation({ summary: 'Create an API key; the raw value is shown once, in this response' })
  @ApiBody({ schema: openApiSchema(createApiKeySchema) })
  create(
    @Body(new ZodValidationPipe(createApiKeySchema)) body: CreateApiKeyInput,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CreateApiKeyResponse> {
    return this.apiKeys.create(body, user);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(200)
  @RateLimit(LIMITS.lifecycle)
  @ApiOperation({ summary: 'Revoke an API key; takes effect immediately' })
  revoke(
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ApiKeySummary> {
    return this.apiKeys.revoke(id, user);
  }
}
