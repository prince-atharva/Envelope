/** Upload limits from docs/10-security-and-threat-model.md ("Upload Hardening"). */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_PDF_PAGES = 500;

/** Sender password policy (docs/10: Argon2id for sender accounts). */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** Browser error reports sent to POST /client-logs are capped at this size. */
export const CLIENT_LOG_MAX_BYTES = 8 * 1024;

/**
 * Draft limits (Phase 2). The specification gives no numbers, so these are ours.
 *
 * The field cap is what makes the layout request a predictable size: 1000 fields
 * is roughly 250 kB of JSON, well inside the 1 MB body limit, and it still
 * allows initials on every page of a 200-page document for five signers.
 */
export const MAX_RECIPIENTS_PER_ENVELOPE = 50;
export const MAX_FIELDS_PER_ENVELOPE = 1000;
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_RECIPIENT_NAME_LENGTH = 200;
