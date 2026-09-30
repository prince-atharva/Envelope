# Recipes

| | |
|---|---|
| **Status** | Current |
| **Version** | 1.0.0 |
| **Last updated** | 30 September 2026 |
| **Audience** | Developers connecting an application to Envelope |
| **What this doc answers** | How do I handle the awkward cases: retries, lost responses, missed events? |

## In Plain Terms

Networks fail. These are the patterns that keep your records and Envelope's in agreement when a
response is lost, a request is repeated or your server is briefly down.

## Technical Detail

### Retry a send without sending twice

`POST /envelopes/:id/send` requires an `Idempotency-Key`. Generate one UUID per send, and on a network
failure repeat the request with the same key and the same body. Within 24 hours the first result is
replayed (`Idempotency-Replayed: true`) instead of inviting people again. The same key with a
different body answers `422 IDEMPOTENCY_KEY_MISMATCH`.

### Recover a document whose creation response was lost

Create the envelope with your own `externalId`. If the response never arrived, list by it:

```bash
curl "$ENVELOPE_URL/api/v1/envelopes?externalId=visit:1001" \
  --header "Authorization: Bearer $ENVELOPE_API_KEY" | jq '.items[0].id'
```

Or send an optional `Idempotency-Key` on the upload so a repeat returns the draft the first request
created, instead of a second one.

### Never lose a completion

Treat webhooks as the fast path and reading as the safety net. On `envelope.completed`, download
`/documents/completed` and store it. Additionally, once a day, list `view=waiting` documents and read
any that have been open for longer than expected: your record then converges even if a delivery was
missed. Deduplicate events on `event.id`.

### Replay events after an outage

Open **Manage connections → Deliveries**, filter by status, and retry failed deliveries within seven
days. Your receiver must be idempotent: a redriven event carries the same `event.id`.

### Rotate a webhook secret without dropping events

Rotate in the web app with the default 24-hour overlap. During the window `X-Signature` carries two
signatures; the receiver in the [webhook guide](webhooks.md) accepts either. Deploy the new secret,
confirm a delivery verifies, and the old one expires on its own.

### Reopen a draft in the embedded editor

Store the envelope id against your record when `draft.created` arrives (after verifying it with the
API key). Later, issue an `existing` session for that id. Do not upload again.

### Cancel a document sent by mistake

`POST /envelopes/:id/void` with a `reason`. The signing links stop working and recipients are told
why. It cannot be undone, and a completed envelope cannot be cancelled (`ENVELOPE_TERMINAL`).

### Poll politely

If you must poll, use `GET /envelopes/:id` with `If-None-Match`. An unchanged document answers `304`
with no body and costs almost nothing.
