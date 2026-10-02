import {
  type DropOff,
  type DurationSummary,
  type ReportQuery,
  type ReportSummary,
  reportDayMs,
  reportWindowDays,
} from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 86_400_000;

/** `timestamp` columns hold UTC; same cast as envelope-views.ts. */
const utc = (date: Date) => Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

interface CountsRow {
  sent: number;
  completed: number;
  declined: number;
  cancelled: number;
  expired: number;
  open: number;
}

interface DurationRow {
  median: number | null;
  p90: number | null;
  samples: number;
}

interface DailyRow {
  day: string;
  sent: number;
}

function duration(row: DurationRow | undefined): DurationSummary {
  return {
    medianSeconds: row?.median == null ? null : Math.round(row.median),
    p90Seconds: row?.p90 == null ? null : Math.round(row.p90),
    samples: row?.samples ?? 0,
  };
}

/**
 * Workspace signing numbers (docs/22 step 9): live queries over columns that already exist,
 * scoped to one tenant with an explicit `tenantId` filter like every tenant-level query.
 *
 * The window is on `sentAt`, in UTC days. Envelopes are counted by the status they have now.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(ReportsService.name) private readonly logger: PinoLogger,
  ) {}

  async summary(tenantId: string, query: ReportQuery): Promise<ReportSummary> {
    const started = performance.now();
    const start = new Date(reportDayMs(query.from));
    // Exclusive: midnight after the last day.
    const end = new Date(reportDayMs(query.to) + DAY_MS);
    const inWindow = Prisma.sql`e."tenantId" = ${tenantId}::uuid
      AND e."sentAt" >= ${utc(start)} AND e."sentAt" < ${utc(end)}`;

    const [counts, firstSignature, completion, dropOff, daily] = await Promise.all([
      this.prisma.$queryRaw<CountsRow[]>`
        SELECT
          count(*)::int AS sent,
          (count(*) FILTER (WHERE e.status = 'COMPLETED'))::int AS completed,
          (count(*) FILTER (WHERE e.status = 'DECLINED'))::int AS declined,
          (count(*) FILTER (WHERE e.status = 'VOIDED'))::int AS cancelled,
          (count(*) FILTER (WHERE e.status = 'EXPIRED'))::int AS expired,
          (count(*) FILTER (WHERE e.status IN ('SENT', 'DELIVERED', 'PARTIALLY_SIGNED')))::int AS open
        FROM "Envelope" e
        WHERE ${inWindow}`,
      this.prisma.$queryRaw<DurationRow[]>`
        WITH first_signature AS (
          SELECT e.id, e."sentAt", min(r."signedAt") AS "firstSignedAt"
          FROM "Envelope" e
          JOIN "Recipient" r ON r."envelopeId" = e.id
          WHERE ${inWindow}
            AND r.role IN ('SIGNER', 'APPROVER')
            AND r.status = 'SIGNED'
            AND r."signedAt" IS NOT NULL
          GROUP BY e.id, e."sentAt"
        )
        SELECT
          percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM "firstSignedAt" - "sentAt")::float8) AS median,
          percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM "firstSignedAt" - "sentAt")::float8) AS p90,
          count(*)::int AS samples
        FROM first_signature`,
      this.prisma.$queryRaw<DurationRow[]>`
        SELECT
          percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM e."completedAt" - e."sentAt")::float8) AS median,
          NULL::float8 AS p90,
          count(*)::int AS samples
        FROM "Envelope" e
        WHERE ${inWindow} AND e.status = 'COMPLETED' AND e."completedAt" IS NOT NULL`,
      // A delegator's row is history and a PENDING one was never invited, so neither is a person who dropped off.
      this.prisma.$queryRaw<DropOff[]>`
        SELECT
          count(*)::int AS invited,
          count(r."viewedAt")::int AS opened,
          count(r."consentGivenAt")::int AS consented,
          (count(*) FILTER (WHERE r.status = 'SIGNED'))::int AS signed,
          (count(*) FILTER (WHERE r.status = 'DECLINED'))::int AS declined
        FROM "Recipient" r
        JOIN "Envelope" e ON e.id = r."envelopeId"
        WHERE ${inWindow}
          AND r.role IN ('SIGNER', 'APPROVER')
          AND r.status NOT IN ('PENDING', 'DELEGATED')`,
      this.prisma.$queryRaw<DailyRow[]>`
        SELECT to_char(date_trunc('day', e."sentAt"), 'YYYY-MM-DD') AS day, count(*)::int AS sent
        FROM "Envelope" e
        WHERE ${inWindow}
        GROUP BY 1
        ORDER BY 1`,
    ]);

    const totals = counts[0] ?? {
      sent: 0,
      completed: 0,
      declined: 0,
      cancelled: 0,
      expired: 0,
      open: 0,
    };
    const sentByDay = new Map(daily.map((row) => [row.day, row.sent]));
    const days = reportWindowDays(query.from, query.to);
    const series = Array.from({ length: days }, (_, index) => {
      const date = new Date(reportDayMs(query.from) + index * DAY_MS).toISOString().slice(0, 10);
      return { date, sent: sentByDay.get(date) ?? 0 };
    });

    const summary: ReportSummary = {
      from: query.from,
      to: query.to,
      sent: totals.sent,
      completed: totals.completed,
      declined: totals.declined,
      cancelled: totals.cancelled,
      expired: totals.expired,
      open: totals.open,
      completionRate: totals.sent === 0 ? null : totals.completed / totals.sent,
      timeToFirstSignature: duration(firstSignature[0]),
      timeToComplete: { ...duration(completion[0]), p90Seconds: null },
      dropOff: dropOff[0] ?? { invited: 0, opened: 0, consented: 0, signed: 0, declined: 0 },
      daily: series,
    };

    this.logger.info(
      {
        tenantId,
        from: query.from,
        to: query.to,
        sent: summary.sent,
        durationMs: Math.round(performance.now() - started),
      },
      'Workspace report computed',
    );
    return summary;
  }
}
