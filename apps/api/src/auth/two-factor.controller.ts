import {
  type ConfirmTwoFactorInput,
  confirmTwoFactorSchema,
  type EnableTwoFactorInput,
  enableTwoFactorSchema,
  type RecoveryCodesResponse,
  type TwoFactorSetup,
  type TwoFactorStatus,
} from '@envelope/shared';
import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { LIMITS, RateLimit } from '../common/throttling/keyed-rate-limit.guard';
import { openApiSchema, ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { Client, CurrentUser } from './auth.decorators';
import type { AuthenticatedUser, ClientInfo } from './auth.types';
import { TwoFactorService } from './two-factor.service';

/**
 * Two-factor authentication for the signed-in person (docs/19, ADR 0024). JWT
 * only: closed to API keys and embedded sessions, like every route without an
 * explicit allow-list decorator.
 */
@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth/2fa')
export class TwoFactorController {
  constructor(private readonly twoFactor: TwoFactorService) {}

  @Get()
  @ApiOperation({ summary: 'Whether two-factor is on, and whether the workspace requires it' })
  status(@CurrentUser() user: AuthenticatedUser): Promise<TwoFactorStatus> {
    return this.twoFactor.status(user.id);
  }

  @Post('setup')
  @HttpCode(200)
  @RateLimit(LIMITS.twoFactorPerUser)
  @ApiOperation({
    summary: 'Start enrolment: a secret and an otpauth URI for an authenticator app',
  })
  setup(
    @CurrentUser() user: AuthenticatedUser,
    @Client() client: ClientInfo,
  ): Promise<TwoFactorSetup> {
    return this.twoFactor.setup(user.id, client);
  }

  @Post('enable')
  @HttpCode(200)
  @RateLimit(LIMITS.twoFactorPerUser)
  @ApiOperation({ summary: 'Confirm the app with a code; returns ten recovery codes, once' })
  @ApiBody({ schema: openApiSchema(enableTwoFactorSchema) })
  enable(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(enableTwoFactorSchema)) body: EnableTwoFactorInput,
    @Client() client: ClientInfo,
  ): Promise<RecoveryCodesResponse> {
    return this.twoFactor.enable(user.id, body.code, client);
  }

  @Post('disable')
  @HttpCode(204)
  @RateLimit(LIMITS.twoFactorPerUser)
  @ApiOperation({ summary: 'Turn two-factor off; needs the password and a current code' })
  @ApiBody({ schema: openApiSchema(confirmTwoFactorSchema) })
  @ApiNoContentResponse()
  async disable(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(confirmTwoFactorSchema)) body: ConfirmTwoFactorInput,
    @Client() client: ClientInfo,
  ): Promise<void> {
    await this.twoFactor.disable(user.id, user.sessionId, body, client);
  }

  @Post('recovery-codes')
  @HttpCode(200)
  @RateLimit(LIMITS.twoFactorPerUser)
  @ApiOperation({ summary: 'Replace the recovery codes; needs the password and a current code' })
  @ApiBody({ schema: openApiSchema(confirmTwoFactorSchema) })
  regenerateRecoveryCodes(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(confirmTwoFactorSchema)) body: ConfirmTwoFactorInput,
    @Client() client: ClientInfo,
  ): Promise<RecoveryCodesResponse> {
    return this.twoFactor.regenerateRecoveryCodes(user.id, body, client);
  }
}
