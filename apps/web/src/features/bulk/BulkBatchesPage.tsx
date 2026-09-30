import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Alert } from '../../components/ui/Alert';
import { api } from '../../lib/api';
import { describeError } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { queryKeys } from '../../lib/query-keys';
import { useDocumentTitle } from '../../lib/use-document-title';
import { batchSummaryLine } from './bulk-progress';

/** Recent bulk sends: yours, or everyone's if you are an admin. */
export function BulkBatchesPage() {
  useDocumentTitle('Bulk sends');
  const { data, error, isLoading } = useQuery({
    queryKey: queryKeys.bulkBatches,
    queryFn: api.listBulkBatches,
  });
  const batches = data?.batches ?? [];

  return (
    <div className="space-y-6 pb-8">
      <div>
        <Link to="/templates" className="text-sm font-medium text-brand-700 underline">
          Templates
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Bulk sends
        </h1>
        <p className="mt-1 text-sm text-slate-500">Documents sent to many people at once.</p>
      </div>
      {error && (
        <Alert reference={describeError(error).reference}>{describeError(error).message}</Alert>
      )}
      {isLoading ? (
        <p className="text-sm text-slate-600">Loading…</p>
      ) : batches.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
          <h2 className="text-base font-semibold text-slate-900">No bulk sends yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
            Choose “Send to many” on a template to send it to a whole spreadsheet of people.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
          {batches.map((batch) => (
            <li key={batch.id}>
              <Link
                to={`/bulk-batches/${batch.id}`}
                className="flex flex-col gap-1 px-4 py-4 hover:bg-slate-50/80 sm:flex-row sm:items-center sm:justify-between sm:px-6"
              >
                <span className="font-semibold text-slate-900">{batch.templateName}</span>
                <span className="text-sm text-slate-600">{batchSummaryLine(batch)}</span>
                <span className="text-xs text-slate-500">{formatDateTime(batch.createdAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
