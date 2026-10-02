import {
  lastDays,
  MAX_REPORT_DAYS,
  REPORT_PRESET_DAYS,
  type ReportSummary,
  reportWindowDays,
} from '@envelope/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '../components/ui/Alert';
import { Card } from '../components/ui/Card';
import { PageHeader } from '../components/ui/PageHeader';
import { ReportsPageSkeleton } from '../components/ui/Skeletons';
import { DailyBars } from '../features/reports/DailyBars';
import { FunnelBars } from '../features/reports/FunnelBars';
import {
  formatDuration,
  formatPercent,
  funnelRows,
  shortDay,
} from '../features/reports/report-format';
import { api } from '../lib/api';
import { describeError } from '../lib/errors';
import { queryKeys } from '../lib/query-keys';
import { useDocumentTitle } from '../lib/use-document-title';

type Period = (typeof REPORT_PRESET_DAYS)[number] | 'custom';

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card as="div" padding="sm">
      <p className="text-sm font-medium text-slate-700">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {note && <p className="mt-1 text-xs text-slate-600">{note}</p>}
    </Card>
  );
}

function ReportTables({ report }: { report: ReportSummary }) {
  return (
    <details className="surface p-5">
      <summary className="min-h-11 cursor-pointer text-sm font-semibold text-slate-800">
        View the numbers as tables
      </summary>
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <table className="w-full text-left text-sm">
          <caption className="mb-2 text-left font-medium text-slate-800">Signer funnel</caption>
          <thead>
            <tr className="border-b border-slate-200 text-slate-600">
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Step
              </th>
              <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                People
              </th>
              <th scope="col" className="py-1.5 text-right font-medium">
                Share
              </th>
            </tr>
          </thead>
          <tbody>
            {funnelRows(report.dropOff).map((row) => (
              <tr key={row.key} className="border-b border-slate-100">
                <th scope="row" className="py-1.5 pr-3 font-normal">
                  {row.label}
                </th>
                <td className="py-1.5 pr-3 text-right tabular-nums">{row.count}</td>
                <td className="py-1.5 text-right tabular-nums">{Math.round(row.share * 100)}%</td>
              </tr>
            ))}
            <tr>
              <th scope="row" className="py-1.5 pr-3 font-normal">
                Declined
              </th>
              <td className="py-1.5 pr-3 text-right tabular-nums">{report.dropOff.declined}</td>
              <td />
            </tr>
          </tbody>
        </table>
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-left text-sm">
            <caption className="mb-2 text-left font-medium text-slate-800">Sent each day</caption>
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  Day
                </th>
                <th scope="col" className="py-1.5 text-right font-medium">
                  Sent
                </th>
              </tr>
            </thead>
            <tbody>
              {report.daily.map((day) => (
                <tr key={day.date} className="border-b border-slate-100">
                  <th scope="row" className="py-1.5 pr-3 font-normal">
                    {shortDay(day.date)}
                  </th>
                  <td className="py-1.5 text-right tabular-nums">{day.sent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}

/** Reports (docs/22 step 10). Owners and Admins; live numbers over the last 7, 30 or 90 days or a range. */
export function ReportsPage() {
  useDocumentTitle('Reports');
  const [period, setPeriod] = useState<Period>(30);
  const [custom, setCustom] = useState(() => lastDays(30));

  const range = period === 'custom' ? custom : lastDays(period);
  const days = reportWindowDays(range.from, range.to);
  const rangeProblem =
    days < 1
      ? 'The start date is after the end date.'
      : days > MAX_REPORT_DAYS
        ? `Choose a range of at most ${MAX_REPORT_DAYS} days.`
        : null;

  const { data, error, isLoading, isFetching } = useQuery({
    queryKey: queryKeys.reports(range.from, range.to),
    queryFn: () => api.getReportSummary(range.from, range.to),
    enabled: rangeProblem === null,
    staleTime: 30_000,
  });

  const choices: Period[] = [...REPORT_PRESET_DAYS, 'custom'];

  return (
    <div className="page-stack">
      <PageHeader
        title="Reports"
        description="How many documents were sent, how many were finished, and where people stopped."
      />

      <fieldset className="flex flex-wrap items-end gap-3">
        <legend className="mb-2 text-sm font-medium text-slate-800">Period</legend>
        <div className="flex flex-wrap gap-2">
          {choices.map((choice) => (
            <button
              key={choice}
              type="button"
              aria-pressed={period === choice}
              onClick={() => setPeriod(choice)}
              className={`min-h-11 rounded-lg px-4 py-2 text-sm font-semibold ring-1 ring-inset transition-colors ${
                period === choice
                  ? 'bg-brand-700 text-white ring-brand-700'
                  : 'bg-white text-slate-800 ring-slate-300 hover:bg-slate-50'
              }`}
            >
              {choice === 'custom' ? 'Custom range' : `Last ${choice} days`}
            </button>
          ))}
        </div>
        {period === 'custom' && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm font-medium text-slate-800">
              From
              <input
                type="date"
                className="form-control mt-1 block border border-slate-300 px-3 py-2.5 text-slate-900"
                value={custom.from}
                max={custom.to}
                onChange={(event) =>
                  event.target.value && setCustom({ ...custom, from: event.target.value })
                }
              />
            </label>
            <label className="text-sm font-medium text-slate-800">
              To
              <input
                type="date"
                className="form-control mt-1 block border border-slate-300 px-3 py-2.5 text-slate-900"
                value={custom.to}
                min={custom.from}
                onChange={(event) =>
                  event.target.value && setCustom({ ...custom, to: event.target.value })
                }
              />
            </label>
          </div>
        )}
      </fieldset>

      {rangeProblem && <Alert>{rangeProblem}</Alert>}
      {error && (
        <Alert reference={describeError(error).reference}>{describeError(error).message}</Alert>
      )}

      {isLoading && !rangeProblem ? (
        <ReportsPageSkeleton />
      ) : (
        data && (
          <div className={`space-y-6 ${isFetching ? 'opacity-70' : ''}`} aria-busy={isFetching}>
            <p className="text-sm text-slate-600">
              Documents sent from {shortDay(data.from)} to {shortDay(data.to)} (UTC days), counted
              by where they stand now.
            </p>

            <section aria-label="Totals" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Tile label="Sent" value={String(data.sent)} />
              <Tile
                label="Completed"
                value={String(data.completed)}
                note={`${data.declined} declined · ${data.cancelled} cancelled · ${data.expired} expired`}
              />
              <Tile
                label="Completion rate"
                value={formatPercent(data.completionRate)}
                note={`${data.open} still open`}
              />
              <Tile
                label="Time to first signature"
                value={formatDuration(data.timeToFirstSignature.medianSeconds)}
                note={
                  data.timeToFirstSignature.samples === 0
                    ? 'Nobody has signed yet'
                    : `Typical (median) · 9 in 10 within ${formatDuration(data.timeToFirstSignature.p90Seconds)}`
                }
              />
            </section>

            <Tile
              label="Time to complete"
              value={formatDuration(data.timeToComplete.medianSeconds)}
              note={
                data.timeToComplete.samples === 0
                  ? 'Nothing has been completed yet'
                  : `Typical (median) across ${data.timeToComplete.samples} completed`
              }
            />

            <div className="grid gap-6 lg:grid-cols-2">
              <Card as="section" aria-label="Where signers drop off">
                <h2 className="section-title">Where signers drop off</h2>
                <p className="mb-4 mt-1 text-sm text-slate-600">
                  Everyone invited to sign or approve, and how far they got.
                </p>
                <FunnelBars dropOff={data.dropOff} />
              </Card>
              <Card as="section" aria-label="Sent each day">
                <h2 className="section-title">Sent each day</h2>
                <p className="mb-4 mt-1 text-sm text-slate-600">
                  Documents sent on each day of the period.
                </p>
                <DailyBars daily={data.daily} />
              </Card>
            </div>

            <ReportTables report={data} />
          </div>
        )
      )}
    </div>
  );
}
