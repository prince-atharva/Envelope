# 0018. Evolve Webhooks Additively

| | |
|---|---|
| **Status** | Accepted |
| **Version** | 1.0.0 |
| **Last updated** | 28 September 2026 |
| **Audience** | Engineering and integrators |
| **What this doc answers** | How does the webhook contract gain fields, events and endpoint tooling without breaking an existing receiver? |

## In Plain Terms

A receiver written today against the released webhook contract keeps working without changes. New
information — a version marker, extra fields per event, delivery headers, a new event — only ever
gets added, never renamed or removed. Two bugs are fixed at the same time: a signed envelope's last
signature used to always be reported as leaving the envelope partially signed, and the documented
12-hour retry never actually ran.

## Technical Detail

**Date:** 2026-09-28
**Deciders:** Project owner (approved 28 September 2026)

### Context

The webhook contract shipped in `v0.7.0` (ADR 0015) and is in active use. An audit of the
implementation against `docs/08` found two defects and several gaps:

- `signing.service.ts`'s `recipient.signed` handler hard-codes `envelopeStatus: 'PARTIALLY_SIGNED'`
  even when the signature that just landed was the last one needed.
- `WEBHOOK_MAX_ATTEMPTS` was set to the length of the documented delay schedule (6), but BullMQ's
  `attempts` option counts the first try as one of them, so only 5 of the 6 documented delays
  (10s, 1m, 5m, 30m, 2h) ever ran; the 12h delay was unreachable.
- Payloads carry little beyond ids: `envelope.viewed` has no status, `envelope.voided` has no
  reason, and no event carries the envelope's title or a partner's own reference.
- Delivery requests carry no event-id, delivery-id or attempt-number header, so a receiver cannot
  deduplicate or log without first parsing and trusting the JSON body.
- Deliveries can only be browsed one endpoint at a time; there is no test event, no secret rotation,
  and a failing endpoint delivers into a void with no signal to the tenant.

This webhook contract already has integration partners depending on it, so any change here must be
additive.

### Decision

Evolve the contract only by addition:

1. Every payload gains `apiVersion: 'v1'`. Receivers are documented to ignore unknown top-level and
   `data` fields and unknown event types, so this and all following additions are compatible with a
   receiver written before this decision.
2. Fix the two bugs directly: `recipient.signed` reports the envelope's actual status (plus
   `allSigned` and `remainingSigners`), and `WEBHOOK_MAX_ATTEMPTS` becomes 7 (1 try + 6 retries), so
   the full documented schedule runs. Delivery attempt counts persist across a redrive instead of
   resetting to 0, so the number reported is the delivery's real lifetime attempt count.
3. Add commonly needed fields per event (status, email, reason) that a receiver would otherwise need
   a follow-up API call to get, and add `envelope.extended` for when an expired envelope is reopened.
   A signer's free-text decline reason is deliberately excluded from the payload — it can contain
   health information — and stays behind the authenticated `GET` detail route.
4. Add delivery headers (`X-Envelope-Event-Id`, `-Event-Type`, `-Delivery-Id`, `-Delivery-Attempt`)
   and a versioned `User-Agent`, so a receiver can log and deduplicate before parsing the body.
5. Add tenant-wide, filterable, paged delivery browsing (`GET /webhooks/deliveries`) alongside the
   existing per-endpoint route, which is kept rather than replaced.
6. Add a test-event route (one attempt, no retry, no alert, excluded from auto-disable accounting),
   secret rotation with a configurable overlap window during which both the old and new secret
   verify (`X-Signature: sha256=<new>,sha256=<old>`), an active-only endpoint cap with permanent
   deletion of inactive endpoints, and automatic deactivation with an admin email after enough
   consecutive real-delivery exhaustions.

Rejected: a `v2` webhook contract (the additive gaps do not warrant a breaking version, and a
partner would have to migrate for no functional gain); silently changing the existing per-event
`data` shape by removing or renaming fields (breaks every current receiver); making the 12h delay
question a test-only fix without documenting the corrected attempt count (leaves the contract
ambiguous about what a receiver should expect).

### Consequences

**Easier:** a receiver can deduplicate and log without parsing the body; a partial-signing bug that
misreports a fully signed envelope's status is gone; a tenant learns when its own endpoint has
stopped working instead of silently losing every event; a lost secret no longer requires burning a
permanent endpoint slot.

**Harder:** every event type needs its own schema and emitter change, reviewed for what is safe to
include (the decline-reason exclusion is the main example); delivery attempt-count semantics change
in a way the existing e2e suite's assertions must be corrected to match, not weakened to accept.

**Accepted:** `envelope.delivered` remains unfired (unchanged from ADR 0015/docs/18's "gap" note).
Event ordering between two events for the same envelope is still not guaranteed; a receiver
reconciles by reading current status, not by trusting arrival order.
