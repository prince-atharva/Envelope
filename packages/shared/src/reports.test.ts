import { describe, expect, it } from 'vitest';
import {
  lastDays,
  MAX_REPORT_DAYS,
  reportDayOf,
  reportQuerySchema,
  reportWindowDays,
} from './reports';

describe('reportWindowDays', () => {
  it('counts both ends', () => {
    expect(reportWindowDays('2026-10-01', '2026-10-01')).toBe(1);
    expect(reportWindowDays('2026-09-25', '2026-10-01')).toBe(7);
  });
});

describe('lastDays', () => {
  it('is inclusive of today', () => {
    const range = lastDays(7, new Date('2026-10-01T15:00:00Z'));
    expect(range).toEqual({ from: '2026-09-25', to: '2026-10-01' });
    expect(reportWindowDays(range.from, range.to)).toBe(7);
  });
});

describe('reportQuerySchema', () => {
  it('defaults to the last 30 days', () => {
    const query = reportQuerySchema.parse({});
    expect(reportWindowDays(query.from, query.to)).toBe(30);
    expect(query.to).toBe(reportDayOf(new Date()));
  });

  it('accepts a window of exactly 366 days and refuses 367', () => {
    expect(reportQuerySchema.safeParse({ from: '2025-10-01', to: '2026-10-01' }).success).toBe(
      true,
    );
    expect(reportWindowDays('2025-10-01', '2026-10-01')).toBe(MAX_REPORT_DAYS);
    expect(reportQuerySchema.safeParse({ from: '2025-09-30', to: '2026-10-01' }).success).toBe(
      false,
    );
  });

  it('refuses a start after the end, a malformed day and an impossible one', () => {
    expect(reportQuerySchema.safeParse({ from: '2026-10-02', to: '2026-10-01' }).success).toBe(
      false,
    );
    expect(reportQuerySchema.safeParse({ from: '1 Oct', to: '2026-10-01' }).success).toBe(false);
    expect(reportQuerySchema.safeParse({ from: '2026-02-30', to: '2026-10-01' }).success).toBe(
      false,
    );
  });

  it('refuses unknown keys', () => {
    expect(reportQuerySchema.safeParse({ tenantId: 'x' }).success).toBe(false);
  });
});
