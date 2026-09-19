# 0004. Hash-Chain the Audit Trail

**Status:** Accepted
**Date:** 2026-09-19 (the decision dates from docs 05 and 10, 10 September 2026; recorded when the
nightly check was built in Phase 5)
**Deciders:** Engineering

## Context

The audit trail is the evidence behind every signed document: who opened it, agreed, signed, and
when. Making the table append-only (no `UPDATE` or `DELETE` for the application's database role)
stops the application from rewriting history. It does not stop someone with owner or superuser
access, a careless migration, or a restored backup that was edited first. For those, nothing in an
append-only table shows that a row was changed.

## Decision

- **Every event is chained to the one before it, per envelope.** Each row stores `sequence`
  (1, 2, 3 … per envelope), `prevHash` (the previous row's `eventHash`, null for the first) and
  `eventHash = SHA-256(prevHash | action | timestamp | canonical JSON of the rest of the row)`
  (`apps/api/src/audit/audit-chain.ts`). Changing any field of any event breaks its hash and every
  link after it, and the check names the first bad row.
- **Written in the same transaction as the change it records**, under a per-envelope advisory lock,
  so the sequence has no gaps and two writers cannot fork the chain.
- **Privileges as well as hashes.** The application role has no `UPDATE`, `DELETE` or `TRUNCATE` on
  the table, and foreign keys into it are `RESTRICT` (doc 05, invariant 5).
- **Checked every night.** A scheduled job walks every envelope's chain and emails an alert on any
  break (Phase 5). `pnpm --filter @envelope/api audit:check` runs the same check on demand.

## Consequences

**Easier:**

- An edited or reordered event is detectable, and the break points at the exact row.
- The check needs nothing but the table itself.

**Harder:**

- Audit metadata can never be corrected once written, so personal data is kept out of it (names,
  emails, reasons live on their own rows).
- Every event write takes an envelope-level lock, which serialises events for one envelope.

**Accepted:**

- The chain has no outside anchor. Deleting the newest events of an envelope, by someone able to
  bypass the privileges, leaves a shorter but valid chain. The nightly check also compares each
  envelope's status with the event that must exist for it (a completed envelope needs its
  `ENVELOPE_COMPLETED`), which catches the common case. Publishing chain heads elsewhere is left
  until it is needed.
