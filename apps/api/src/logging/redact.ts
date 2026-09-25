/**
 * Everything that keeps secrets and personal data out of the logs.
 *
 * Three layers:
 *  1. REDACT_PATHS: pino replaces these object keys with "[redacted]".
 *  2. scrubSecrets(): masks bearer tokens, JWTs and signing links inside free text
 *     (log messages, error messages, stack traces).
 *  3. Helpers for fields we do want to log in partial form (emails, URLs).
 */

export const REDACTED = '[redacted]';

const SENSITIVE_KEYS = [
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'token',
  'accessToken',
  'refreshToken',
  'signingToken',
  'rawToken',
  'rawKey',
  'signingUrl',
  'downloadUrl',
  'tokenHash',
  'keyHash',
  'secret',
  'apiKey',
  'authorization',
  'cookie',
  'SMTP_PASSWORD',
  'JWT_ACCESS_SECRET',
  'REFRESH_TOKEN_SECRET',
  'SIGNING_TOKEN_SECRET',
  'S3_SECRET_ACCESS_KEY',
  'DATABASE_URL',
  'DIRECT_DATABASE_URL',
];

/** pino `redact` paths: each sensitive key at the top level and one level down. */
export const REDACT_PATHS: string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  'headers["set-cookie"]',
  'auth.pass',
  '*.auth.pass',
  ...SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`]),
];

const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g;
// Stops at ':' and ')' as well, so a stack frame keeps its line number. Real
// tokens are hex and contain neither.
// Signing links and completion download links alike.
const SIGNING_PATH = /(\/(?:sign|download)\/)[^/?#\s"':)]+/gi;
const SECRET_QUERY = /([?&](?:token|code|access_token|refresh_token|signature)=)[^&#\s"']+/gi;
const URL_CREDENTIALS = /(\b[a-z][a-z0-9+.-]*:\/\/[^:/?#\s]+:)[^@/?#\s]+@/gi;

/** Masks credentials that can appear inside any free-text string. */
export function scrubSecrets(text: string): string {
  return text
    .replace(BEARER, `$1 ${REDACTED}`)
    .replace(JWT, REDACTED)
    .replace(SIGNING_PATH, `$1${REDACTED}`)
    .replace(SECRET_QUERY, `$1${REDACTED}`)
    .replace(URL_CREDENTIALS, `$1${REDACTED}@`);
}

/** A URL or path with signing tokens and secret query parameters removed. */
export function redactUrl(url: string | undefined): string | undefined {
  return url === undefined ? undefined : scrubSecrets(url);
}

/** "raj.kumar@example.com" becomes "r***@example.com". */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return REDACTED;
  const at = email.lastIndexOf('@');
  if (at < 1) return REDACTED;
  return `${email[0]}***${email.slice(at)}`;
}
