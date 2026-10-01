# 0032. Delegate by Adding a Recipient and Keeping the Delegator as History

**Status:** Accepted
**Date:** 2026-10-01
**Deciders:** Product owner, engineering

## Context

Requirement REC-07 (docs/01) and the edge-case table in docs/09 let a signer hand their part of an
envelope to someone else, with both parties notified and the step fully audited. The data model
(docs/05) says every audit row points at one recipient, "the column that ties evidence to a person",
and that a recipient with completed work is never deleted. Consent (ESIGN, docs/07) is recorded per
person, verbatim, on the `Recipient` row.

## Decision

We will model a delegation as a **new `Recipient` row** for the delegate, and keep the delegator's row
as history with status `DELEGATED`.

- The delegate gets the delegator's role, routing order and colour, and takes over their fields
  (`DocumentField.recipientId` moves; positions never change).
- The delegator's row stays, with `delegatedAt`; the delegate's row carries `delegatedFromId`.
- One `RECIPIENT_DELEGATED` audit row is written in the same transaction. It holds ids only, never
  email addresses; the people are already on the two `Recipient` rows.
- The delegate's consent is their own. Nothing the delegator consented to or adopted carries over; the
  delegator's stored signature images are deleted.
- The old link answers `TOKEN_DELEGATED` (410), so its holder is told what happened.
- Delegation is **off unless the sender allows it** when sending (`Envelope.allowDelegation`, frozen at
  send), is limited to SIGNER and APPROVER, and is **one hop**: a delegate cannot delegate again.

Rejected: **editing the recipient's name and email in place.** It is the smaller change, but the audit
rows of the first person (consent, viewing) would then point at the second, and a dispute over "who
consented" could not be answered from the records. Also rejected: leaving delegation to the sender
(remove and re-add), which is forbidden once work exists.

## Consequences

**Easier:** Evidence stays attributable to the right person. Counts, certificates and webhooks use the
normal recipient machinery.

**Harder:** A new status appears in about 25 places that list recipient statuses (progress, expiry,
reminders, retention, sealing, dashboard SQL). Each must ignore `DELEGATED` rows, and each gets a test.

**Accepted:** A delegator whose link is spent sees an explanation, not the document. Template and bulk
sends cannot enable delegation yet. A chain of delegations is not supported.
