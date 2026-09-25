import { hasAtLeast, type UserRole } from '@envelope/shared';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppException } from '../common/errors/app-exception';
import { IS_PUBLIC_KEY } from './auth.decorators';
import { ROLES_KEY } from './roles.decorator';

/**
 * Enforces `@Roles(minimum)` (docs/17 step 5). Registered as a second
 * `APP_GUARD`, after `JwtAuthGuard`: it reads `req.user`, which only
 * `JwtAuthGuard` sets, and guard providers run in the order they are bound,
 * so this one is provided in `AuthModule` directly after it. A route with no
 * `@Roles()` and no `@Public()` is unchanged from before this phase: any
 * signed-in user of the tenant.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectPinoLogger(RolesGuard.name) private readonly logger: PinoLogger,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const minimum = this.reflector.getAllAndOverride<UserRole>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!minimum) return true;

    const user = context
      .switchToHttp()
      .getRequest<{ user?: { id: string; role?: UserRole } }>().user;
    // JwtAuthGuard runs first and would already have rejected an
    // unauthenticated request; a missing role here means it never set one.
    if (!user?.role || !hasAtLeast(user.role, minimum)) {
      this.logger.info(
        { userId: user?.id, role: user?.role, required: minimum },
        'Request refused: role does not permit this',
      );
      throw new AppException(
        'FORBIDDEN_ROLE',
        `This needs the ${minimum.toLowerCase()} role or higher.`,
      );
    }
    return true;
  }
}
