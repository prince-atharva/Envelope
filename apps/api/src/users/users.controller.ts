import {
  type ChangeUserRoleInput,
  changeUserRoleSchema,
  type InviteUserInput,
  type InviteUserResponse,
  inviteUserSchema,
  type TenantUser,
} from '@envelope/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { Roles } from '../auth/roles.decorator';
import { LIMITS, RateLimit } from '../common/throttling/keyed-rate-limit.guard';
import { UuidParamPipe } from '../common/validation/uuid-param.pipe';
import { openApiSchema, ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { UsersService } from './users.service';

/** Settings -> Users (docs/17 step 6). OWNER only. */
@ApiTags('users')
@ApiBearerAuth()
@Roles('OWNER')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: "Everyone in the signed-in user's workspace" })
  list(@CurrentUser() user: AuthenticatedUser): Promise<TenantUser[]> {
    return this.users.list(user.tenantId);
  }

  @Post()
  @RateLimit(LIMITS.lifecycle)
  @ApiOperation({ summary: 'Invite someone to the workspace' })
  @ApiBody({ schema: openApiSchema(inviteUserSchema) })
  invite(
    @Body(new ZodValidationPipe(inviteUserSchema)) body: InviteUserInput,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<InviteUserResponse> {
    return this.users.invite(body, user);
  }

  @Patch(':id/role')
  @RateLimit(LIMITS.lifecycle)
  @ApiOperation({ summary: "Change someone's role" })
  @ApiBody({ schema: openApiSchema(changeUserRoleSchema) })
  changeRole(
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(changeUserRoleSchema)) body: ChangeUserRoleInput,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TenantUser> {
    return this.users.changeRole(id, body, user);
  }

  @Delete(':id')
  @HttpCode(204)
  @RateLimit(LIMITS.lifecycle)
  @ApiOperation({ summary: 'Remove someone from the workspace' })
  async remove(
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.users.remove(id, user);
  }
}
