import type { ProblemDetails } from '@digitalsign/shared';
import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { redactUrl, scrubSecrets } from '../../logging/redact';
import { mapException } from './map-exception';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

export function problemType(code: string): string {
  return `urn:digitalsign:error:${code.toLowerCase().replaceAll('_', '-')}`;
}

/**
 * Global exception filter: every error response is RFC 7807 problem+json
 * (docs/08, "Errors") and carries the request id.
 *
 * Logging: unexpected errors (5xx) are logged here with their stack trace.
 * Expected errors are not logged again here; the error code is attached to the
 * per-request log line instead (see pino-options.ts).
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(@InjectPinoLogger(ProblemDetailsFilter.name) private readonly logger: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      throw exception;
    }
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const problem = mapException(exception);

    if (problem.unexpected) {
      this.logger.error(
        { err: exception, errorCode: problem.code, status: problem.status },
        'Unhandled error while processing request',
      );
    }

    if (res.headersSent) {
      this.logger.warn(
        { errorCode: problem.code },
        'Error after the response had started; closing the connection',
      );
      res.destroy();
      return;
    }

    res.locals.errorCode = problem.code;
    for (const [name, value] of Object.entries(problem.headers ?? {})) {
      res.setHeader(name, value);
    }

    const body: ProblemDetails = {
      type: problemType(problem.code),
      title: problem.title,
      status: problem.status,
      code: problem.code,
      detail: problem.detail === undefined ? undefined : scrubSecrets(problem.detail),
      instance: redactUrl(req.originalUrl),
      requestId: typeof req.id === 'string' ? req.id : undefined,
      errors: problem.errors,
    };

    res.status(problem.status).type(PROBLEM_CONTENT_TYPE).json(body);
  }
}
