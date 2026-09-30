import {
  type SetTwoFactorPolicyInput,
  setTwoFactorPolicySchema,
  type TwoFactorPolicy,
} from '@envelope/shared';
import { Body, Controller, HttpCode, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LIMITS, RateLimit } from '../common/throttling/keyed-rate-limit.guard';
import { openApiSchema, ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { CurrentUser } from './auth.decorators';
import type { AuthenticatedUser } from './auth.types';
import { Roles } from './roles.decorator';
import { TwoFactorService } from './two-factor.service';

/** The workspace's two-factor rule (docs/19, ADR 0025). OWNER only. */
@ApiTags('auth')
@ApiBearerAuth()
@Roles('OWNER')
@Controller('tenant/two-factor')
export class TwoFactorPolicyController {
  constructor(private readonly twoFactor: TwoFactorService) {}

  @Put()
  @HttpCode(200)
  @RateLimit(LIMITS.lifecycle)
  @ApiOperation({ summary: 'Require (or stop requiring) two-factor for everyone in the workspace' })
  @ApiBody({ schema: openApiSchema(setTwoFactorPolicySchema) })
  set(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(setTwoFactorPolicySchema)) body: SetTwoFactorPolicyInput,
  ): Promise<TwoFactorPolicy> {
    return this.twoFactor.setPolicy(user, body.required);
  }
}
