import { createHash } from 'node:crypto';
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
   * What the count is kept for: the signed-in user, their workspace, or the account
   * a sign-in names (the email in the body, lower-cased).
   */
  by: 'tenant' | 'account' | 'user' | 'challenge' | 'embed' | 'embedLaunch' | 'tenantKey';
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
  /** Changing workspace branding; a logo upload is an image decode (docs/22, ADR 0034). */
  branding: { bucket: 'tenant-branding', limit: 20, by: 'tenant' },
  /** The workspace signing numbers are live queries over every envelope in the window (docs/22). */
  reports: { bucket: 'tenant-reports', limit: 30, by: 'tenant' },
  /** Cutting the certificate out of a sealed PDF is CPU work (docs/18, workstream 11). */
  certificate: { bucket: 'tenant-certificate', limit: 30, by: 'tenant' },
  /** Starting a bulk send. Each batch is up to 500 envelopes, so this is per hour (docs/20, ADR 0028). */
  bulkBatch: { bucket: 'tenant-bulk-batch', limit: 10, windowMs: 3_600_000, by: 'tenant' },
  loginPerAccount: { bucket: 'login-account', limit: 5, by: 'account' },
  /** Changing one's own password needs the current one; this bounds guessing it with a stolen session. */
  passwordChangePerUser: {
    bucket: 'password-change-user',
    limit: 5,
    windowMs: 3_600_000,
    by: 'user',
  },
  /**
   * Attempts to answer one sign-in challenge. New challenges need the password,
   * which the sign-in limits bound, so this bounds guessing a code (ADR 0024).
   */
  mfaChallenge: { bucket: 'mfa-challenge', limit: 5, windowMs: 300_000, by: 'challenge' },
  /** Six-digit codes have a million values; this keeps a stolen session from guessing one (ADR 0024). */
  twoFactorPerUser: {
    bucket: 'two-factor-user',
    limit: 10,
    windowMs: 900_000,
    by: 'user',
  },
  /** Bounds how many reset emails one mailbox can be sent, from however many addresses (ADR 0022). */
  passwordResetPerAccount: {
    bucket: 'password-reset-account',
    limit: 3,
    windowMs: 3_600_000,
    by: 'account',
  },
} as const satisfies Record<string, Omit<KeyedRateLimit, 'windowMs'> & { windowMs?: number }>;

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
    if (rule.by === 'tenantKey' && req.user?.apiKeyId) {
      const keyCount = await countRequest(this.storage, res, req.user.apiKeyId, {
        ...rule,
        bucket: `${rule.bucket}-key`,
      });
      if (keyCount.limited) throw rateLimited(keyCount.retryAfter);
    }
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
  if (rule.by === 'embed') return req.user?.embed?.id;
  if (rule.by === 'challenge') {
    const token: unknown = (req.body as { challengeToken?: unknown } | undefined)?.challengeToken;
    return typeof token === 'string' && token
      ? createHash('sha256').update(token).digest('hex')
      : undefined;
  }
  if (rule.by === 'embedLaunch') {
    const token: unknown = (req.body as { launchToken?: unknown } | undefined)?.launchToken;
    return typeof token === 'string' ? createHash('sha256').update(token).digest('hex') : undefined;
  }
  if (rule.by === 'user') return req.user?.id;
  if (rule.by === 'tenant' || rule.by === 'tenantKey') return req.user?.tenantId;
  const email: unknown = (req.body as { email?: unknown } | undefined)?.email;
  return typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : undefined;
}
