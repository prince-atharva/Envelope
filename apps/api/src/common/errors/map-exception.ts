import { ERROR_CATALOG, type ErrorCode, type ProblemFieldError } from '@envelope/shared';
import { HttpException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { ZodError } from 'zod';
import { AppException } from './app-exception';

export interface MappedProblem {
  status: number;
  code: ErrorCode;
  title: string;
  detail?: string;
  errors?: ProblemFieldError[];
  headers?: Record<string, string>;
  /** True for bugs and outages: logged with a stack trace, detail hidden from the client. */
  unexpected: boolean;
}

const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

function codeForStatus(status: number): ErrorCode {
  return CODE_BY_STATUS[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST');
}

function fromStatus(status: number, detail: string | undefined): MappedProblem {
  const code = codeForStatus(status);
  const unexpected = status >= 500;
  return {
    status,
    code,
    title: ERROR_CATALOG[code].title,
    detail: unexpected ? undefined : detail,
    unexpected,
  };
}

function httpExceptionDetail(exception: HttpException): string | undefined {
  const response = exception.getResponse();
  if (typeof response === 'string') return response;
  const message = (response as { message?: unknown }).message;
  if (Array.isArray(message)) return message.join('; ');
  return typeof message === 'string' ? message : undefined;
}

/** Errors raised by Express middleware (body-parser, multer) carry a numeric status. */
function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { status, statusCode } = error as { status?: unknown; statusCode?: unknown };
  const value = typeof status === 'number' ? status : statusCode;
  return typeof value === 'number' && value >= 400 && value <= 599 ? value : undefined;
}

/** Turns anything thrown during a request into the fields of an RFC 7807 response. */
export function mapException(exception: unknown): MappedProblem {
  if (exception instanceof AppException) {
    return {
      status: exception.status,
      code: exception.code,
      title: ERROR_CATALOG[exception.code].title,
      detail: exception.detail,
      errors: exception.options.errors,
      headers: exception.options.headers,
      unexpected: exception.status >= 500,
    };
  }

  if (exception instanceof ZodError) {
    return {
      status: 400,
      code: 'VALIDATION_FAILED',
      title: ERROR_CATALOG.VALIDATION_FAILED.title,
      detail: 'One or more fields are invalid.',
      errors: exception.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
      unexpected: false,
    };
  }

  if (exception instanceof ThrottlerException) {
    return {
      status: 429,
      code: 'RATE_LIMITED',
      title: ERROR_CATALOG.RATE_LIMITED.title,
      detail: 'Too many requests. Please wait a moment and try again.',
      unexpected: false,
    };
  }

  if (exception instanceof HttpException) {
    return fromStatus(exception.getStatus(), httpExceptionDetail(exception));
  }

  const status = statusOf(exception);
  if (status !== undefined) {
    const message = exception instanceof Error ? exception.message : undefined;
    return fromStatus(status, message);
  }

  return {
    status: 500,
    code: 'INTERNAL_ERROR',
    title: ERROR_CATALOG.INTERNAL_ERROR.title,
    unexpected: true,
  };
}
