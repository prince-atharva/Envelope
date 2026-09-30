# 0029. Receive Delivery Events Through One Neutral, Authenticated Endpoint

**Status:** Accepted
**Date:** 2026-09-30
**Deciders:** Engineering

## Context

Mail leaves through one SMTP transport (`MailTransportService`, nodemailer). In development that is
Gmail. For production the project wants a transactional provider (Postmark, SES or another) without
tying the code to one. Phase 8 recorded the gap (docs/19): a signing link that never arrives cannot be
detected, and bulk send multiplies the number of mails that can silently fail. docs/03 says bounces
should reach the audit trail; nothing receives them.

Two constraints matter. The audit trail is append-only and hash-chained (ADR 0004), so a bounce cannot
update an earlier `EMAIL_SENT` row. And providers differ: a bounce arrives as a webhook with its own
shape, its own authentication and its own idea of a message id.

## Decision

We will keep SMTP as the only transport and add one neutral inbound endpoint:

1. **Provider stays configuration.** `SMTP_*` already points at any SMTP relay. Gmail keeps working in
   development; Postmark, SES SMTP or any other relay works in production with no code change. No SDK
   and no provider API transport is added.
2. **`MailDelivery` records what was sent.** When the transport sends a message that belongs to an
   envelope (signing link, reminder, completion, cancellation), it writes one row with the message id
   and recipient. This table is operational and mutable, separate from the audit trail.
3. **`POST /mail-events/:adapter`** receives events. It is `@Public()` and authenticated with a shared
   secret (`MAIL_EVENTS_SECRET`) in a bearer or basic-auth header, compared in constant time; the
   endpoint answers 404 when the secret is not configured, and 401 for a wrong one, writing nothing.
   It is rate limited by address.
4. **Adapters translate to one neutral event**: `{messageId, type: BOUNCED | COMPLAINED, reason?,
   occurredAt}`. `generic` is the neutral shape itself; `postmark` is the first vendor adapter. Adding
   one is a pure function and a test.
5. **A known event is recorded, an unknown one ignored.** For a known message id the row's status
   changes, an `EMAIL_BOUNCED` (or `EMAIL_COMPLAINED`) audit event is appended on the envelope in the
   same transaction, the sender is emailed a notice, and the envelope detail shows the recipient's
   address as undeliverable. An unknown message id is logged at debug and answered 202: the endpoint
   never reveals which ids exist.
6. **Redaction.** Logs carry the envelope id and a masked address, never the secret, the message body or
   a signing link.

We rejected:

- **A vendor HTTP-API transport.** A new dependency and lock-in, and Gmail would no longer work
  locally.
- **Updating the `EMAIL_SENT` audit row.** Breaks the append-only chain.
- **One endpoint per vendor.** Duplicates authentication and recording; adapters are the small part.
- **Polling the provider.** More credentials, more moving parts, slower than a webhook.

## Consequences

**Easier:**

- Changing provider is configuration plus, at most, one adapter function.
- A failed delivery becomes visible to the sender and to the audit trail.

**Harder:**

- The provider must report the message id we sent. SMTP providers differ here: some echo the
  `Message-ID` header, some return their own id at send time. Step 7 of the plan checks each adapter
  against the provider's documentation and records the result; an adapter whose provider cannot echo our
  id stays out of the release.
- A new table, a new public route and one secret to rotate.

**Accepted:**

- Only bounces and complaints. Delivered, opened and clicked events are not recorded.
- No suppression list: a bounced address can be mailed again.
- Only the `generic` and `postmark` adapters ship; SES (through SNS) needs an adapter later.
- Events are at-least-once: a repeated event for the same message id and type is ignored, not
  appended twice.
