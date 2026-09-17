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

  // Accounts and sessions
  INVALID_CREDENTIALS: { status: 401, title: 'Invalid email or password' },
  SESSION_EXPIRED: { status: 401, title: 'Session expired' },
  EMAIL_ALREADY_REGISTERED: { status: 409, title: 'Email already registered' },

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
  DOCUMENT_CATEGORY_BLOCKED: { status: 422, title: 'Document category blocked' },
  RECIPIENT_HAS_NO_FIELDS: { status: 422, title: 'Recipient has no fields' },
  REQUIRED_FIELDS_INCOMPLETE: { status: 422, title: 'Required fields incomplete' },
  TOKEN_INVALID: { status: 401, title: 'Invalid signing link' },
  TOKEN_EXPIRED: { status: 401, title: 'Signing link expired' },
  TOKEN_ALREADY_USED: { status: 410, title: 'Signing link already used' },
  CONSENT_REQUIRED: { status: 403, title: 'Consent required' },
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
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.hasOwn(ERROR_CATALOG, value);
}
