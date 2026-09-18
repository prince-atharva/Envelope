import { describe, expect, it } from 'vitest';
import { nextReminderAt } from './sending.service';

const DAY = 24 * 3600 * 1000;
const at = (iso: string) => new Date(iso);

describe('nextReminderAt', () => {
  it('allows the first reminder at once', () => {
    expect(
      nextReminderAt({ notifiedAt: at('2026-10-01T09:00:00Z'), lastRemindedAt: null }, DAY),
    ).toBe(0);
    expect(nextReminderAt({ notifiedAt: null, lastRemindedAt: null }, DAY)).toBe(0);
  });

  it('waits a day after a reminder', () => {
    expect(
      nextReminderAt(
        { notifiedAt: at('2026-10-01T09:00:00Z'), lastRemindedAt: at('2026-10-02T09:00:00Z') },
        DAY,
      ),
    ).toBe(at('2026-10-03T09:00:00Z').getTime());
  });

  it('lets a reminder that never arrived be retried after ten minutes', () => {
    expect(
      nextReminderAt({ notifiedAt: null, lastRemindedAt: at('2026-10-02T09:00:00Z') }, DAY),
    ).toBe(at('2026-10-02T09:10:00Z').getTime());
  });
});
