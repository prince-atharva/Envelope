import { type ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import type { Request } from 'express';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

/** The standard rate limiter, plus a warning log line whenever a limit is hit. */
@Injectable()
export class LoggingThrottlerGuard extends ThrottlerGuard {
  @InjectPinoLogger(LoggingThrottlerGuard.name)
  private readonly logger!: PinoLogger;

  protected override async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const req = context.switchToHttp().getRequest<Request>();
    this.logger.warn(
      {
        ip: req.ip,
        route: `${req.method} ${req.route?.path ?? req.path}`,
        limit: detail.limit,
        windowMs: detail.ttl,
        hits: detail.totalHits,
      },
      'Rate limit exceeded',
    );
    return super.throwThrottlingException(context, detail);
  }
}
