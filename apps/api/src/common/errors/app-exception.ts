import { ERROR_CATALOG, type ErrorCode, type ProblemFieldError } from '@digitalsign/shared';

export interface AppExceptionOptions {
  errors?: ProblemFieldError[];
  /** Overrides the catalog status (rarely needed). */
  status?: number;
  headers?: Record<string, string>;
  cause?: unknown;
}

/**
 * The one exception type services throw for expected failures. The global
 * ProblemDetailsFilter turns it into an RFC 7807 response using the shared
 * error catalog, so the web app can rely on `code`.
 */
export class AppException extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    readonly detail?: string,
    readonly options: AppExceptionOptions = {},
  ) {
    super(detail ?? ERROR_CATALOG[code].title, { cause: options.cause });
    this.name = 'AppException';
    this.status = options.status ?? ERROR_CATALOG[code].status;
  }
}
