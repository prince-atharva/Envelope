import { EMBED_ACCESS_PREFIX } from '@envelope/shared';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import type { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppException } from '../common/errors/app-exception';
import type { RequestContext } from '../common/request-context';
import { EMBED_ALLOWED, type EmbedPermission } from '../embed/embed.decorator';
import { EmbedSessionService } from '../embed/embed-session.service';
import { API_KEY_PREFIX, ApiKeyGuard } from './api-key.guard';
import { IS_PUBLIC_KEY } from './auth.decorators';
import type { AccessTokenClaims } from './auth.types';
import { SessionService } from './session.service';

/**
 * Global guard: every route needs a valid access token unless marked @Public().
 * The token's session must still be active, so logout and reuse detection take
 * effect immediately instead of when the token expires.
 *
 * A bearer token starting with API_KEY_PREFIX is an API key, not a JWT
 * (docs/18): it is delegated to ApiKeyGuard rather than added as a second,
 * competing global guard, since only one authentication result can set
 * `req.user`.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly sessions: SessionService,
    private readonly embedSessions: EmbedSessionService,
    private readonly apiKeys: ApiKeyGuard,
    private readonly cls: ClsService<RequestContext>,
    @InjectPinoLogger(JwtAuthGuard.name) private readonly logger: PinoLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      const authorization = context.switchToHttp().getRequest<Request>().headers.authorization;
      if (authorization?.startsWith(`Bearer ${EMBED_ACCESS_PREFIX}`))
        throw new AppException('EMBED_SCOPE_DENIED');
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      this.logger.debug('Request without a bearer token');
      throw new AppException('UNAUTHENTICATED');
    }

    if (token.startsWith(EMBED_ACCESS_PREFIX)) {
      const permission = this.reflector.get<EmbedPermission | undefined>(
        EMBED_ALLOWED,
        context.getHandler(),
      );
      if (!permission) throw new AppException('EMBED_SCOPE_DENIED');
      const user = await this.embedSessions.authenticate(token);
      const embed = user.embed;
      if (!embed) throw new AppException('EMBED_SCOPE_DENIED');
      if (permission === 'edit' || permission === 'send') {
        if (!embed.actions.includes(permission)) throw new AppException('EMBED_SCOPE_DENIED');
      }
      if (permission === 'upload' && embed.mode !== 'upload')
        throw new AppException('EMBED_SCOPE_DENIED');
      if (['read', 'edit', 'send'].includes(permission)) {
        if (!embed.envelopeId || req.params.id !== embed.envelopeId)
          throw new AppException('EMBED_SCOPE_DENIED');
        if (
          req.path.endsWith('/file') &&
          req.query.version !== undefined &&
          req.query.version !== '0'
        ) {
          throw new AppException('EMBED_SCOPE_DENIED');
        }
      }
      req.user = user;
      return true;
    }

    if (token.startsWith(API_KEY_PREFIX)) {
      return this.apiKeys.authenticate(token, context);
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

    // A sign-in challenge token (ADR 0024) carries a `purpose` and no session: it
    // proves the password step only and is never an access token.
    if (!claims.sid || 'purpose' in claims) {
      this.logger.warn({ reason: 'not-an-access-token' }, 'Invalid access token');
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
