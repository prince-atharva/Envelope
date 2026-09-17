import { MAX_UPLOAD_BYTES } from '@digitalsign/shared';
import {
  type CallHandler,
  type CanActivate,
  type ExecutionContext,
  HttpException,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { InjectThrottlerStorage, type ThrottlerStorage } from '@nestjs/throttler';
import type { Request } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { catchError, type Observable, throwError } from 'rxjs';
import { AppException } from '../common/errors/app-exception';

/** Room for the multipart boundaries and the title field around the PDF itself. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/**
 * Upload step 1, before a single byte of the body is read (docs/10): reject by the
 * declared Content-Length. Multer's own limit still applies to the actual bytes.
 */
@Injectable()
export class UploadSizeGuard implements CanActivate {
  constructor(@InjectPinoLogger(UploadSizeGuard.name) private readonly logger: PinoLogger) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES) {
      this.logger.warn(
        { declaredBytes: declared, step: 'size', errorCode: 'FILE_TOO_LARGE' },
        'PDF rejected',
      );
      // The body will not be read; close the connection once the response is sent.
      req.res?.setHeader('Connection', 'close');
      throw new AppException('FILE_TOO_LARGE', 'PDFs are limited to 25 MB.');
    }
    return true;
  }
}

const UPLOADS_PER_MINUTE = 20;
const WINDOW_MS = 60_000;

/** docs/08: document uploads are limited to 20 per minute per tenant. */
@Injectable()
export class TenantUploadRateLimitGuard implements CanActivate {
  constructor(
    @InjectThrottlerStorage() private readonly storage: ThrottlerStorage,
    @InjectPinoLogger(TenantUploadRateLimitGuard.name) private readonly logger: PinoLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const tenantId = req.user?.tenantId;
    if (!tenantId) return true; // JwtAuthGuard rejects the request anyway.

    const record = await this.storage.increment(
      `tenant-uploads:${tenantId}`,
      WINDOW_MS,
      UPLOADS_PER_MINUTE,
      WINDOW_MS,
      'tenant-uploads',
    );
    if (record.totalHits > UPLOADS_PER_MINUTE) {
      const retryAfter = Math.max(1, Math.ceil(record.timeToExpire / 1000));
      this.logger.warn(
        { tenantId, limit: UPLOADS_PER_MINUTE, hits: record.totalHits, retryAfter },
        'Tenant upload rate limit exceeded',
      );
      throw new AppException('RATE_LIMITED', 'Too many uploads. Please wait a moment.', {
        headers: { 'Retry-After': String(retryAfter) },
      });
    }
    return true;
  }
}

const WRONG_FILE_FIELD = 'Send exactly one PDF in the "file" form field.';

/** Maps a multipart parsing error (multer's own, or Nest's translation of it) to an upload error. */
export function uploadErrorFor(error: unknown): AppException | undefined {
  if (error instanceof Error && error.name === 'MulterError') {
    const code = (error as Error & { code?: string }).code;
    if (code === 'LIMIT_FILE_SIZE')
      return new AppException('FILE_TOO_LARGE', 'PDFs are limited to 25 MB.');
    if (code === 'LIMIT_UNEXPECTED_FILE' || code === 'LIMIT_FILE_COUNT') {
      return new AppException('FILE_REQUIRED', WRONG_FILE_FIELD);
    }
    return new AppException('BAD_REQUEST', 'The upload form is malformed.');
  }
  if (error instanceof HttpException && error.getStatus() === 413) {
    return new AppException('FILE_TOO_LARGE', 'PDFs are limited to 25 MB.');
  }
  if (error instanceof HttpException && error.getStatus() === 400) {
    return new AppException('FILE_REQUIRED', WRONG_FILE_FIELD);
  }
  return undefined;
}

/**
 * Turns multipart parsing errors into the specific upload error codes.
 * Must be listed before FileInterceptor so it wraps it.
 */
@Injectable()
export class UploadErrorsInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next
      .handle()
      .pipe(catchError((error: unknown) => throwError(() => uploadErrorFor(error) ?? error)));
  }
}
