import { z } from 'zod';

/** The longest window GET /reports/summary accepts (docs/22 step 9). */
export const MAX_REPORT_DAYS = 366;
/** The window the Reports page opens on. */
export const DEFAULT_REPORT_DAYS = 30;
export const REPORT_PRESET_DAYS = [7, 30, 90] as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` (UTC) that is also a real calendar day. */
const reportDaySchema = z
  .string()
  .regex(DAY, 'Use a date like 2026-10-01')
  .refine((value) => {
    const time = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(time) && new Date(time).toISOString().startsWith(value);
  }, 'Not a real date');

export function reportDayMs(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

/** Days from `from` to `to`, both included. */
export function reportWindowDays(from: string, to: string): number {
  return Math.round((reportDayMs(to) - reportDayMs(from)) / DAY_MS) + 1;
}

/** `YYYY-MM-DD` for a Date, in UTC. */
export function reportDayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The last `days` days up to and including `to`. */
export function lastDays(days: number, to: Date = new Date()): { from: string; to: string } {
  return { from: reportDayOf(new Date(to.getTime() - (days - 1) * DAY_MS)), to: reportDayOf(to) };
}

/**
 * GET /reports/summary?from&to. Both are inclusive UTC days. Either may be left out: `to`
 * defaults to today and `from` to 29 days before it.
 */
export const reportQuerySchema = z
  .strictObject({
    from: reportDaySchema.optional(),
    to: reportDaySchema.optional(),
  })
  .transform((query, ctx) => {
    const to = query.to ?? reportDayOf(new Date());
    const from = query.from ?? lastDays(DEFAULT_REPORT_DAYS, new Date(reportDayMs(to))).from;
    const days = reportWindowDays(from, to);
    if (days < 1) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: 'The start is after the end' });
      return z.NEVER;
    }
    if (days > MAX_REPORT_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['from'],
        message: `Choose a window of at most ${MAX_REPORT_DAYS} days`,
      });
      return z.NEVER;
    }
    return { from, to };
  });
export type ReportQuery = z.output<typeof reportQuerySchema>;

export interface DurationSummary {
  /** Null when no envelope in the window has the event yet. */
  medianSeconds: number | null;
  p90Seconds: number | null;
  /** How many envelopes the figures come from. */
  samples: number;
}

/** Signers and approvers who were invited, and how far they got. Delegated rows are left out. */
export interface DropOff {
  invited: number;
  opened: number;
  consented: number;
  signed: number;
  declined: number;
}

export interface ReportSummary {
  from: string;
  to: string;
  /** Envelopes whose `sentAt` is inside the window. The rest are counted by their status now. */
  sent: number;
  completed: number;
  declined: number;
  cancelled: number;
  expired: number;
  /** Sent and still waiting on someone. */
  open: number;
  /** completed / sent, or null when nothing was sent. */
  completionRate: number | null;
  timeToFirstSignature: DurationSummary;
  timeToComplete: DurationSummary;
  dropOff: DropOff;
  /** One entry per day of the window, including days with nothing sent. */
  daily: { date: string; sent: number }[];
}
