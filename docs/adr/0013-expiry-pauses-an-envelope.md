# 0013. Expiry Pauses an Envelope; the Sender Can Extend It

**Status:** Accepted
**Date:** 2026-09-19
**Deciders:** Engineering, with the product owner
**Amends:** ADR 0009 (a link's expiry now moves with an extension)

## Context

Every envelope has a deadline (`expiresAt`, 14 days by default). Until Phase 5 it was only checked
when a link was used: an overdue envelope stayed "Sent" for ever, and a signer who came back late was
told to ask the sender for a new link, which the sender had no way to give. Docs 01, 03 and 05 name
three terminal states (`COMPLETED`, `DECLINED`, `VOIDED`) and do not say what expiry does to the
envelope.

Two ways were considered:

1. **Expired is final**, like Cancelled. Simple, but one late signer means sending the whole
   envelope again, and the people who already signed must sign again.
2. **Expired pauses the envelope.** The sender can extend the deadline or cancel.

## Decision

We will use option 2.

- **`EXPIRED` is a status that is not terminal.** A sweep on the worker, every 5 minutes, moves an
  open envelope past its deadline to `EXPIRED` when someone who must sign or approve has not, and
  writes `ENVELOPE_EXPIRED`. An envelope where everyone has signed and only sealing is left is never
  expired.
- **Extend** (`POST /v1/envelopes/:id/extend`) sets a new deadline and writes `ENVELOPE_EXTENDED`. An
  expired envelope returns to `PARTIALLY_SIGNED` if anyone has signed, otherwise to `SENT`. Fresh
  links are emailed to whoever's turn it is. An expired envelope can also be cancelled.
- **A signer on an expired link can ask for more time.** That link is accepted by exactly one route,
  whose only effect is an email to the sender and an `EXTENSION_REQUESTED` event.
- **An expired envelope is not stamped.** A signature submitted before the deadline is safe in the
  database. It is stamped into its version when the envelope is extended, by the seal worker, which
  then invites anyone now due. Only the seal worker moves routing forward, so an extension cannot race
  a stamping round.
- **Amends ADR 0009:** a link's `tokenExpiresAt` was set to the envelope's deadline when minted and
  never changed. Extending now moves it on every unused link as well, so a live link does not die at
  the old deadline if the new email is late. Every email still carries a new link.

## Consequences

**Easier:**

- A late signer is one click for the sender, and nobody signs twice.
- The dashboard can list expired envelopes as needing attention.

**Harder:**

- One more status for every check of "is this envelope open?". The open and terminal sets are defined
  once, in `@envelope/shared`.
- The state machine in doc 03 gains four transitions (expire, extend, and cancel or extend from
  expired).

**Accepted:**

- An envelope can stay paused indefinitely. Retention (Phase 6) decides when a long-expired envelope
  is cleaned up.
