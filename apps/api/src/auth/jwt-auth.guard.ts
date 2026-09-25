import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import type { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppException } from '../common/errors/app-exception';
import type { RequestContext } from '../common/request-context';
import { IS_PUBLIC_KEY } from './auth.decorators';
import type { AccessTokenClaims } from './auth.types';
import { SessionService } from './session.service';

/**
 * Global guard: every route needs a valid access token unless marked @Public().
 * The token's session must still be active, so logout and reuse detection take
 * effect immediately instead of when the token expires.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly sessions: SessionService,
    private readonly cls: ClsService<RequestContext>,
    @InjectPinoLogger(JwtAuthGuard.name) private readonly logger: PinoLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      this.logger.debug('Request without a bearer token');
      throw new AppException('UNAUTHENTICATED');
    }

    let claims: AccessTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessTokenClaims>(token);
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        this.logger.debug('Access token expired');
        throw new AppException('SESSION_EXPIRED', 'Access token expired.');
      }
      this.logger.warn(
        { reason: error instanceof Error ? error.message : 'unknown' },
        'Invalid access token',
      );
      throw new AppException('UNAUTHENTICATED');
    }

    if (!(await this.sessions.isActive(claims.sid))) {
      this.logger.info(
        { userId: claims.sub, sessionId: claims.sid },
        'Access token belongs to an ended session',
      );
      throw new AppException('SESSION_EXPIRED');
    }

    req.user = { id: claims.sub, tenantId: claims.tid, sessionId: claims.sid, role: claims.role };
    this.cls.set('userId', claims.sub);
    this.cls.set('tenantId', claims.tid);
    this.cls.set('sessionId', claims.sid);
    // Every later log line of this request, including the request summary, names the user.
    this.logger.assign({ userId: claims.sub, tenantId: claims.tid });
    return true;
  }
}
