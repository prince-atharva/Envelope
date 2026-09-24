import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { ClsService } from 'nestjs-cls';
import type { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import type { RequestContext } from '../common/request-context';

/**
 * Records how many database queries a request made, for the request's own
 * log line (pino-options.ts) — a high count on one endpoint is the N+1
 * pattern the 100M-row scale audit went looking for (docs/16 step 14).
 *
 * Read after the handler finishes, not before: PrismaService tallies the
 * count onto the request's CLS store as queries run, so the total is only
 * final once the handler's observable completes.
 */
@Injectable()
export class DbQueryCountInterceptor implements NestInterceptor {
  constructor(private readonly cls: ClsService<RequestContext>) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const res = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      finalize(() => {
        res.locals.dbQueryCount = this.cls.isActive() ? (this.cls.get('dbQueryCount') ?? 0) : 0;
      }),
    );
  }
}
