import {
  type CreateFromTemplateInput,
  type CreateTemplateInput,
  createFromTemplateSchema,
  createTemplateSchema,
  type EnvelopeDetail,
  type ListTemplatesQuery,
  listTemplatesQuerySchema,
  type TemplateDetail,
  type TemplateListResponse,
  type UpdateTemplateInput,
  updateTemplateSchema,
} from '@envelope/shared';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiKeyAllowed } from '../auth/api-key.decorator';
import { Client, CurrentUser } from '../auth/auth.decorators';
import type { AuthenticatedUser, ClientInfo } from '../auth/auth.types';
import { Roles } from '../auth/roles.decorator';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { OPTIONAL_IDEMPOTENCY_KEY_HEADER } from '../common/idempotency/idempotency-header';
import { LIMITS, RateLimit } from '../common/throttling/keyed-rate-limit.guard';
import { UuidParamPipe } from '../common/validation/uuid-param.pipe';
import { openApiSchema, ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { TemplatesService } from './templates.service';

/** Reusable documents (docs/20, ADR 0027). Admins manage them; every role reads them. */
@ApiTags('templates')
@ApiBearerAuth()
@Controller('templates')
export class TemplatesController {
  constructor(
    private readonly templates: TemplatesService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post()
  @Roles('ADMIN')
  @ApiKeyAllowed({ write: true })
  @RateLimit(LIMITS.lifecycle)
  @ApiOperation({ summary: 'Save an envelope as a template' })
  @ApiBody({ schema: openApiSchema(createTemplateSchema) })
  create(
    @Body(new ZodValidationPipe(createTemplateSchema)) body: CreateTemplateInput,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TemplateDetail> {
    return this.templates.create(user, body);
  }

  @Get()
  @ApiKeyAllowed({ write: false })
  @ApiOperation({ summary: 'List templates' })
  @ApiQuery({ name: 'archived', required: false, enum: ['true', 'false'] })
  list(
    @Query(new ZodValidationPipe(listTemplatesQuerySchema)) query: ListTemplatesQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TemplateListResponse> {
    return this.templates.list(user, query);
  }

  @Get(':id')
  @ApiKeyAllowed({ write: false })
  @ApiOperation({ summary: 'Read one template, with its roles and fields' })
  get(@Param('id', UuidParamPipe) id: string): Promise<TemplateDetail> {
    return this.templates.get(id);
  }

  @Patch(':id')
  @Roles('ADMIN')
  @HttpCode(200)
  @ApiKeyAllowed({ write: true })
  @RateLimit(LIMITS.lifecycle)
  @ApiOperation({ summary: 'Rename, describe, archive or restore a template' })
  @ApiBody({ schema: openApiSchema(updateTemplateSchema) })
  update(
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(updateTemplateSchema)) body: UpdateTemplateInput,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TemplateDetail> {
    return this.templates.update(id, body, user);
  }

  @Post(':id/envelopes')
  @ApiKeyAllowed({ write: true })
  @RateLimit(LIMITS.createAndSend)
  @ApiOperation({
    summary: 'Create an envelope from a template, and send it if asked',
    description:
      'Give each role of the template a name and email. The envelope is created exactly as an ' +
      'upload would be: policy is frozen afresh and the PDF is its own copy.',
  })
  @ApiHeader(OPTIONAL_IDEMPOTENCY_KEY_HEADER)
  @ApiBody({ schema: openApiSchema(createFromTemplateSchema) })
  async createEnvelope(
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(createFromTemplateSchema)) body: CreateFromTemplateInput,
    @CurrentUser() user: AuthenticatedUser,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<EnvelopeDetail> {
    // Optional, as on upload (ADR 0019): a retry after a lost response gets the
    // envelope the first request made, not a second one.
    const { response, replayed } = await this.idempotency.runReferenced(
      `template-envelope:${user.tenantId}:${user.apiKeyId ?? user.id}`,
      idempotencyKey,
      { templateId: id, ...body },
      async () => {
        const created = await this.templates.createEnvelope(user, id, body, client);
        return { reference: created.envelopeId, response: await created.detail() };
      },
      (envelopeId) => this.templates.envelopeDetail(envelopeId, user),
    );
    if (replayed) res.setHeader('Idempotency-Replayed', 'true');
    return response;
  }
}
