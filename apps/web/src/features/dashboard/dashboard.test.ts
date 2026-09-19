import { describe, expect, it } from 'vitest';
import { defaultView, describeAttention, describeProgress, isView } from './dashboard';

const NOW = new Date('2026-10-10T12:00:00Z').getTime();
const counts = { attention: 0, waiting: 2, completed: 1, cancelled: 0, drafts: 1, all: 4 };

describe('dashboard', () => {
  it('opens on Needs attention only when something needs it', () => {
    expect(defaultView(counts)).toBe('all');
    expect(defaultView({ ...counts, attention: 2 })).toBe('attention');
    expect(defaultView(undefined)).toBe('all');
  });

  it('accepts only real views from the address bar', () => {
    expect(isView('waiting')).toBe(true);
    expect(isView('everything')).toBe(false);
    expect(isView(null)).toBe(false);
  });

  it('says why a document needs attention, and since when', () => {
    expect(describeAttention({ reason: 'EXPIRED', since: '2026-10-07T12:00:00Z' }, NOW)).toBe(
      'Expired 3 days ago: give more time or cancel',
    );
    expect(describeAttention({ reason: 'EXPIRING_SOON', since: '2026-10-11T12:00:00Z' }, NOW)).toBe(
      'Expires tomorrow',
    );
    expect(describeAttention({ reason: 'NOT_OPENED', since: '2026-10-08T12:00:00Z' }, NOW)).toBe(
      'Not opened since it was sent 2 days ago',
    );
  });

  it('sums up progress and who it waits on', () => {
    const base = { oldestUnviewedSince: null, lastActivityAt: null };
    expect(describeProgress({ ...base, signed: 1, total: 3, waitingOn: ['Priya'] })).toBe(
      '1 of 3 signed · Waiting on Priya',
    );
    expect(
      describeProgress({ ...base, signed: 0, total: 3, waitingOn: ['Priya', 'Raj', 'Dev'] }),
    ).toBe('0 of 3 signed · Waiting on Priya and 2 more');
    expect(describeProgress({ ...base, signed: 2, total: 2, waitingOn: [] })).toBe('2 of 2 signed');
  });
});
