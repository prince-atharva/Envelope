import {
  type RemindInput,
  type RemindResponse,
  remindSchema,
  type SendEnvelopeInput,
  type SendEnvelopeResponse,
  sendEnvelopeSchema,
} from '@envelope/shared';
import { Body, Controller, Headers, HttpCode, Param, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiKeyAllowed } from '../auth/api-key.decorator';
import { Client, CurrentUser } from '../auth/auth.decorators';
import type { AuthenticatedUser, ClientInfo } from '../auth/auth.types';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { IDEMPOTENCY_KEY_HEADER } from '../common/idempotency/idempotency-header';
import { LIMITS, RateLimit } from '../common/throttling/keyed-rate-limit.guard';
import { UuidParamPipe } from '../common/validation/uuid-param.pipe';
import { openApiSchema, ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { SendingService } from './sending.service';

@ApiTags('sending')
@ApiBearerAuth()
@Controller('envelopes')
export class SendingController {
  constructor(
    private readonly sending: SendingService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post(':id/send')
  @HttpCode(200)
  @ApiKeyAllowed({ write: true })
  @RateLimit(LIMITS.createAndSend)
  @ApiOperation({ summary: 'Send a draft for signing' })
  @ApiHeader(IDEMPOTENCY_KEY_HEADER)
  @ApiBody({ schema: openApiSchema(sendEnvelopeSchema), required: false })
  async send(
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(sendEnvelopeSchema.optional())) body: SendEnvelopeInput | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<SendEnvelopeResponse> {
    const input = body ?? {};
    const { response, replayed } = await this.idempotency.run(
      `send:${user.tenantId}:${id}`,
      idempotencyKey,
      input,
      () => this.sending.send(id, input, user, client),
    );
    if (replayed) res.setHeader('Idempotency-Replayed', 'true');
    return response;
  }

  @Post(':id/remind')
  @HttpCode(200)
  @RateLimit(LIMITS.lifecycle)
  @ApiOperation({
    summary: 'Remind people whose turn it is (one reminder per person per 24 hours)',
  })
  @ApiBody({ schema: openApiSchema(remindSchema), required: false })
  remind(
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(remindSchema.optional())) body: RemindInput | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Client() client: ClientInfo,
  ): Promise<RemindResponse> {
    return this.sending.remind(id, body ?? {}, user, client);
  }
}
