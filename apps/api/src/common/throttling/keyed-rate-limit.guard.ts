import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectThrottlerStorage, type ThrottlerStorage } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { countRequest, type RateLimitRule, rateLimited } from './rate-limit';

const RATE_LIMIT = 'keyedRateLimit';

export interface KeyedRateLimit extends RateLimitRule {
  /**
   * What the count is kept for: the signed-in user's workspace, or the account
   * a sign-in names (the email in the body, lower-cased).
   */
  by: 'tenant' | 'account';
}

/**
 * A limit counted per workspace or per account rather than per address
 * (docs/16 step 13), shared by every API server through the Redis storage.
 * Runs after the global sign-in guard, so the workspace is known.
 */
export function RateLimit(rule: Omit<KeyedRateLimit, 'windowMs'> & { windowMs?: number }) {
  return applyDecorators(
    SetMetadata(RATE_LIMIT, { windowMs: 60_000, ...rule }),
    UseGuards(KeyedRateLimitGuard),
  );
}

/** The limits of docs/16 step 13 that are not per address. */
export const LIMITS = {
  createAndSend: { bucket: 'tenant-create-send', limit: 100, by: 'tenant' },
  lifecycle: { bucket: 'tenant-lifecycle', limit: 30, by: 'tenant' },
  loginPerAccount: { bucket: 'login-account', limit: 5, by: 'account' },
} as const satisfies Record<string, Omit<KeyedRateLimit, 'windowMs'>>;

@Injectable()
export class KeyedRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectThrottlerStorage() private readonly storage: ThrottlerStorage,
    @InjectPinoLogger(KeyedRateLimitGuard.name) private readonly logger: PinoLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.get<KeyedRateLimit | undefined>(RATE_LIMIT, context.getHandler());
    if (!rule) return true;
    const req = context.switchToHttp().getRequest<Request>();
    const key = keyOf(rule, req);
    // Nothing to count on: the route's own validation refuses the request.
    if (!key) return true;

    const res = context.switchToHttp().getResponse<Response>();
    const count = await countRequest(this.storage, res, key, rule);
    if (!count.limited) return true;
    this.logger.warn(
      {
        bucket: rule.bucket,
        limit: rule.limit,
        hits: count.hits,
        retryAfter: count.retryAfter,
        // The workspace id is not personal; an account's email is never logged.
        ...(rule.by === 'tenant' ? { tenantId: req.user?.tenantId } : {}),
      },
      'Rate limit exceeded',
    );
    throw rateLimited(count.retryAfter);
  }
}

function keyOf(rule: KeyedRateLimit, req: Request): string | undefined {
  if (rule.by === 'tenant') return req.user?.tenantId;
  const email: unknown = (req.body as { email?: unknown } | undefined)?.email;
  return typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : undefined;
}
