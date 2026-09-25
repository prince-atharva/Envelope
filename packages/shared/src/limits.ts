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

/**
 * Signing limits (Phase 3).
 *
 * The image cap is doc 06's "~500 KB". As a base64 data URL it is about 683 kB,
 * so an adopt request stays inside the 1 MB JSON body limit. The dimension cap
 * is generous: a full-width pad at a device pixel ratio of 3 is under 2000px.
 */
export const MAX_SIGNATURE_IMAGE_BYTES = 500 * 1024;
export const MAX_SIGNATURE_IMAGE_DIMENSION = 4096;
export const MAX_DECLINE_REASON_LENGTH = 1000;
export const MAX_VOID_REASON_LENGTH = 1000;
export const MAX_TEXT_VALUE_LENGTH = 500;

/** How long signing links last unless the sender chooses otherwise (docs/10: 14 days). */
export const DEFAULT_EXPIRY_DAYS = 14;
export const MAX_EXPIRY_DAYS = 90;
/** Automatic reminders (docs/16 step 10): the choice the send dialog starts on, and the range. */
export const DEFAULT_REMINDER_INTERVAL_DAYS = 3;
export const MAX_REMINDER_INTERVAL_DAYS = 30;

/** docs/08: reminders are limited to one per recipient per 24 hours. */
export const REMINDER_COOLDOWN_HOURS = 24;

/**
 * Retention windows (docs/05, docs/17 step 8). Completed envelopes use the
 * frozen policy's own `retentionYears` instead of a constant here.
 */
export const DRAFT_RETENTION_DAYS = 90;
export const VOIDED_RETENTION_DAYS = 365;

/** A download link renewal is limited to one per link per this long (docs/17 step 10). */
export const DOWNLOAD_RENEW_COOLDOWN_HOURS = 24;

export const MAX_LEGAL_HOLD_REASON_LENGTH = 1000;

/** How long a tenant invitation link works (docs/17 step 6). */
export const INVITE_TOKEN_EXPIRY_DAYS = 7;
