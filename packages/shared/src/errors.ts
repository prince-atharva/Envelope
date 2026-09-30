/**
 * Every error the API can return, with its HTTP status. Responses use
 * RFC 7807 `application/problem+json` (docs/08-api-specification.md, "Errors").
 * The web app switches on `code`, never on `title` or `detail`.
 */
export const ERROR_CATALOG = {
  // Generic
  BAD_REQUEST: { status: 400, title: 'Bad request' },
  VALIDATION_FAILED: { status: 400, title: 'Request validation failed' },
  UNAUTHENTICATED: { status: 401, title: 'Authentication required' },
  FORBIDDEN: { status: 403, title: 'Forbidden' },
  NOT_FOUND: { status: 404, title: 'Not found' },
  CONFLICT: { status: 409, title: 'Conflict' },
  PAYLOAD_TOO_LARGE: { status: 413, title: 'Request body too large' },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, title: 'Unsupported media type' },
  RATE_LIMITED: { status: 429, title: 'Too many requests' },
  INTERNAL_ERROR: { status: 500, title: 'Internal server error' },
  SERVICE_UNAVAILABLE: { status: 503, title: 'Service unavailable' },

  EMBED_ORIGIN_NOT_ALLOWED: { status: 403, title: 'Embedded parent origin is not allowed' },
  EMBED_SESSION_INVALID: { status: 401, title: 'Invalid embedded session' },
  EMBED_SESSION_EXPIRED: { status: 401, title: 'Embedded session expired' },
  EMBED_LAUNCH_USED: { status: 409, title: 'Embedded launch already redeemed' },
  EMBED_SCOPE_DENIED: { status: 403, title: 'Embedded session does not allow this action' },
  EMBED_UPLOAD_BOUND: { status: 409, title: 'Embedded upload is already bound' },

  // Accounts and sessions
  INVALID_CREDENTIALS: { status: 401, title: 'Invalid email or password' },
  SESSION_EXPIRED: { status: 401, title: 'Session expired' },
  EMAIL_ALREADY_REGISTERED: { status: 409, title: 'Email already registered' },
  /** Signed in, but the account's role does not permit this (docs/17). */
  FORBIDDEN_ROLE: { status: 403, title: 'Your role does not allow this' },
  /** Removing or demoting the tenant's last owner (docs/17). */
  LAST_OWNER: { status: 409, title: 'Every tenant needs at least one owner' },
  /** An invitation link is unknown, malformed, or already accepted (docs/17 step 6). */
  INVITE_TOKEN_INVALID: { status: 401, title: 'Invalid or already-used invitation link' },
  INVITE_TOKEN_EXPIRED: { status: 401, title: 'Invitation link expired' },
  /** A password-reset link is unknown, malformed, already used or voided by a newer one (docs/19). */
  PASSWORD_RESET_TOKEN_INVALID: { status: 401, title: 'Invalid or already-used reset link' },
  PASSWORD_RESET_TOKEN_EXPIRED: { status: 401, title: 'Reset link expired' },
  /**
   * The current password given to change it was wrong (docs/19). 422, not 401: a
   * 401 makes the web client try a silent refresh and sign the person out.
   */
  CURRENT_PASSWORD_INCORRECT: { status: 422, title: 'Current password is incorrect' },
  /**
   * Second factor (docs/19, ADR 0024, ADR 0025). A wrong code is 422 for the same
   * reason as a wrong current password: a 401 would trigger a silent refresh.
   */
  TWO_FACTOR_CODE_INVALID: { status: 422, title: 'That code is not valid' },
  /** The sign-in step's token is missing, expired, tampered with or the wrong kind. */
  TWO_FACTOR_CHALLENGE_INVALID: { status: 401, title: 'Sign in again to continue' },
  /** The workspace requires two-factor, so it cannot be turned off, or cannot be required yet. */
  TWO_FACTOR_REQUIRED: { status: 403, title: 'Two-factor authentication is required' },
  TWO_FACTOR_ALREADY_ENABLED: { status: 409, title: 'Two-factor authentication is already on' },
  TWO_FACTOR_NOT_ENABLED: { status: 409, title: 'Two-factor authentication is not on' },

  // Upload hardening (docs/10)
  FILE_REQUIRED: { status: 400, title: 'A PDF file is required' },
  FILE_TOO_LARGE: { status: 413, title: 'File too large' },
  UNSUPPORTED_FILE_TYPE: { status: 415, title: 'Only PDF files are accepted' },
  INVALID_PDF: { status: 422, title: 'The file is not a valid PDF' },
  ENCRYPTED_PDF: { status: 422, title: 'Password-protected PDFs are not supported' },
  PAGE_LIMIT_EXCEEDED: { status: 422, title: 'Too many pages' },
  MALWARE_DETECTED: { status: 422, title: 'The file failed the security scan' },

  // Envelopes, fields and signing (docs/08)
  INVALID_COORDINATE_SPACE: { status: 400, title: 'Invalid coordinate space' },
  RATIO_OUT_OF_RANGE: { status: 400, title: 'Ratio out of range' },
  FIELD_EXCEEDS_PAGE: { status: 400, title: 'Field exceeds page' },
  PAGE_OUT_OF_RANGE: { status: 400, title: 'Page out of range' },
  ENVELOPE_NOT_DRAFT: { status: 409, title: 'Envelope is not a draft' },
  ENVELOPE_TERMINAL: { status: 409, title: 'Envelope is in a terminal state' },
  /** Past its deadline, or paused as EXPIRED: extend it first (ADR 0013). */
  ENVELOPE_EXPIRED: { status: 409, title: 'Envelope has expired' },
  RECIPIENT_EMAIL_TAKEN: { status: 409, title: 'That person is already on this envelope' },
  /** The draft changed since the client last read it: another tab or window edited it. */
  DRAFT_REVISION_MISMATCH: { status: 412, title: 'The draft changed since you loaded it' },
  DOCUMENT_CATEGORY_BLOCKED: { status: 422, title: 'Document category blocked' },
  RECIPIENT_HAS_NO_FIELDS: { status: 422, title: 'Recipient has no fields' },
  /** Anything else checkReadyToSend reports; `errors` lists every problem. */
  NOT_READY_TO_SEND: { status: 422, title: 'The envelope is not ready to send' },
  REQUIRED_FIELDS_INCOMPLETE: { status: 422, title: 'Required fields incomplete' },
  TOKEN_INVALID: { status: 401, title: 'Invalid signing link' },
  TOKEN_EXPIRED: { status: 401, title: 'Signing link expired' },
  TOKEN_ALREADY_USED: { status: 410, title: 'Signing link already used' },
  CONSENT_REQUIRED: { status: 403, title: 'Consent required' },
  /** The notice changed between being shown and being agreed to; show it again. */
  CONSENT_TEXT_CHANGED: { status: 409, title: 'The notice has changed' },
  INVALID_SIGNATURE_IMAGE: { status: 422, title: 'The signature image is not valid' },
  REMINDER_TOO_SOON: { status: 429, title: 'A reminder was sent recently' },
  /** A completion download link past its date (docs/15 step 6). */
  DOWNLOAD_LINK_EXPIRED: { status: 410, title: 'Download link expired' },
  /** A renewal was already sent for this link recently (docs/17 step 10). */
  DOWNLOAD_RENEW_TOO_SOON: { status: 429, title: 'A new link was already sent recently' },
  /** Cancel, extend, void or purge on an envelope under legal hold (docs/17). */
  ENVELOPE_ON_LEGAL_HOLD: { status: 409, title: 'Envelope is on legal hold' },
  /** Its retention period has passed and its files were purged (docs/17 step 8). */
  ENVELOPE_PURGED: { status: 410, title: 'Envelope was purged' },

  // API keys and webhooks (docs/08, docs/18)
  /** The bearer token is not a JWT and not a known, active API key. */
  API_KEY_INVALID: { status: 401, title: 'Invalid or revoked API key' },
  /** A recognised API key used on a route this phase does not allow it on. */
  API_KEY_NOT_ALLOWED: { status: 403, title: 'This endpoint requires a signed-in session' },
  /** A read-only API key used on a route that writes. */
  API_KEY_READ_ONLY: { status: 403, title: 'This API key is read-only' },
  /** The URL fails the webhook endpoint's https/public-host checks (docs/10, docs/18). */
  WEBHOOK_URL_NOT_ALLOWED: { status: 422, title: 'This URL cannot be used as a webhook endpoint' },
  /** Five active endpoints (docs/18 workstream 9: inactive ones no longer count). */
  WEBHOOK_ENDPOINT_LIMIT_REACHED: { status: 409, title: 'Webhook endpoint limit reached' },
  /** Twenty endpoints in all, active or not: delete an inactive one first. */
  WEBHOOK_ENDPOINT_TOTAL_LIMIT_REACHED: {
    status: 409,
    title: 'Too many saved webhook endpoints',
  },
  /** Permanent delete attempted on an endpoint that is still active. */
  WEBHOOK_ENDPOINT_ACTIVE: { status: 409, title: 'Deactivate this webhook endpoint first' },
  /** Redrive attempted on a delivery that is not FAILED or EXHAUSTED, or is past the 7-day window. */
  WEBHOOK_DELIVERY_NOT_REDRIVABLE: { status: 409, title: 'This delivery cannot be redriven' },

  // Idempotency (docs/08, API-03)
  IDEMPOTENCY_KEY_REQUIRED: { status: 400, title: 'An Idempotency-Key header is required' },
  /** The same key was sent again with a different request body. */
  IDEMPOTENCY_KEY_MISMATCH: {
    status: 422,
    title: 'Idempotency key reused with a different request',
  },
} as const satisfies Record<string, { status: number; title: string }>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

export interface ProblemFieldError {
  path: string;
  message: string;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
  detail?: string;
  instance?: string;
  /** Matches the X-Request-Id response header and every server log line for the request. */
  requestId?: string;
  errors?: ProblemFieldError[];
  /**
   * A finer reason within `code`, for the few codes where the client shows
   * different screens. `ENVELOPE_TERMINAL` carries a `TerminalReason`.
   */
  reason?: string;
}

/** Why a signing link leads nowhere: the envelope was cancelled, or someone declined. */
export type TerminalReason = 'VOIDED' | 'DECLINED' | 'YOU_DECLINED';

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.hasOwn(ERROR_CATALOG, value);
}
