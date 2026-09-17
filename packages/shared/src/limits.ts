/** Upload limits from docs/10-security-and-threat-model.md ("Upload Hardening"). */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_PDF_PAGES = 500;

/** Sender password policy (docs/10: Argon2id for sender accounts). */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** Browser error reports sent to POST /client-logs are capped at this size. */
export const CLIENT_LOG_MAX_BYTES = 8 * 1024;
