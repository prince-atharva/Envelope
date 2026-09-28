/**
 * 10s, 1m, 5m, 30m, 2h, 12h — 6 retries after the first try, 7 attempts in
 * all, over ~15 hours (docs/08, "Delivery"). Not BullMQ's built-in
 * exponential backoff, which cannot produce this exact, documented shape.
 * Overridable via `WEBHOOK_RETRY_SCHEDULE_MS` (env.schema.ts) so the e2e
 * suite can run the same retry and exhaustion logic in milliseconds instead
 * of hours — the same reason `EMAIL_RETRY_BASE_DELAY_MS` exists.
 */
export const DEFAULT_WEBHOOK_RETRY_SCHEDULE_MS = [
  10_000, 60_000, 300_000, 1_800_000, 7_200_000, 43_200_000,
] as const;

/** The number of retry delays the schedule documents — not the total attempt count. */
export const WEBHOOK_RETRY_DELAY_COUNT = DEFAULT_WEBHOOK_RETRY_SCHEDULE_MS.length;

/**
 * BullMQ's `attempts` counts the first try as one of them (docs/18 workstream
 * 8): setting this to the schedule's length, as before, meant only 5 of the
 * 6 documented delays ever ran and the 12h retry was unreachable. One more
 * than the delay count runs the whole schedule.
 */
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_DELAY_COUNT + 1;

export function parseWebhookRetrySchedule(raw: string): number[] {
  const values = raw.split(',').map((v) => Number.parseInt(v.trim(), 10));
  const valid =
    values.length === WEBHOOK_RETRY_DELAY_COUNT && values.every((v) => Number.isFinite(v));
  return valid ? values : [...DEFAULT_WEBHOOK_RETRY_SCHEDULE_MS];
}
