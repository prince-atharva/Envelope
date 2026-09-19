import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';

import { InjectThrottlerStorage, type ThrottlerStorage } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { countRequest, rateLimited } from '../common/throttling/rate-limit';
import { tokenRef } from './signing-token';
import { TokenGuardianService } from './token-guardian.service';

const WINDOW_MS = 60_000;
/** docs/08: 60 reads and 10 writes a minute for each signing link. */
export const SIGNING_READS_PER_MINUTE = 60;
export const SIGNING_WRITES_PER_MINUTE = 10;

/**
 * Rate limits for the public signing routes, counted per link rather than per
 * address: many signers can share one office address, while one link belongs to
 * one person (docs/08, docs/10). The counter key is a hash of the token, never
 * the token.
 */
@Injectable()
export class SigningRateLimitGuard implements CanActivate {
  constructor(
    @InjectThrottlerStorage() private readonly storage: ThrottlerStorage,
    private readonly guardian: TokenGuardianService,
    @InjectPinoLogger(SigningRateLimitGuard.name) private readonly logger: PinoLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = typeof req.params.token === 'string' ? req.params.token : '';
    const hash = this.guardian.hash(token);
    const read = req.method === 'GET';
    const limit = read ? SIGNING_READS_PER_MINUTE : SIGNING_WRITES_PER_MINUTE;
    const bucket = read ? 'signing-reads' : 'signing-writes';

    const res = context.switchToHttp().getResponse<Response>();
    const count = await countRequest(this.storage, res, hash.slice(0, 32), {
      bucket,
      limit,
      windowMs: WINDOW_MS,
    });
    if (count.limited) {
      this.logger.warn(
        { tokenRef: tokenRef(hash), bucket, limit, hits: count.hits, retryAfter: count.retryAfter },
        'Signing link rate limit exceeded',
      );
      throw rateLimited(count.retryAfter);
    }
    return true;
  }
}
