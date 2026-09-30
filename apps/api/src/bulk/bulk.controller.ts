import {
  type BulkBatchAccepted,
  type BulkBatchDetail,
  type BulkBatchListResponse,
  type CreateBulkBatchInput,
  createBulkBatchSchema,
} from '@envelope/shared';
import { Body, Controller, Get, Headers, HttpCode, Param, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiKeyAllowed } from '../auth/api-key.decorator';
import { Client, CurrentUser } from '../auth/auth.decorators';
import type { AuthenticatedUser, ClientInfo } from '../auth/auth.types';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { OPTIONAL_IDEMPOTENCY_KEY_HEADER } from '../common/idempotency/idempotency-header';
import { LIMITS, RateLimit } from '../common/throttling/keyed-rate-limit.guard';
import { UuidParamPipe } from '../common/validation/uuid-param.pipe';
import { openApiSchema, ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { BulkService } from './bulk.service';

/** Bulk send (docs/20, ADR 0028): many envelopes from one template, made in the background. */
@ApiTags('templates')
@ApiBearerAuth()
@Controller()
export class BulkController {
  constructor(
    private readonly bulk: BulkService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post('templates/:id/bulk')
  @HttpCode(202)
  @ApiKeyAllowed({ write: true })
  @RateLimit(LIMITS.bulkBatch)
  @ApiOperation({
    summary: 'Start a bulk send from a template',
    description:
      'Accepts up to 500 rows and answers at once; the envelopes are created, and sent if asked, ' +
      'in the background. Poll GET /bulk-batches/:id for each row’s outcome.',
  })
  @ApiHeader(OPTIONAL_IDEMPOTENCY_KEY_HEADER)
  @ApiBody({ schema: openApiSchema(createBulkBatchSchema) })
  async create(
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(createBulkBatchSchema)) body: CreateBulkBatchInput,
    @CurrentUser() user: AuthenticatedUser,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<BulkBatchAccepted> {
    const { response, replayed } = await this.idempotency.runReferenced(
      `bulk-create:${user.tenantId}:${user.apiKeyId ?? user.id}`,
      idempotencyKey,
      { templateId: id, ...body },
      async () => {
        const accepted = await this.bulk.accept(user, id, body, client);
        return { reference: accepted.batchId, response: accepted };
      },
      async (batchId) => ({ batchId }),
    );
    if (replayed) res.setHeader('Idempotency-Replayed', 'true');
    return response;
  }

  @Get('bulk-batches')
  @ApiKeyAllowed({ write: false })
  @ApiOperation({ summary: 'List bulk batches, newest first' })
  list(@CurrentUser() user: AuthenticatedUser): Promise<BulkBatchListResponse> {
    return this.bulk.list(user);
  }

  @Get('bulk-batches/:id')
  @ApiKeyAllowed({ write: false })
  @ApiOperation({ summary: 'Read a bulk batch: progress and each row’s outcome' })
  get(
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BulkBatchDetail> {
    return this.bulk.get(id, user);
  }
}
