import type { DropOff } from '@envelope/shared';
import { funnelRows } from './report-format';

/**
 * Where invited signers got to, as horizontal bars of one hue (one measure, so one colour).
 * Plain HTML bars rather than a chart library (docs/22 step 10). Each row carries its number
 * and share as text, so nothing depends on colour or on hovering.
 */
export function FunnelBars({ dropOff }: { dropOff: DropOff }) {
  const rows = funnelRows(dropOff);
  return (
    <div>
      <ul className="space-y-3" aria-label="Signer funnel">
        {rows.map((row) => (
          <li key={row.key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-slate-700">{row.label}</span>
              <span className="tabular-nums text-slate-900">
                <span className="font-semibold">{row.count}</span>
                <span className="ml-2 text-xs text-slate-600">{Math.round(row.share * 100)}%</span>
              </span>
            </div>
            <div
              className="mt-1.5 h-3 overflow-hidden rounded-r bg-slate-100"
              role="img"
              aria-label={`${row.label}: ${row.count} of ${dropOff.invited}`}
            >
              <div
                className="h-full rounded-r-[4px] bg-brand-700"
                style={{ width: `${Math.max(row.share * 100, row.count > 0 ? 1.5 : 0)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-slate-700">
        <span className="font-semibold tabular-nums">{dropOff.declined}</span> declined. People who
        passed their part to someone else are counted under the person they passed it to.
      </p>
    </div>
  );
}
