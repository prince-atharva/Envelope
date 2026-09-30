import {
  type CreateTemplateInput,
  createTemplateSchema,
  type ListTemplatesQuery,
  listTemplatesQuerySchema,
  type TemplateDetail,
  type TemplateListResponse,
  type UpdateTemplateInput,
  updateTemplateSchema,
} from '@envelope/shared';
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiKeyAllowed } from '../auth/api-key.decorator';
import { CurrentUser } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { Roles } from '../auth/roles.decorator';
import { LIMITS, RateLimit } from '../common/throttling/keyed-rate-limit.guard';
import { UuidParamPipe } from '../common/validation/uuid-param.pipe';
import { openApiSchema, ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { TemplatesService } from './templates.service';

/** Reusable documents (docs/20, ADR 0027). Admins manage them; every role reads them. */
@ApiTags('templates')
@ApiBearerAuth()
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

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
}
