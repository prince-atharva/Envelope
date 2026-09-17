import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppException } from './app-exception';
import { mapException } from './map-exception';
import { problemType } from './problem-details.filter';

describe('mapException', () => {
  it('uses the shared catalog for AppException', () => {
    const problem = mapException(
      new AppException('ENCRYPTED_PDF', 'Remove the password and upload again.'),
    );
    expect(problem).toMatchObject({
      status: 422,
      code: 'ENCRYPTED_PDF',
      title: 'Password-protected PDFs are not supported',
      detail: 'Remove the password and upload again.',
      unexpected: false,
    });
  });

  it('turns zod errors into per-field validation errors', () => {
    const result = z.object({ email: z.email() }).safeParse({ email: 'nope' });
    expect(result.success).toBe(false);
    const problem = mapException(result.error);
    expect(problem.status).toBe(400);
    expect(problem.code).toBe('VALIDATION_FAILED');
    expect(problem.errors).toEqual([{ path: 'email', message: expect.any(String) }]);
  });

  it('maps rate limiting to RATE_LIMITED', () => {
    expect(mapException(new ThrottlerException())).toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
    });
  });

  it('maps Nest HTTP exceptions by status', () => {
    expect(mapException(new NotFoundException('Cannot GET /api/v1/nope'))).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      detail: 'Cannot GET /api/v1/nope',
      unexpected: false,
    });
  });

  it('maps middleware errors that carry a status (body-parser, multer)', () => {
    const tooLarge = Object.assign(new Error('request entity too large'), { status: 413 });
    expect(mapException(tooLarge)).toMatchObject({ status: 413, code: 'PAYLOAD_TOO_LARGE' });
  });

  it('hides the details of unexpected errors', () => {
    const problem = mapException(new Error('connection string postgres://x:y@db'));
    expect(problem).toEqual({
      status: 500,
      code: 'INTERNAL_ERROR',
      title: 'Internal server error',
      unexpected: true,
    });
    expect(mapException(new InternalServerErrorException('secret detail')).detail).toBeUndefined();
  });

  it('builds a stable problem type URI from the code', () => {
    expect(problemType('INVALID_CREDENTIALS')).toBe('urn:digitalsign:error:invalid-credentials');
  });
});
