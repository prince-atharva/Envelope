# 0019. Partner Reference and Optional Idempotency

| | |
|---|---|
| **Status** | Accepted |
| **Version** | 1.0.0 |
| **Last updated** | 28 September 2026 |
| **Audience** | Engineering and integrators |
| **What this doc answers** | How does a partner attach its own record identifier to an envelope, and how does it safely retry a create request? |

## In Plain Terms

A partner can put its own record's identifier and a few small labels on an envelope when creating
it. That identifier and those labels show up in every webhook for that envelope, so the partner's
system knows which of its own records an event is about without keeping a separate lookup table
that only maps ids created at one point in time. Creating an envelope or an embedded editor session
can also carry an idempotency key, so a network retry after a lost response does not create a
duplicate.

## Technical Detail

**Date:** 2026-09-28
**Deciders:** Project owner (approved 28 September 2026)

### Context

Every webhook payload today carries only Envelope's own ids (`envelopeId`, `recipientId`). A partner
integration must keep its own mapping from those ids to its own record, and if the response to the
original create call is lost — a network timeout, a crashed partner process before it persisted the
response — there is no way to look the envelope back up by anything the partner already has. Two
existing routes, `POST /envelopes/:id/send` and `POST /envelopes/:id/extend`, already require an
`Idempotency-Key` (via `IdempotencyService`) for exactly this reason; envelope creation and embedded
session creation do not.

### Decision

Add an optional `externalId` (1–200 characters, restricted charset) and a bounded `metadata` object
(at most 10 string-valued keys, 2 KB total) to an envelope. Both may be set at creation or while the
envelope is still a draft — the same mutability window every other draft-only field already has —
and are fixed once it is sent. `externalId` is not enforced unique: the partner's own system is
responsible for its own uniqueness, and a non-unique field avoids inventing conflict semantics this
system has no way to arbitrate. Add an exact-match `externalId` filter to the envelope list. Every
webhook payload for an envelope echoes its `externalId` and `metadata`, read once per event alongside
the existing per-event lookup, so no extra query is added per delivery.

Extend `IdempotencyService.run()` to support an **optional** key (the existing send/extend usage
keeps requiring one) and reference-only storage: Redis stores an id pointing back to the created
resource, never the full response body or, for embedded sessions, a raw launch token. A replayed
`POST /envelopes` returns the same envelope. A replayed `POST /embed/sessions` cannot return the
original launch token — it may already be expired or consumed — so it instead reissues a fresh
token bound to the same `sessionId`, invalidating the previous one.

Rejected: a globally unique `externalId` (would require a policy for what happens when two of a
partner's own systems reuse the same value, which is the partner's problem, not this system's);
storing full idempotent responses for embedded sessions (a stored launch token would be a live
secret sitting in Redis past its intended 60-second window); making the new idempotency keys
required (breaks every existing caller of these two routes that has never sent one).

### Consequences

**Easier:** a partner can look up its own record's envelope by a field it chose, not one this system
generated; a lost create response is recoverable without a duplicate envelope; a lost session-create
response is recoverable without waiting out the partner's own retry logic against a dead session.

**Harder:** `metadata` needs bounds enforcement and redaction (`logging/redact.ts`) since it is
attacker- and partner-controlled free text stored in Postgres; the idempotency service now has two
different behaviors (required-with-full-response, optional-with-reference) that must not be confused
by a future caller.

**Accepted:** `externalId` and `metadata` support only exact-match filtering; there is no full-text
or partial search. Both are read-only once an envelope is sent, so a partner that needs to relabel a
sent envelope cannot do so through this field.
