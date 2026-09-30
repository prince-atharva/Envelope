import { type BulkCsvRow, bulkCsvBlank, MAX_BULK_ROWS, parseBulkCsv } from '@envelope/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { api } from '../../lib/api';
import { describeError } from '../../lib/errors';
import { queryKeys } from '../../lib/query-keys';
import { useDocumentTitle } from '../../lib/use-document-title';

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * "Send to many" (docs/20 step 6, ADR 0028): a spreadsheet with one row per
 * person, checked here before anything is sent. The same rules the server uses
 * decide which rows are fine, so what the preview promises is what happens.
 */
export function BulkSendPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileId = useId();
  const messageId = useId();
  const keyRef = useRef<string>(crypto.randomUUID());
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ReturnType<typeof parseBulkCsv> | null>(null);
  const [skipped, setSkipped] = useState(false);
  const [sendNow, setSendNow] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const template = useQuery({
    queryKey: queryKeys.template(id),
    queryFn: () => api.getTemplate(id),
    enabled: id.length > 0,
  });
  useDocumentTitle(template.data ? `Send “${template.data.name}” to many` : 'Send to many');
  const roleNames = template.data?.roles.map((role) => role.name) ?? [];
  const messageValue = message ?? template.data?.defaultMessage ?? '';

  const rows: BulkCsvRow[] = parsed?.rows ?? [];
  const bad = rows.filter((row) => !row.row);
  const ready = skipped ? rows.filter((row) => row.row) : rows;
  const canStart = ready.length > 0 && (skipped || bad.length === 0);

  const mutation = useMutation({
    mutationFn: () =>
      api.startBulkBatch(
        id,
        {
          rows: ready.flatMap((row) => (row.row ? [row.row] : [])),
          message: messageValue.trim() === '' ? undefined : messageValue.trim(),
          send: sendNow,
        },
        keyRef.current,
      ),
    onSuccess: async (accepted) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.bulkBatches });
      await navigate(`/bulk-batches/${accepted.batchId}`);
    },
  });

  async function read(file: File | undefined) {
    mutation.reset();
    keyRef.current = crypto.randomUUID();
    setSkipped(false);
    if (!file) {
      setFileName(null);
      setParsed(null);
      return;
    }
    setFileName(file.name);
    setParsed(parseBulkCsv(await file.text(), roleNames));
  }

  if (template.isLoading) return <p className="text-sm text-slate-600">Loading the template…</p>;
  if (template.error || !template.data) {
    return <Alert>{describeError(template.error).message}</Alert>;
  }
  if (template.data.archivedAt) {
    return (
      <div className="space-y-4">
        <Alert tone="warning">This template is archived, so it cannot start new batches.</Alert>
        <Link to="/templates" className="text-sm font-medium text-brand-700 underline">
          Back to templates
        </Link>
      </div>
    );
  }

  const failure = mutation.error ? describeError(mutation.error) : null;

  return (
    <div className="space-y-6 pb-8">
      <div>
        <Link to="/templates" className="text-sm font-medium text-brand-700 underline">
          Templates
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Send “{template.data.name}” to many people
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          One document is made for every row of your spreadsheet, up to {MAX_BULK_ROWS} at a time.
        </p>
      </div>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-6">
        <h2 className="text-sm font-semibold text-slate-900">1. Get the spreadsheet ready</h2>
        <p className="text-sm text-slate-600">
          It needs a name column and an email column for each role:{' '}
          <strong>{roleNames.join(', ')}</strong>. An optional <code>externalId</code> column keeps
          your own reference on each document.
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => downloadText(`${template.data.name}.csv`, bulkCsvBlank(roleNames))}
        >
          Download a blank spreadsheet
        </Button>
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-6">
        <h2 className="text-sm font-semibold text-slate-900">2. Choose your file</h2>
        <label htmlFor={fileId} className="block text-sm font-medium text-slate-800">
          Spreadsheet (CSV)
        </label>
        <input
          id={fileId}
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => void read(event.target.files?.[0])}
          className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium"
        />
        {fileName && <p className="text-xs text-slate-500">Read {fileName}.</p>}
        {parsed?.fileProblems.map((problem) => (
          <Alert key={problem}>{problem}</Alert>
        ))}
        {parsed && parsed.ignoredColumns.length > 0 && parsed.fileProblems.length === 0 && (
          <Alert tone="info">
            Ignored the columns {parsed.ignoredColumns.map((name) => `“${name}”`).join(', ')}.
          </Alert>
        )}
      </section>

      {parsed && parsed.fileProblems.length === 0 && (
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-6">
          <h2 className="text-sm font-semibold text-slate-900">3. Check, then send</h2>
          <p role="status" className="text-sm text-slate-700">
            {rows.length - bad.length} of {rows.length} rows are ready
            {bad.length > 0 ? `; ${bad.length} need fixing` : ''}.
          </p>

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <caption className="sr-only">Rows in the spreadsheet</caption>
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-3 py-2">
                    Line
                  </th>
                  {roleNames.map((role) => (
                    <th key={role} scope="col" className="px-3 py-2">
                      {role}
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2">
                    Check
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.slice(0, 200).map((row) => (
                  <tr key={row.line} className={row.row ? '' : 'bg-red-50/60'}>
                    <td className="px-3 py-2 text-slate-500">{row.line}</td>
                    {roleNames.map((role) => {
                      const person = row.row?.recipients.find((p) => p.role === role);
                      return (
                        <td key={role} className="px-3 py-2 text-slate-800">
                          {person ? `${person.name} (${person.email})` : '—'}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2">
                      {row.row ? (
                        <span className="font-medium text-emerald-700">Ready</span>
                      ) : (
                        <ul className="list-disc space-y-0.5 pl-4 text-red-800">
                          {row.problems.map((problem) => (
                            <li key={problem}>{problem}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 200 && (
            <p className="text-xs text-slate-500">
              Showing the first 200 of {rows.length} rows. All of them are checked.
            </p>
          )}

          {bad.length > 0 && (
            <div className="space-y-2">
              <Alert tone="warning">
                Fix the rows marked above and choose the file again, or leave them out and send the
                rest.
              </Alert>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={skipped}
                  onChange={(event) => setSkipped(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Leave out the {bad.length} {bad.length === 1 ? 'row' : 'rows'} with problems
              </label>
            </div>
          )}

          <div className="space-y-1">
            <label htmlFor={messageId} className="block text-sm font-medium text-slate-800">
              Message included with every document (optional)
            </label>
            <textarea
              id={messageId}
              rows={3}
              value={messageValue}
              onChange={(event) => setMessage(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-800">What next</legend>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="bulk-next"
                checked={!sendNow}
                onChange={() => setSendNow(false)}
                className="mt-0.5"
              />
              <span>Make them as drafts, so I can check them before they go out</span>
            </label>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="bulk-next"
                checked={sendNow}
                onChange={() => setSendNow(true)}
                className="mt-0.5"
              />
              <span>Send each document for signing as soon as it is made</span>
            </label>
          </fieldset>

          {failure && <Alert reference={failure.reference}>{failure.message}</Alert>}
          <Button
            onClick={() => mutation.mutate()}
            disabled={!canStart}
            loading={mutation.isPending}
          >
            {sendNow ? `Send ${ready.length} documents` : `Make ${ready.length} drafts`}
          </Button>
        </section>
      )}
    </div>
  );
}
