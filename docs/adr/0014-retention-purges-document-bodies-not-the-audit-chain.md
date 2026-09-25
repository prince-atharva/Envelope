# 0014. Retention Purges Document Bodies, Not the Audit Chain

**Status:** Accepted
**Date:** 2026-09-25
**Deciders:** Engineering

## Context

Doc 05's retention table gives every category of data a default window — 90 days for an unsent
draft, one year for a voided or declined envelope, seven years for a completed one — and then adds
one line that binds the audit trail to the envelope it documents: *"the audit trail expires with
the envelope it documents. Deleting the log while keeping the document destroys its evidentiary
value... they expire together or not at all."*

Taken literally, that line is impossible to satisfy without contradicting two decisions already
made:

1. **Doc 05's invariant 5** revokes `UPDATE`/`DELETE`/`TRUNCATE` on `AuditTrail` from the
   application's own database role, enforced by Postgres privileges in the initial migration, not
   by application convention. The application cannot delete an audit row even if it tried.
2. **ADR 0007** puts a sealed, completed document under S3 Object Lock in `COMPLIANCE` mode in
   production. That mode makes the object undeletable, by anyone, including an AWS account root
   user, before its own retention date. A completed envelope's file is retained specifically so
   that nothing — not even an application bug, not even this retention sweeper — can remove it
   early.

So a literal "envelope and audit expire together" sweeper cannot be built for a completed envelope
without either reopening `AuditTrail` to deletion (unwinding ADR 0004's whole reason for existing:
a tamper-evident log) or reopening Object Lock (unwinding ADR 0007's reason for existing). Both are
higher-value guarantees than a literal reading of one line in doc 05.

## Decision

We will draw the distinction doc 05's own language points to but does not make explicit: retention
removes what makes a document *readable* — the stored PDF bytes — never what makes it *provable*
— the audit trail that recorded what happened to it.

- **`AuditTrail` is never deleted, by the retention sweeper or anything else.** It was already
  designed this way (ADR 0004); this ADR states plainly that Phase 6's retention work does not
  change it. The chain hashes events, not file bytes, so it stays fully verifiable after a purge —
  an audit export (docs/17 step 9) works identically before and after.
- **The retention sweeper removes storage objects**, per doc 05's windows: an unsent draft's file
  90 days after its last edit, a voided or declined envelope's unlocked file after a year.
- **A completed envelope's sealed file is never reachable by the sweeper.** Object Lock already
  makes early deletion impossible; the sweeper records that a completed envelope has passed its
  policy's `retentionYears` (visible on the envelope) but takes no destructive action, because
  there is truthfully nothing it can do before the lock's own retention date — and after that date,
  removing it is a deliberate, separate operational decision, not an automatic nightly sweep.
- **Recipient personal data is pseudonymised, not deleted**, when an envelope's file is purged:
  name and email are overwritten, everything else (status, timestamps, the signature image
  reference) stays. This is safe specifically because `docs/03` already keeps names and emails out
  of audit metadata — pseudonymising `Recipient` does not touch a single audit row.
- **Legal hold overrides every sweep** (doc 07), and both placing and releasing one are themselves
  audit events, so a hold's own history is exactly as provable as everything else.
- **`Envelope.purgedAt`** marks that a purge happened; the envelope row itself, like the audit
  trail, is never deleted.

## Consequences

**Easier:**

- The one invariant that matters most — the audit trail is tamper-evident and complete — is never
  in tension with retention. A purged envelope's history reads exactly as it did before the purge.
- Object Lock and `AuditTrail`'s revoked privileges stay exactly as strict as ADR 0004 and ADR 0007
  already made them; retention does not need an exception carved into either.

**Harder:**

- "Delete my data" (doc 07's erasure matrix) is satisfied more narrowly than a literal reading
  might suggest: a person's name and email are removed from a purged envelope's recipient record,
  but the fact that an envelope existed, who a pseudonymised party's role was, and every audit
  event about it remain. This is the same outcome doc 07 already describes for a completed
  contract under legal obligation — retention wins over erasure — stated here for the retention
  sweeper specifically rather than left to be inferred.
- A completed envelope past its `retentionYears` is flagged, not removed, until its Object Lock
  date passes. A deployment that genuinely needs automatic removal at that later date is a
  follow-up, not part of this phase.

**Accepted:**

- `AuditTrail` grows without bound for as long as a tenant sends documents; nothing in this
  codebase deletes from it. Monthly partitioning was already deferred in doc 03 pending a retention
  policy to hang it on; this ADR is that policy, and its answer (see docs/17 step 12) is that
  partitioning still buys no query-speed gain without a delete path, so the deferral stands until an
  archiving strategy — moving old, closed chains to cold storage rather than deleting them — is
  designed.
