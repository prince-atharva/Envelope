import {
  ATTENTION_REASONS,
  type AttentionReason,
  type EnvelopeProgress,
  type EnvelopeStatus,
  type EnvelopeView,
  isOpenEnvelope,
  OPEN_ENVELOPE_STATUSES,
  receivesSigningLink,
} from '@envelope/shared';
import { AppException } from '../common/errors/app-exception';
import { Prisma, type Recipient } from '../generated/prisma/client';

const HOUR_MS = 3600 * 1000;
/** Invited, emailed and not opened for this long: worth a nudge. */
export const NOT_OPENED_AFTER_MS = 48 * HOUR_MS;
/** Invited, and no mail server has accepted the email after this long. */
export const NOT_DELIVERED_AFTER_MS = HOUR_MS;
/** The deadline is this close. */
export const EXPIRING_WITHIN_MS = 48 * HOUR_MS;
/** A decline stays in Needs attention this long. */
export const DECLINED_WITHIN_MS = 7 * 24 * HOUR_MS;

/** Every view but Needs attention is a plain filter, newest first. */
export function viewWhere(
  view: Exclude<EnvelopeView, 'attention'>,
  status: EnvelopeStatus | undefined,
): Prisma.EnvelopeWhereInput {
  const byView: Record<typeof view, Prisma.EnvelopeWhereInput> = {
    all: {},
    drafts: { status: 'DRAFT' },
    completed: { status: 'COMPLETED' },
    // Sent and not finished, including paused: each still waits on someone.
    waiting: { status: { in: [...OPEN_ENVELOPE_STATUSES, 'EXPIRED'] } },
    // Cancelled, declined, and discarded drafts (VOIDED without sentAt) alike.
    cancelled: {
      status: { in: ['VOIDED', 'DECLINED'] },
    },
  };
  return status ? { AND: [byView[view], { status }] } : byView[view];
}

type ProgressRecipient = Pick<
  Recipient,
  'name' | 'role' | 'status' | 'invitedAt' | 'notifiedAt' | 'viewedAt' | 'signedAt' | 'declinedAt'
>;

const AWAITING = new Set(['SENT', 'DELIVERED', 'VIEWED']);

function latest(dates: (Date | null | undefined)[]): Date | null {
  const times = dates.filter((d): d is Date => d instanceof Date).map((d) => d.getTime());
  return times.length === 0 ? null : new Date(Math.max(...times));
}

/** How far a sent envelope has got, from its signers and approvers. Null for a draft. */
export function progressOf(
  envelope: { status: EnvelopeStatus; sentAt: Date | null; completedAt: Date | null },
  recipients: ProgressRecipient[],
): EnvelopeProgress | null {
  if (envelope.status === 'DRAFT' || !envelope.sentAt) return null;
  const signers = recipients.filter((r) => receivesSigningLink(r.role));
  const stillOpen = envelope.status === 'EXPIRED' || isOpenEnvelope(envelope.status);
  const unopened = signers
    .filter((r) => (r.status === 'SENT' || r.status === 'DELIVERED') && r.invitedAt)
    .map((r) => r.invitedAt?.getTime() ?? 0);
  const lastActivity = latest([
    envelope.sentAt,
    envelope.completedAt,
    ...recipients.flatMap((r) => [r.notifiedAt, r.viewedAt, r.signedAt, r.declinedAt]),
  ]);
  return {
    signed: signers.filter((r) => r.status === 'SIGNED').length,
    total: signers.length,
    waitingOn: stillOpen ? signers.filter((r) => AWAITING.has(r.status)).map((r) => r.name) : [],
    oldestUnviewedSince:
      stillOpen && unopened.length > 0 ? new Date(Math.min(...unopened)).toISOString() : null,
    lastActivityAt: lastActivity?.toISOString() ?? null,
  };
}

// ─── Needs attention ───

export interface AttentionCursor {
  /** When the first page was evaluated: later pages use the same moment. */
  at: Date;
  rank: number;
  since: Date;
  id: string;
}

export function encodeAttentionCursor(cursor: AttentionCursor): string {
  return Buffer.from(
    JSON.stringify({
      v: 'attention',
      at: cursor.at.toISOString(),
      rank: cursor.rank,
      since: cursor.since.toISOString(),
      id: cursor.id,
    }),
  ).toString('base64url');
}

export function decodeAttentionCursor(raw: string): AttentionCursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    const at = new Date(String(parsed.at));
    const since = new Date(String(parsed.since));
    const rank = Number(parsed.rank);
    const id = String(parsed.id);
    if (
      parsed.v !== 'attention' ||
      Number.isNaN(at.getTime()) ||
      Number.isNaN(since.getTime()) ||
      !Number.isInteger(rank) ||
      !/^[0-9a-f-]{36}$/.test(id)
    ) {
      throw new Error('bad cursor');
    }
    return { at, rank, since, id };
  } catch {
    throw new AppException('BAD_REQUEST', 'The page cursor is invalid.');
  }
}

export function attentionReason(rank: number): AttentionReason {
  const reason = ATTENTION_REASONS[rank - 1];
  if (!reason) throw new Error(`No attention reason for rank ${rank}`);
  return reason;
}

const utc = (date: Date) => Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

/**
 * Every envelope of one tenant with its Needs-attention rank (1 to 5, or null)
 * and the time it has waited since. Raw SQL is not scoped by the tenant
 * extension, so the tenant id is always passed in.
 */
export function rankedEnvelopes(tenantId: string, now: Date): Prisma.Sql {
  const open = Prisma.join(OPEN_ENVELOPE_STATUSES.map((s) => Prisma.sql`${s}`));
  return Prisma.sql`
    WITH r AS (
      SELECT rr."envelopeId",
             min(rr."invitedAt") FILTER (
               WHERE rr.role::text IN ('SIGNER', 'APPROVER')
                 AND rr.status::text IN ('SENT', 'DELIVERED')
                 AND rr."tokenUsedAt" IS NULL
                 AND rr."notifiedAt" IS NOT NULL
                 AND rr."invitedAt" <= ${utc(new Date(now.getTime() - NOT_OPENED_AFTER_MS))}
             ) AS unopened_since,
             min(rr."invitedAt") FILTER (
               WHERE rr.role::text IN ('SIGNER', 'APPROVER')
                 AND rr.status::text IN ('SENT', 'DELIVERED', 'VIEWED')
                 AND rr."tokenUsedAt" IS NULL
                 AND rr."notifiedAt" IS NULL
                 AND rr."invitedAt" <= ${utc(new Date(now.getTime() - NOT_DELIVERED_AFTER_MS))}
             ) AS undelivered_since,
             max(rr."declinedAt") AS declined_at
        FROM "Recipient" rr
        JOIN "Envelope" ee ON ee.id = rr."envelopeId"
       WHERE ee."tenantId" = ${tenantId}::uuid
       GROUP BY rr."envelopeId"
    ),
    ranked AS (
      SELECT e.id, e.status::text AS status, e."sentAt",
             CASE
               -- Paused, or past its deadline and not yet swept: its links already refuse.
               WHEN e.status::text = 'EXPIRED' THEN 1
               WHEN e.status::text IN (${open}) AND e."expiresAt" <= ${utc(now)} THEN 1
               WHEN e.status::text IN (${open}) AND r.unopened_since IS NOT NULL THEN 2
               WHEN e.status::text IN (${open}) AND r.undelivered_since IS NOT NULL THEN 3
               WHEN e.status::text IN (${open})
                    AND e."expiresAt" <= ${utc(new Date(now.getTime() + EXPIRING_WITHIN_MS))} THEN 4
               WHEN e.status::text = 'DECLINED'
                    AND r.declined_at >= ${utc(new Date(now.getTime() - DECLINED_WITHIN_MS))} THEN 5
             END AS rank,
             CASE
               WHEN e.status::text = 'EXPIRED' THEN coalesce(e."expiredAt", e."expiresAt")
               WHEN e.status::text IN (${open}) AND e."expiresAt" <= ${utc(now)} THEN e."expiresAt"
               WHEN e.status::text IN (${open}) AND r.unopened_since IS NOT NULL THEN r.unopened_since
               WHEN e.status::text IN (${open}) AND r.undelivered_since IS NOT NULL
                    THEN r.undelivered_since
               WHEN e.status::text IN (${open}) THEN e."expiresAt"
               WHEN e.status::text = 'DECLINED' THEN r.declined_at
             END AS since
        FROM "Envelope" e
        LEFT JOIN r ON r."envelopeId" = e.id
       WHERE e."tenantId" = ${tenantId}::uuid
    )`;
}

/** One page of Needs attention, ranked, longest-waiting first within each rank. */
export function attentionPageQuery(
  tenantId: string,
  now: Date,
  limit: number,
  status: EnvelopeStatus | undefined,
  after: AttentionCursor | undefined,
): Prisma.Sql {
  const statusFilter = status ? Prisma.sql`AND status = ${status}` : Prisma.empty;
  const afterFilter = after
    ? Prisma.sql`AND (rank, since, id) > (${after.rank}, ${utc(after.since)}, ${after.id}::uuid)`
    : Prisma.empty;
  return Prisma.sql`${rankedEnvelopes(tenantId, now)}
    SELECT id, rank, since FROM ranked
     WHERE rank IS NOT NULL ${statusFilter} ${afterFilter}
     ORDER BY rank, since, id
     LIMIT ${limit}`;
}

/** Every tab's count in one query. */
export function countsQuery(tenantId: string, now: Date): Prisma.Sql {
  const open = Prisma.join(OPEN_ENVELOPE_STATUSES.map((s) => Prisma.sql`${s}`));
  return Prisma.sql`${rankedEnvelopes(tenantId, now)}
    SELECT count(*) FILTER (WHERE rank IS NOT NULL)::int AS attention,
           count(*) FILTER (WHERE status IN (${open}) OR status = 'EXPIRED')::int AS waiting,
           count(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
           count(*) FILTER (WHERE status IN ('VOIDED', 'DECLINED'))::int AS cancelled,
           count(*) FILTER (WHERE status = 'DRAFT')::int AS drafts,
           count(*)::int AS "all"
      FROM ranked`;
}
