import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEBHOOK_RETRY_SCHEDULE_MS,
  parseWebhookRetrySchedule,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_DELAY_COUNT,
} from './webhook-retry-schedule';

/**
 * BullMQ's `attempts` counts the first try as one of them (docs/18 workstream
 * 8): the schedule has 6 delays, so the queue must allow 7 attempts for all
 * 6 — including the 12h one — to ever run.
 */
describe('webhook retry schedule', () => {
  it('allows one more attempt than the schedule has delays', () => {
    expect(WEBHOOK_RETRY_DELAY_COUNT).toBe(6);
    expect(WEBHOOK_MAX_ATTEMPTS).toBe(7);
  });

  it('the last documented delay is the 12-hour retry', () => {
    expect(DEFAULT_WEBHOOK_RETRY_SCHEDULE_MS.at(-1)).toBe(43_200_000);
  });

  it('parses a valid override matching the delay count', () => {
    expect(parseWebhookRetrySchedule('1,2,3,4,5,6')).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('falls back to the default when the override has the wrong number of entries', () => {
    expect(parseWebhookRetrySchedule('1,2,3')).toEqual([...DEFAULT_WEBHOOK_RETRY_SCHEDULE_MS]);
  });

  it('falls back to the default when the override is not numeric', () => {
    expect(parseWebhookRetrySchedule('a,b,c,d,e,f')).toEqual([
      ...DEFAULT_WEBHOOK_RETRY_SCHEDULE_MS,
    ]);
  });
});
