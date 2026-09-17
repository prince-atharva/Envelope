import { describe, expect, it } from 'vitest';
import { ApiError } from './api';

describe('ApiError', () => {
  it('constructs with all fields', () => {
    const error = new ApiError({
      status: 400,
      code: 'VALIDATION_FAILED',
      title: 'Validation Failed',
      detail: 'Some details',
      requestId: 'req-123',
      errors: [{ path: 'field1', message: 'invalid' }],
    });

    expect(error.status).toBe(400);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.detail).toBe('Some details');
    expect(error.requestId).toBe('req-123');
    expect(error.fieldErrors).toEqual([{ path: 'field1', message: 'invalid' }]);
    expect(error.message).toBe('Some details'); // Uses detail as message
  });

  it('uses title as message when detail is missing', () => {
    const error = new ApiError({
      status: 404,
      code: 'NOT_FOUND',
      title: 'Resource not found',
    });

    expect(error.message).toBe('Resource not found');
    expect(error.detail).toBeUndefined();
  });

  it('defaults fieldErrors to empty array', () => {
    const error = new ApiError({
      status: 500,
      code: 'INTERNAL_ERROR',
      title: 'Internal server error',
    });

    expect(error.fieldErrors).toEqual([]);
  });
});
