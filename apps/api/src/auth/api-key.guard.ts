import { createHmac } from 'node:crypto';
import { type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppException } from '../common/errors/app-exception';
import type { RequestContext } from '../common/request-context';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { API_KEY_ALLOWED_KEY, type ApiKeyAllowedOptions } from './api-key.decorator';
import type { AuthenticatedUser } from './auth.types';

/** The prefix every raw API key starts with; how JwtAuthGuard tells a key from a JWT. */
export const API_KEY_PREFIX = 'eak_';

/**
 * Verifies an API key (docs/08, "Server integration"; docs/18, ADR 0015) and
 * populates `req.user` with the same shape JWT auth uses, so every existing
 * controller, rate-limit bucket and ownership check works unmodified.
 * Invoked by `JwtAuthGuard` when a bearer token starts with `API_KEY_PREFIX`,
 * rather than competing with it as a second global guard.
 */
@Injectable()
export class ApiKeyGuard {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly cls: ClsService<RequestContext>,
    @InjectPinoLogger(ApiKeyGuard.name) private readonly logger: PinoLogger,
  ) {}

  private hash(rawKey: string): string {
    return createHmac('sha256', this.config.API_KEY_HASH_SECRET).update(rawKey).digest('hex');
  }

  async authenticate(rawKey: string, context: ExecutionContext): Promise<true> {
    const req = context.switchToHttp().getRequest<Request>();
    const allowed = this.reflector.getAllAndOverride<ApiKeyAllowedOptions | undefined>(
      API_KEY_ALLOWED_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!allowed) {
      this.logger.info({ path: req.path }, 'API key refused: route does not allow key auth');
      throw new AppException('API_KEY_NOT_ALLOWED');
    }

    const key = await this.prisma.apiKey.findUnique({ where: { keyHash: this.hash(rawKey) } });
    if (!key || key.revokedAt) {
      this.logger.info({ path: req.path, found: !!key }, 'API key refused: unknown or revoked');
      throw new AppException('API_KEY_INVALID');
    }
    if (allowed.write && key.readOnly) {
      this.logger.info({ apiKeyId: key.id }, 'API key refused: read-only key on a write route');
      throw new AppException('API_KEY_READ_ONLY');
    }

    const user: AuthenticatedUser = {
      id: key.actingUserId,
      tenantId: key.tenantId,
      sessionId: `apikey:${key.id}`,
      // Every key's acting user is provisioned with ADMIN (ADR 0015): "whole
      // tenant" scope, with no per-key ownership scoping.
      role: 'ADMIN',
      apiKeyId: key.id,
    };
    req.user = user;
    this.cls.set('userId', user.id);
    this.cls.set('tenantId', user.tenantId);
    this.cls.set('sessionId', user.sessionId);
    this.logger.assign({ userId: user.id, tenantId: user.tenantId, apiKeyId: key.id });

    // Not on the request's critical path; a lost update just delays "last used".
    void this.prisma.apiKey
      .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
      .catch((error: unknown) => {
        this.logger.warn({ err: error, apiKeyId: key.id }, 'Could not record API key last-used');
      });

    return true;
  }
}
