import { type LegalHoldInput, type LegalHoldResponse, legalHoldSchema } from '@envelope/shared';
import { Body, Controller, Delete, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Client, CurrentUser } from '../auth/auth.decorators';
import type { AuthenticatedUser, ClientInfo } from '../auth/auth.types';
import { Roles } from '../auth/roles.decorator';
import { LIMITS, RateLimit } from '../common/throttling/keyed-rate-limit.guard';
import { UuidParamPipe } from '../common/validation/uuid-param.pipe';
import { openApiSchema, ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { LegalHoldService } from './legal-hold.service';

/** Legal hold (docs/07, docs/17 step 7): ADMIN or OWNER only. */
@ApiTags('compliance')
@ApiBearerAuth()
@Controller('envelopes')
export class LegalHoldController {
  constructor(private readonly holds: LegalHoldService) {}

  @Post(':id/legal-hold')
  @Roles('ADMIN')
  @HttpCode(200)
  @RateLimit(LIMITS.lifecycle)
  @ApiOperation({ summary: 'Place a legal hold, overriding every retention sweep until released' })
  @ApiBody({ schema: openApiSchema(legalHoldSchema) })
  place(
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(legalHoldSchema)) body: LegalHoldInput,
    @CurrentUser() user: AuthenticatedUser,
    @Client() client: ClientInfo,
  ): Promise<LegalHoldResponse> {
    return this.holds.place(id, body, user, client);
  }

  @Delete(':id/legal-hold')
  @Roles('ADMIN')
  @HttpCode(200)
  @RateLimit(LIMITS.lifecycle)
  @ApiOperation({ summary: 'Release a legal hold' })
  release(
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Client() client: ClientInfo,
  ): Promise<LegalHoldResponse> {
    return this.holds.release(id, user, client);
  }
}
