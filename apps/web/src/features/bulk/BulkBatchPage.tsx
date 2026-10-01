import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { Alert } from '../../components/ui/Alert';
import { api } from '../../lib/api';
import { describeError, messageForRowCode } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { queryKeys } from '../../lib/query-keys';
import { useDocumentTitle } from '../../lib/use-document-title';
import { BULK_REFRESH_MS, batchFraction, batchIsRunning, batchSummaryLine } from './bulk-progress';

/** The result of one bulk send: progress while it runs, then each row's document or what went wrong. */
export function BulkBatchPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { data: batch, error } = useQuery({
    queryKey: queryKeys.bulkBatch(id),
    queryFn: () => api.getBulkBatch(id),
    enabled: id.length > 0,
    refetchInterval: (query) => (batchIsRunning(query.state.data) ? BULK_REFRESH_MS : false),
  });
  useDocumentTitle(batch ? `Bulk send: ${batch.templateName}` : 'Bulk send');

  if (error) {
    return <Alert reference={describeError(error).reference}>{describeError(error).message}</Alert>;
  }
  if (!batch) return <p className="text-sm text-slate-600">Loading the batch…</p>;

  const fraction = batchFraction(batch);
  const failed = batch.rows.filter((row) => row.status === 'FAILED');

  return (
    <div className="page-stack">
      <div className="page-heading block">
        <Link to="/bulk-batches" className="text-sm font-medium text-brand-700 underline">
          All batches
        </Link>
        <h1 className="page-title mt-3">{batch.templateName}</h1>
        <p className="page-description">
          Started {formatDateTime(batch.createdAt)}
          {batch.finishedAt ? `, finished ${formatDateTime(batch.finishedAt)}` : ''}.
        </p>
      </div>

      <section aria-label="Progress" className="space-y-3 surface p-5 sm:p-7">
        <p role="status" className="text-base font-semibold text-slate-900">
          {batchSummaryLine(batch)}
        </p>
        <div
          role="progressbar"
          aria-label="Documents made"
          aria-valuemin={0}
          aria-valuemax={batch.totalRows}
          aria-valuenow={batch.succeededRows + batch.failedRows}
          className="h-2 overflow-hidden rounded-full bg-slate-100"
        >
          <div
            className="h-full rounded-full bg-brand-600 transition-all"
            style={{ width: `${Math.round(fraction * 100)}%` }}
          />
        </div>
        {batchIsRunning(batch) && (
          <p className="text-xs text-slate-500">
            You can leave this page. The documents keep being made.
          </p>
        )}
      </section>

      {failed.length > 0 && !batchIsRunning(batch) && (
        <Alert tone="warning">
          {failed.length} {failed.length === 1 ? 'row' : 'rows'} could not be made. Fix{' '}
          {failed.length === 1 ? 'it' : 'them'} in your spreadsheet and send only those again.
        </Alert>
      )}

      <div className="overflow-x-auto surface">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <caption className="sr-only">Result of each row</caption>
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-5 py-3.5">
                Row
              </th>
              <th scope="col" className="px-5 py-3.5">
                Result
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {batch.rows.map((row) => (
              <tr key={row.rowIndex}>
                <td className="px-5 py-3.5 text-slate-500">{row.rowIndex + 1}</td>
                <td className="px-5 py-3.5">
                  {row.status === 'PENDING' && <span className="text-slate-500">Waiting</span>}
                  {row.status === 'SUCCEEDED' && row.envelopeId && (
                    <Link
                      to={`/dashboard/envelopes/${row.envelopeId}`}
                      className="font-medium text-emerald-700 underline"
                    >
                      {batch.send ? 'Sent: open the document' : 'Draft made: open the document'}
                    </Link>
                  )}
                  {row.status === 'FAILED' && (
                    <span className="text-red-800">{messageForRowCode(row.errorCode)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
