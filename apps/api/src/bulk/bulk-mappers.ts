import type { BulkBatchDetail, BulkBatchSummary, BulkRowResult, ErrorCode } from '@envelope/shared';
import type { BulkBatch, BulkBatchRow } from '../generated/prisma/client';

export function toBatchSummary(row: BulkBatch & { template: { name: string } }): BulkBatchSummary {
  return {
    id: row.id,
    templateId: row.templateId,
    templateName: row.template.name,
    status: row.status,
    send: row.sendOnCreate,
    totalRows: row.totalRows,
    succeededRows: row.succeededRows,
    failedRows: row.failedRows,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

/** A row's outcome. The recipients column is never read here: it holds email addresses. */
export function toRowResult(
  row: Pick<BulkBatchRow, 'rowIndex' | 'status' | 'envelopeId' | 'errorCode'>,
): BulkRowResult {
  return {
    rowIndex: row.rowIndex,
    status: row.status,
    envelopeId: row.envelopeId,
    errorCode: row.errorCode as ErrorCode | null,
  };
}

export function toBatchDetail(
  row: BulkBatch & {
    template: { name: string };
    rows: Pick<BulkBatchRow, 'rowIndex' | 'status' | 'envelopeId' | 'errorCode'>[];
  },
): BulkBatchDetail {
  return { ...toBatchSummary(row), rows: row.rows.map(toRowResult) };
}
