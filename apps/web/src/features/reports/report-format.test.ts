import { describe, expect, it } from 'vitest';
import { formatDuration, formatPercent, funnelRows, shortDay } from './report-format';

describe('formatDuration', () => {
  it.each([
    [null, '—'],
    [20, 'under a minute'],
    [60, '1 min'],
    [2_700, '45 min'],
    [3_600, '1 h'],
    [12_600, '3 h 30 min'],
    [86_400, '1 d'],
    [93_600, '1 d 2 h'],
  ])('%s is %s', (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
  });
});

describe('formatPercent', () => {
  it('rounds to a whole percent and shows a dash for nothing sent', () => {
    expect(formatPercent(2 / 7)).toBe('29%');
    expect(formatPercent(1)).toBe('100%');
    expect(formatPercent(null)).toBe('—');
  });
});

describe('funnelRows', () => {
  it('shares are of everyone invited', () => {
    const rows = funnelRows({ invited: 8, opened: 6, consented: 4, signed: 2, declined: 1 });
    expect(rows.map((r) => r.count)).toEqual([8, 6, 4, 2]);
    expect(rows.map((r) => r.share)).toEqual([1, 0.75, 0.5, 0.25]);
  });

  it('has no divide-by-zero when nobody was invited', () => {
    const rows = funnelRows({ invited: 0, opened: 0, consented: 0, signed: 0, declined: 0 });
    expect(rows.every((r) => r.share === 0)).toBe(true);
  });
});

describe('shortDay', () => {
  it('names the day without a year, in UTC', () => {
    expect(shortDay('2026-10-01')).toBe('1 Oct');
  });
});
