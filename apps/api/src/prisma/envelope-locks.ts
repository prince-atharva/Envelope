import { type EnvelopeStatus, OPEN_ENVELOPE_STATUSES } from '@envelope/shared';

/**
 * The part of a transaction client the locks need, so both the plain and the
 * tenant-scoped client's transactions satisfy it.
 */
export interface LockingTransaction {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>;
}

/**
 * Locks an envelope that is open and within its deadline, for the rest of the
 * transaction. Returns false, locking nothing, when it is not.
 *
 * A relation filter such as `envelope: { status: { in: open } }` inside an
 * `updateMany` reads the envelope without locking it, so a cancel or a decline
 * could commit between that check and this transaction's commit. Taking the
 * row lock first serialises them: Postgres re-checks the condition once the
 * lock is granted, so whichever commits first wins, and the deadline is
 * enforced at commit time rather than only when the link was checked.
 *
 * Prisma stores UTC in `timestamp` columns without a zone, so `now` is
 * converted to UTC explicitly rather than trusting the session's time zone.
 *
 * `FOR NO KEY UPDATE` rather than `FOR SHARE`: callers go on to update the
 * envelope, and two share-lock holders upgrading at once would deadlock. Two
 * signers of one envelope therefore commit one after the other, which the
 * audit trail's per-envelope lock already made them do.
 */
export async function lockOpenEnvelope(
  tx: LockingTransaction,
  envelopeId: string,
  now: Date,
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Envelope"
    WHERE id = ${envelopeId}::uuid
      AND status::text = ANY(${[...OPEN_ENVELOPE_STATUSES]}::text[])
      AND "expiresAt" > (${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')
    FOR NO KEY UPDATE`;
  return rows.length === 1;
}

/**
 * Locks an envelope whatever its state and returns its status, or null if it
 * does not exist. For state changes that must see the latest status and keep
 * everyone else out until they commit: cancel, the expiry sweep, extend, and
 * the moment a seal commits.
 */
export async function lockEnvelope(
  tx: LockingTransaction,
  envelopeId: string,
): Promise<EnvelopeStatus | null> {
  const rows = await tx.$queryRaw<{ status: EnvelopeStatus }[]>`
    SELECT status::text AS status FROM "Envelope" WHERE id = ${envelopeId}::uuid FOR UPDATE`;
  return rows[0]?.status ?? null;
}
