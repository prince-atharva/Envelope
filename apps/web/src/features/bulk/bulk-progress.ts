import type { BulkBatchSummary } from '@envelope/shared';

/** How often the results page asks again while a batch is still being made. */
export const BULK_REFRESH_MS = 1_500;

export function batchIsRunning(batch: Pick<BulkBatchSummary, 'status'> | undefined): boolean {
  return batch?.status === 'PROCESSING';
}

/** The fraction of rows that have a result, 0 to 1. */
export function batchFraction(
  batch: Pick<BulkBatchSummary, 'totalRows' | 'succeededRows' | 'failedRows'>,
): number {
  if (batch.totalRows === 0) return 1;
  return Math.min(1, (batch.succeededRows + batch.failedRows) / batch.totalRows);
}

/** "12 of 40 done", "All 40 sent", "38 of 40 made, 2 failed", for the heading of a batch. */
export function batchSummaryLine(
  batch: Pick<BulkBatchSummary, 'status' | 'send' | 'totalRows' | 'succeededRows' | 'failedRows'>,
): string {
  const done = batch.succeededRows + batch.failedRows;
  if (batch.status === 'PROCESSING') return `${done} of ${batch.totalRows} done`;
  const verb = batch.send ? 'sent' : 'made as drafts';
  if (batch.failedRows === 0) return `All ${batch.totalRows} ${verb}`;
  if (batch.succeededRows === 0) return `None of the ${batch.totalRows} could be made`;
  return `${batch.succeededRows} of ${batch.totalRows} ${verb}, ${batch.failedRows} failed`;
}
