import {
  type VoidEnvelopeInput,
  type VoidEnvelopeResponse,
  voidEnvelopeSchema,
} from '@envelope/shared';
import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Client, CurrentUser } from '../auth/auth.decorators';
import type { AuthenticatedUser, ClientInfo } from '../auth/auth.types';
import { UuidParamPipe } from '../common/validation/uuid-param.pipe';
import { openApiSchema, ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { CancelService } from './cancel.service';

@ApiTags('lifecycle')
@ApiBearerAuth()
@Controller('envelopes')
export class LifecycleController {
  constructor(private readonly cancel: CancelService) {}

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
}
