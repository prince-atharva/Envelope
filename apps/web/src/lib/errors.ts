import { type ErrorCode, MAX_PDF_PAGES, MAX_UPLOAD_BYTES } from '@envelope/shared';
import { ApiError } from './api';
import { formatBytes } from './format';

const MESSAGES: Partial<Record<ErrorCode, string>> = {
  INVALID_CREDENTIALS: 'That email and password do not match.',
  EMAIL_ALREADY_REGISTERED: 'An account with this email already exists. Try signing in instead.',
  SESSION_EXPIRED: 'Your session has ended. Please sign in again.',
  UNAUTHENTICATED: 'Please sign in to continue.',
  RATE_LIMITED: 'Too many attempts. Please wait a minute and try again.',
  FILE_REQUIRED: 'Choose a PDF to upload.',
  FILE_TOO_LARGE: `That PDF is larger than ${formatBytes(MAX_UPLOAD_BYTES)}.`,
  UNSUPPORTED_FILE_TYPE: 'That file is not a PDF.',
  ENCRYPTED_PDF: 'That PDF is password-protected. Remove the password and try again.',
  PAGE_LIMIT_EXCEEDED: `That PDF has more than ${MAX_PDF_PAGES} pages.`,
  INVALID_PDF: 'That PDF appears to be damaged and could not be read.',
  MALWARE_DETECTED: 'That file did not pass the security scan.',
  NOT_FOUND: 'We could not find that document.',
  ENVELOPE_NOT_DRAFT: 'This document has already been sent.',
  VALIDATION_FAILED: 'Some of those details are not valid. Check them and try again.',
  RECIPIENT_EMAIL_TAKEN: 'That person is already on this document.',
  RECIPIENT_HAS_NO_FIELDS: 'Everyone who signs needs at least one field on the document.',
  NOT_READY_TO_SEND: 'This document is not ready to send yet. Check the list on the review screen.',
  DRAFT_REVISION_MISMATCH:
    'This document was changed in another tab. Reload to see the latest version.',
  REMINDER_TOO_SOON: 'A reminder was sent in the last 24 hours. Try again tomorrow.',
  INVALID_SIGNATURE_IMAGE: 'That signature could not be used. Please try again.',
  REQUIRED_FIELDS_INCOMPLETE: 'Some required boxes are still empty.',
  CONSENT_REQUIRED: 'Please agree to sign electronically first. Reload the page to see the notice.',
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
    // An unmapped code used to fall through to the RFC 7807 title, which is
    // written for a developer reading a response body, not for the person
    // looking at the screen. The request id is what support actually needs.
    return {
      message: 'That did not work. Please try again, or contact support with the reference below.',
      reference: error.requestId,
    };
  }
  return { message: 'Something unexpected happened. Please try again.' };
}

/** Field-level messages from a VALIDATION_FAILED response, keyed by field name. */
export function fieldErrorsOf(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  return Object.fromEntries(error.fieldErrors.map((field) => [field.path, field.message]));
}
