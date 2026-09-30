import { describe, expect, it } from 'vitest';
import { batchFraction, batchIsRunning, batchSummaryLine } from './bulk-progress';

const base = { send: true, totalRows: 40, succeededRows: 0, failedRows: 0 };

describe('batchSummaryLine', () => {
  it('counts what is done while running', () => {
    expect(
      batchSummaryLine({ ...base, status: 'PROCESSING', succeededRows: 10, failedRows: 2 }),
    ).toBe('12 of 40 done');
  });

  it('says how it ended', () => {
    expect(batchSummaryLine({ ...base, status: 'COMPLETED', succeededRows: 40 })).toBe(
      'All 40 sent',
    );
    expect(batchSummaryLine({ ...base, send: false, status: 'COMPLETED', succeededRows: 40 })).toBe(
      'All 40 made as drafts',
    );
    expect(
      batchSummaryLine({ ...base, status: 'COMPLETED', succeededRows: 38, failedRows: 2 }),
    ).toBe('38 of 40 sent, 2 failed');
    expect(batchSummaryLine({ ...base, status: 'COMPLETED', failedRows: 40 })).toBe(
      'None of the 40 could be made',
    );
  });
});

describe('batchFraction and batchIsRunning', () => {
  it('is the share of rows with a result, never above one', () => {
    expect(batchFraction({ ...base, succeededRows: 10, failedRows: 10 })).toBe(0.5);
    expect(batchFraction({ ...base, succeededRows: 50 })).toBe(1);
    expect(batchFraction({ totalRows: 0, succeededRows: 0, failedRows: 0 })).toBe(1);
  });

  it('keeps refreshing only while processing', () => {
    expect(batchIsRunning({ status: 'PROCESSING' })).toBe(true);
    expect(batchIsRunning({ status: 'COMPLETED' })).toBe(false);
    expect(batchIsRunning(undefined)).toBe(false);
  });
});
