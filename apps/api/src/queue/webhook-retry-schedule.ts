/**
 * 10s, 1m, 5m, 30m, 2h, 12h — 6 attempts over ~15 hours (docs/08,
 * "Delivery"). Not BullMQ's built-in exponential backoff, which cannot
 * produce this exact, documented shape. Overridable via
 * `WEBHOOK_RETRY_SCHEDULE_MS` (env.schema.ts) so the e2e suite can run the
 * same retry and exhaustion logic in milliseconds instead of hours — the
 * same reason `EMAIL_RETRY_BASE_DELAY_MS` exists.
 */
export const DEFAULT_WEBHOOK_RETRY_SCHEDULE_MS = [
  10_000, 60_000, 300_000, 1_800_000, 7_200_000, 43_200_000,
] as const;

export const WEBHOOK_MAX_ATTEMPTS = DEFAULT_WEBHOOK_RETRY_SCHEDULE_MS.length;

export function parseWebhookRetrySchedule(raw: string): number[] {
  const values = raw.split(',').map((v) => Number.parseInt(v.trim(), 10));
  const valid = values.length === WEBHOOK_MAX_ATTEMPTS && values.every((v) => Number.isFinite(v));
  return valid ? values : [...DEFAULT_WEBHOOK_RETRY_SCHEDULE_MS];
}
