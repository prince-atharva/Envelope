import type { ErrorCode } from '@envelope/shared';
import { ApiError } from './api';

const MESSAGES: Partial<Record<ErrorCode, string>> = {
  INVALID_CREDENTIALS: 'That email and password do not match.',
  EMAIL_ALREADY_REGISTERED: 'An account with this email already exists. Try signing in instead.',
  SESSION_EXPIRED: 'Your session has ended. Please sign in again.',
  UNAUTHENTICATED: 'Please sign in to continue.',
  RATE_LIMITED: 'Too many attempts. Please wait a minute and try again.',
  FILE_REQUIRED: 'Choose a PDF to upload.',
  FILE_TOO_LARGE: 'That PDF is larger than 25 MB.',
  UNSUPPORTED_FILE_TYPE: 'That file is not a PDF.',
  ENCRYPTED_PDF: 'That PDF is password-protected. Remove the password and try again.',
  PAGE_LIMIT_EXCEEDED: 'That PDF has more than 500 pages.',
  INVALID_PDF: 'That PDF appears to be damaged and could not be read.',
  MALWARE_DETECTED: 'That file did not pass the security scan.',
  NOT_FOUND: 'We could not find that document.',
  SERVICE_UNAVAILABLE: 'Cannot reach Envelope right now. Check your connection and try again.',
};

/** A message a person can act on, plus a reference id for unexpected failures. */
export function describeError(error: unknown): { message: string; reference?: string } {
  if (error instanceof ApiError) {
    const known = MESSAGES[error.code];
    if (known) return { message: known };
    if (error.status >= 500) {
      return {
        message: 'Something went wrong on our side. Please try again.',
        reference: error.requestId,
      };
    }
    return { message: error.detail ?? error.message, reference: error.requestId };
  }
  return { message: 'Something unexpected happened. Please try again.' };
}

/** Field-level messages from a VALIDATION_FAILED response, keyed by field name. */
export function fieldErrorsOf(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  return Object.fromEntries(error.fieldErrors.map((field) => [field.path, field.message]));
}
