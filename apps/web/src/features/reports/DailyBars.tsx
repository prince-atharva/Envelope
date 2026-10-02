import { useId, useState } from 'react';
import { shortDay } from './report-format';

const WIDTH = 640;
const HEIGHT = 180;
const PAD = { top: 12, right: 8, bottom: 26, left: 32 };

/** A round number at or above `value`, for the top of the scale. */
function niceMax(value: number): number {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (value <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

/**
 * Envelopes sent each day, as thin bars in one colour, drawn in SVG (docs/22 step 10). One
 * series, so no legend: the heading names it. Hovering a bar shows its day and count; the same
 * numbers, for keyboard and screen-reader users, are in the table view below the charts.
 */
export function DailyBars({ daily }: { daily: { date: string; sent: number }[] }) {
  const titleId = useId();
  const [active, setActive] = useState<number | null>(null);
  const total = daily.reduce((sum, day) => sum + day.sent, 0);
  const max = niceMax(Math.max(0, ...daily.map((d) => d.sent)));
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const slot = plotWidth / Math.max(daily.length, 1);
  const barWidth = Math.max(2, Math.min(18, slot - 2));
  const ticks = [0, max / 2, max];
  // About six labels along the axis, whatever the length of the window.
  // Past about four months the same day name repeats, so the axis says which year.
  const longWindow = daily.length > 120;
  const every = Math.max(1, Math.ceil(daily.length / 6));
  const shown = active === null ? null : daily[active];

  return (
    <figure className="relative" aria-labelledby={titleId}>
      <figcaption id={titleId} className="sr-only">
        Envelopes sent each day
      </figcaption>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Envelopes sent each day: ${total} in ${daily.length} days. The same numbers are in the table below the charts.`}
      >
        {ticks.map((tick) => {
          const y = PAD.top + plotHeight - (tick / max) * plotHeight;
          return (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={y}
                y2={y}
                className="stroke-slate-200"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 6}
                y={y + 4}
                textAnchor="end"
                className="fill-slate-600 text-[10px] tabular-nums"
              >
                {Number.isInteger(tick) ? tick : tick.toFixed(1)}
              </text>
            </g>
          );
        })}
        {daily.map((day, index) => {
          const height = (day.sent / max) * plotHeight;
          const x = PAD.left + index * slot + (slot - barWidth) / 2;
          const y = PAD.top + plotHeight - height;
          return (
            <g key={day.date}>
              {/* A wider invisible target than the bar itself, so a thin bar is easy to hit. */}
              {/* biome-ignore lint/a11y/noStaticElementInteractions: a pointer-only hover aid; the table view serves keyboard and screen-reader users. */}
              <rect
                x={PAD.left + index * slot}
                y={PAD.top}
                width={slot}
                height={plotHeight}
                fill="transparent"
                onMouseEnter={() => setActive(index)}
                onMouseLeave={() => setActive(null)}
              />
              {day.sent > 0 && (
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={height}
                  rx={Math.min(4, barWidth / 2)}
                  className={active === index ? 'fill-brand-900' : 'fill-brand-700'}
                  pointerEvents="none"
                />
              )}
              {index % every === 0 && (
                <text
                  x={PAD.left + index * slot + slot / 2}
                  y={HEIGHT - 8}
                  textAnchor="middle"
                  className="fill-slate-600 text-[10px]"
                >
                  {longWindow
                    ? `${shortDay(day.date)} ${day.date.slice(2, 4)}`
                    : shortDay(day.date)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {shown && (
        <div
          role="status"
          className="pointer-events-none absolute right-2 top-0 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 shadow-sm"
        >
          <span className="font-medium">{shortDay(shown.date)}</span>
          <span className="ml-2 tabular-nums">{shown.sent} sent</span>
        </div>
      )}
    </figure>
  );
}
