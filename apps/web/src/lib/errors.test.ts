import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { describeError, fieldErrorsOf } from './errors';

describe('errors', () => {
  describe('describeError', () => {
    it('returns known message for ApiError with known code', () => {
      const error = new ApiError({ status: 401, code: 'INVALID_CREDENTIALS', title: 'Invalid' });
      expect(describeError(error)).toEqual({ message: 'That email and password do not match.' });
    });

    it('returns known message for another known code', () => {
      const error = new ApiError({ status: 413, code: 'FILE_TOO_LARGE', title: 'Large' });
      expect(describeError(error)).toEqual({ message: 'That PDF is larger than 25 MB.' });
    });

    it('returns generic message with reference for 5xx ApiError', () => {
      const error = new ApiError({
        status: 500,
        code: 'INTERNAL_ERROR',
        title: 'Internal',
        requestId: 'req-123',
      });
      expect(describeError(error)).toEqual({
        message: 'Something went wrong on our side. Please try again.',
        reference: 'req-123',
      });
    });

    it('explains a recipient who is already on the document', () => {
      const error = new ApiError({
        status: 409,
        code: 'RECIPIENT_EMAIL_TAKEN',
        title: 'That person is already on this envelope',
      });
      expect(describeError(error)).toEqual({ message: 'That person is already on this document.' });
    });

    it('keeps the server wording off the screen for an unmapped 4xx', () => {
      const generic =
        'That did not work. Please try again, or contact support with the reference below.';

      const error = new ApiError({
        status: 400,
        code: 'BAD_REQUEST',
        title: 'Title only',
        requestId: 'req-456',
      });
      expect(describeError(error)).toEqual({ message: generic, reference: 'req-456' });

      // `detail` is written for whoever reads the response body, not for the
      // person looking at the screen, so it stays out of the message too.
      const errorWithDetail = new ApiError({
        status: 400,
        code: 'BAD_REQUEST',
        title: 'Title',
        detail: 'Specific detail',
        requestId: 'req-789',
      });
      expect(describeError(errorWithDetail)).toEqual({ message: generic, reference: 'req-789' });
    });

    it('returns unexpected message for non-ApiError', () => {
      const error = new Error('Random error');
      expect(describeError(error)).toEqual({
        message: 'Something unexpected happened. Please try again.',
      });
    });
  });

  describe('fieldErrorsOf', () => {
    it('returns field errors map for ApiError with fieldErrors', () => {
      const error = new ApiError({
        status: 400,
        code: 'VALIDATION_FAILED',
        title: 'Validation failed',
        errors: [
          { path: 'email', message: 'Required' },
          { path: 'password', message: 'Too short' },
        ],
      });
      expect(fieldErrorsOf(error)).toEqual({ email: 'Required', password: 'Too short' });
    });

    it('returns empty object for ApiError without field errors', () => {
      const error = new ApiError({ status: 400, code: 'BAD_REQUEST', title: 'Bad request' });
      expect(fieldErrorsOf(error)).toEqual({});
    });

    it('returns empty object for non-ApiError', () => {
      const error = new Error('Random error');
      expect(fieldErrorsOf(error)).toEqual({});
    });
  });
});
