import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';

/**
 * Records the matched route pattern (e.g. /api/v1/envelopes/:id) for the request
 * log line. It has to be read inside the handler: by the time the response
 * finishes, Express may report a middleware wildcard instead.
 */
@Injectable()
export class RoutePatternInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') {
      const http = context.switchToHttp();
      const req = http.getRequest<Request>();
      const route = req.route as { path?: unknown } | undefined;
      if (typeof route?.path === 'string') {
        http.getResponse<Response>().locals.route = `${req.baseUrl}${route.path}`;
      }
    }
    return next.handle();
  }
}
