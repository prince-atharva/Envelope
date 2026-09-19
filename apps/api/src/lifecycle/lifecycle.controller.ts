import {
  type ExtendEnvelopeInput,
  type ExtendEnvelopeResponse,
  extendEnvelopeSchema,
  type ReminderSettingsInput,
  type ReminderSettingsResponse,
  reminderSettingsSchema,
  type VoidEnvelopeInput,
  type VoidEnvelopeResponse,
  voidEnvelopeSchema,
} from '@envelope/shared';
import { Body, Controller, Headers, HttpCode, Param, Patch, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Client, CurrentUser } from '../auth/auth.decorators';
import type { AuthenticatedUser, ClientInfo } from '../auth/auth.types';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { IDEMPOTENCY_KEY_HEADER } from '../common/idempotency/idempotency-header';
import { UuidParamPipe } from '../common/validation/uuid-param.pipe';
import { openApiSchema, ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { CancelService } from './cancel.service';
import { ExtendService } from './extend.service';
import { ReminderSettingsService } from './reminder-settings.service';

@ApiTags('lifecycle')
@ApiBearerAuth()
@Controller('envelopes')
export class LifecycleController {
  constructor(
    private readonly cancel: CancelService,
    private readonly extension: ExtendService,
    private readonly idempotency: IdempotencyService,
    private readonly reminders: ReminderSettingsService,
  ) {}

  @Patch(':id/reminders')
  @ApiOperation({ summary: 'Turn automatic reminders on or off, or change how often' })
  @ApiBody({ schema: openApiSchema(reminderSettingsSchema) })
  updateReminders(
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(reminderSettingsSchema)) body: ReminderSettingsInput,
    @CurrentUser() user: AuthenticatedUser,
    @Client() client: ClientInfo,
  ): Promise<ReminderSettingsResponse> {
    return this.reminders.update(id, body, user, client);
  }

  @Post(':id/void')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Cancel a sent envelope (a reason is required), or discard a draft',
  })
  @ApiBody({ schema: openApiSchema(voidEnvelopeSchema), required: false })
  void(
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(voidEnvelopeSchema.optional())) body: VoidEnvelopeInput | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Client() client: ClientInfo,
  ): Promise<VoidEnvelopeResponse> {
    return this.cancel.void(id, body ?? {}, user, client);
  }

  @Post(':id/extend')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Give more time: a new deadline, and fresh links for whoever is due (reopens an expired envelope)',
  })
  @ApiHeader(IDEMPOTENCY_KEY_HEADER)
  @ApiBody({ schema: openApiSchema(extendEnvelopeSchema) })
  async extend(
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(extendEnvelopeSchema)) body: ExtendEnvelopeInput,
    @CurrentUser() user: AuthenticatedUser,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<ExtendEnvelopeResponse> {
    // A double click would otherwise send two emails, and the first link would
    // already be dead by the time it arrived.
    const { response, replayed } = await this.idempotency.run(
      `extend:${user.tenantId}:${id}`,
      idempotencyKey,
      body,
      () => this.extension.extend(id, body, user, client),
    );
    if (replayed) res.setHeader('Idempotency-Replayed', 'true');
    return response;
  }
}
