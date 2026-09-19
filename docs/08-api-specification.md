# API Specification

| | |
|---|---|
| **Status** | Draft |
| **Version** | 1.0.0 |
| **Last updated** | 10 September 2026 |
| **Audience** | Everyone (Part 1) · Engineering and integrators (Part 2) |
| **What this doc answers** | What can other software do with this system, and how? |

---

# PART 1 — In Plain Terms

## Why This Exists

Everything a person can do on the website, another piece of software can also do automatically. That is what this document describes.

The point is that signing rarely happens on its own. It is usually the last step of something else:

- A sales system closes a deal, so the contract should go out **automatically** — nobody should be copying names into a form.
- An HR system hires someone, so the offer letter and policy documents should go out **the moment the hire is confirmed**.
- A finance system approves a purchase, so the order should go for signature **without anyone remembering to do it**.

Without this, someone has to sit between those systems and ours, copying details across by hand. That person will make mistakes, go on holiday, and leave.

## The Two Directions

There are two ways systems talk to each other here, and they solve opposite problems.

**Push — your system tells ours to do something.**
"Send this contract to this person." Your software makes the request, ours does the work.

**Notify — our system tells yours something happened.**
"Raj just signed." We contact your software the moment it happens.

The second direction matters more than people expect. Without it, your system would have to keep asking *"is it signed yet? is it signed yet?"* every few minutes, forever, for every outstanding document — wasteful, slow, and it still means finding out minutes late. Instead we simply tell you, within a second of it happening.

## What Can Be Automated

| Task | Description |
|---|---|
| Send a document | Upload, add people, add boxes, send — all in one request |
| Use a saved template | Send a standard contract by supplying only a name and email |
| Check status | Find out where something has got to |
| Send a reminder | Nudge someone who has not responded |
| Cancel | Stop a document that is no longer needed |
| Download | Retrieve the finished document or its certificate |
| Verify | Check whether a document has been altered |
| Get the full history | Retrieve the complete record for an audit |

## One Safety Feature Worth Explaining

There is a specific protection built into sending, and it prevents a genuinely embarrassing failure.

Networks are unreliable. Sometimes a request arrives, gets processed, and the confirmation is lost on the way back. The sending system, having heard nothing, assumes it failed and tries again.

Without protection, that means **the same contract is sent to your client twice.** They receive two identical emails, get confused, possibly sign both, and now you have two contracts and a question about which one counts.

The fix is that each send carries a unique reference number. If we see the same reference twice, we recognise it as a repeat, ignore it, and return the original result. The client receives exactly one contract regardless of how many times the request is retried.

---
---

# PART 2 — Technical Detail

> Written for engineering and integrators. Non-technical readers can stop here.

## Conventions

| Aspect | Convention |
|---|---|
| Base URL | `https://api.{host}/v1` |
| Format | JSON; `Content-Type: application/json` |
| Uploads | `multipart/form-data` |
| Auth (server) | `Authorization: Bearer <api_key>` |
| Auth (sender UI) | Session cookie or JWT |
| Auth (signer) | Opaque single-use token in the path — no header |
| Pagination | Cursor-based: `?limit=50&cursor=<opaque>` |
| Errors | RFC 7807 `application/problem+json` |
| Idempotency | `Idempotency-Key: <uuid>` on all creating POSTs |
| Timestamps | ISO 8601, UTC, always |
| IDs | UUID v4 |
| Rate limits | Per tenant; `X-RateLimit-*` headers on every response |
| Versioning | URL path. Breaking changes increment the version. |

## Authentication

| Caller | Mechanism | Scope |
|---|---|---|
| Server integration | API key, `Bearer` | Whole tenant |
| Sender UI | Session / JWT | Own envelopes |
| Signer | Single-use path token | One envelope, own fields |
| Webhook receiver | HMAC-SHA256 signature header | Verification only |

API keys are shown once at creation, stored hashed, and are revocable. They MUST be scoped to a tenant and SHOULD support read-only variants.

**Signer tokens are never sent in a header** — they arrive in the URL from an email link. Consequently they MUST NOT be logged, MUST be single-use, and MUST expire. See [10-security-and-threat-model.md](10-security-and-threat-model.md).

## Envelopes

### `POST /v1/envelopes`

Create a draft.

```json
{
  "title": "Consulting Agreement — Acme Corp",
  "documentCategory": "COMMERCIAL_CONTRACT",
  "jurisdictionCode": "US",
  "sequentialSigning": true,
  "expiresInDays": 30,
  "recipients": [
    { "name": "Priya Sharma", "email": "priya@example.com", "role": "SIGNER", "routingOrder": 1 },
    { "name": "Raj Patel",    "email": "raj@example.com",   "role": "SIGNER", "routingOrder": 2 },
    { "name": "Sam Lee",      "email": "sam@example.com",   "role": "CC",     "routingOrder": 3 }
  ]
}
```

`201 Created`:

```json
{
  "id": "3f7a1b2c-...",
  "status": "DRAFT",
  "title": "Consulting Agreement — Acme Corp",
  "recipients": [
    { "id": "9d4e...", "name": "Priya Sharma", "email": "priya@example.com",
      "role": "SIGNER", "routingOrder": 1, "status": "PENDING" }
  ],
  "createdAt": "2026-09-10T09:15:00Z"
}
```

`documentCategory` is validated against the jurisdiction's blocked list — see [07-compliance-layer.md](07-compliance-layer.md).

### `POST /v1/envelopes/:id/documents`

`multipart/form-data`, field `file`. Max 25 MB, 500 pages.

`201 Created`:

```json
{
  "documentId": "8c2f...",
  "filename": "consulting-agreement.pdf",
  "pageCount": 12,
  "originalHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "pageDimensions": [
    { "page": 1, "widthPt": 612, "heightPt": 792, "rotation": 0 }
  ]
}
```

`pageDimensions` is returned so the client can render and place fields without a second request. `rotation` matters — see doc 06 gotchas.

### `PUT /v1/envelopes/:id/fields`

Replaces the **whole** field layout. **Ratios only.**

> **As built (Phase 2).** The design said `POST` without saying whether a second
> call added to the layout or replaced it. The builder always holds the complete
> layout, so it sends the complete layout: replacement has one meaning, and a
> field the user deleted cannot come back. Sending `{"fields": []}` clears them.
>
> Each field carries an `id` chosen by the client, so a field keeps its identity
> across the saves that happen while it is being dragged.
>
> An unchanged layout is accepted and written nowhere: no audit event, no new
> revision. Autosave fires on every interaction, and without this the audit chain
> would fill with events that record nothing.

```json
{
  "fields": [
    {
      "id": "f1c0...",
      "recipientId": "9d4e...",
      "type": "SIGNATURE",
      "pageNumber": 4,
      "ratioX": 0.43, "ratioY": 0.74,
      "ratioWidth": 0.25, "ratioHeight": 0.06,
      "required": true
    },
    {
      "id": "f1c1...",
      "recipientId": "9d4e...",
      "type": "DATE_SIGNED",
      "pageNumber": 4,
      "ratioX": 0.72, "ratioY": 0.74,
      "ratioWidth": 0.15, "ratioHeight": 0.04,
      "required": true
    }
  ]
}
```

Validation — all MUST pass or the whole request is rejected:

- Every ratio in `[0.0, 1.0]`
- `ratioX + ratioWidth <= 1.0`, `ratioY + ratioHeight <= 1.0`
- `pageNumber` within the document's page count
- `recipientId` belongs to this envelope, and is not a VIEWER or CC — they mark nothing
- at most 1000 fields, and no two fields sharing an `id`

Ratios are rounded to six decimals before they are stored, so the same box placed
at any zoom level produces the same numbers ([ADR 0002](adr/0002-store-field-coordinates-as-ratios.md)).

Pixel coordinates are not accepted in any form. A request containing `x`, `y`, `width`, or `height` is rejected with `INVALID_COORDINATE_SPACE` — a deliberately loud failure, because silently accepting pixels is exactly how misplaced signatures reach production.

### Editing a draft (Phase 2)

Not in the original specification, which described creating an envelope with its
recipients and then sending it. Preparing a document is an editing session, so
each part of it can be changed on its own.

| Method | Path | What it changes |
|---|---|---|
| `PATCH` | `/v1/envelopes/:id` | `title`, `message`, `sequentialSigning` |
| `POST` | `/v1/envelopes/:id/recipients` | adds one person; the colour is assigned here |
| `PATCH` | `/v1/envelopes/:id/recipients/:recipientId` | name, email, role, routing order |
| `DELETE` | `/v1/envelopes/:id/recipients/:recipientId` | removes them, and their fields |
| `PUT` | `/v1/envelopes/:id/fields` | the whole layout, above |

All of them require the envelope to be a **draft**, and answer `ENVELOPE_NOT_DRAFT`
(409) otherwise. All of them return the envelope's new `draftRevision`.

**Concurrency.** `GET /v1/envelopes/:id` returns `draftRevision` and an `ETag`.
A change may carry that value as `If-Match: "7"`. If the draft has moved on
since, the request is refused with **412 `DRAFT_REVISION_MISMATCH`** rather than
overwriting what the other tab did. Without the header the change is applied
unconditionally, which suits a script that owns the envelope.

Changing someone to `VIEWER` or `CC` deletes their fields in the same
transaction, and the response says how many went in `fieldsRemoved`.

### `POST /v1/envelopes/:id/send`

**Requires `Idempotency-Key`.**

```json
{ "message": "Please review and sign by Friday.", "expiresInDays": 14 }
```

Both are optional, and so is the body. `expiresInDays` is 1 to 90 and defaults to the server's
`SIGNING_DEFAULT_EXPIRY_DAYS` (14). `message` replaces the envelope's message; `null` clears it.

`200 OK`:

```json
{
  "id": "3f7a1b2c-...",
  "status": "SENT",
  "sentAt": "2026-09-10T09:20:00Z",
  "expiresAt": "2026-09-24T09:20:00Z",
  "invited": [
    { "id": "9d4e...", "status": "SENT" }
  ]
}
```

Replaying the same `Idempotency-Key` within 24 hours returns the original response with `Idempotency-Replayed: true`. It does not resend.

Preconditions: at least one recipient; every `SIGNER` and `APPROVER` has at least one required field; at least one document; status is `DRAFT`.

> **As built (Phase 3).**
>
> - **`invited`, not `recipients` with `notifiedAt`.** Emails are sent by the worker after the
>   response, so no delivery time is known yet. `invited` lists everyone emailed now: every signer and
>   approver when signing is *everyone at once*, only the lowest `routingOrder` group when it is
>   *one after another*. The next group is invited when every signature in the current one has
>   been stamped into a document version (Phase 4), so they see those signatures. VIEWER and CC are not emailed until the finished copy exists (Phase 4). Progress
>   comes from `GET /v1/envelopes/:id`, below.
> - **Idempotency.** The key is 8 to 128 letters, digits, dots, dashes or colons, and is scoped to
>   the tenant and the envelope. Without it the request gets 400 `IDEMPOTENCY_KEY_REQUIRED`. The
>   same key with a different body gets 422 `IDEMPOTENCY_KEY_MISMATCH`. A request that fails
>   releases its key, so it can be retried as it was. Only a hash of the key is stored.
> - **Refusals list every problem** in `errors`: `RECIPIENT_HAS_NO_FIELDS` when that is the
>   problem, otherwise 422 `NOT_READY_TO_SEND`. An envelope with only VIEWER and CC recipients is
>   refused too. A sent envelope gets 409 `ENVELOPE_NOT_DRAFT`.
> - **Nothing is sent inside the transaction.** One transaction locks the draft, re-checks it, sets
>   `SENT`, `sentAt` and `expiresAt`, marks the first group invited and writes `ENVELOPE_SENT`. The
>   invitation jobs are queued after it commits. Each job carries only ids. The worker creates the
>   signing link, stores its HMAC and sends the email ([ADR 0009](adr/0009-store-only-the-hmac-of-signing-tokens.md)).

### Other envelope operations

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/envelopes/:id` | Full state including recipients, fields, versions |
| `GET` | `/v1/envelopes?status=&cursor=&limit=` | List, filterable |
| `POST` | `/v1/envelopes/:id/void` | Cancel. Body: `{ "reason": "..." }`. Invalidates all tokens synchronously. |
| `POST` | `/v1/envelopes/:id/remind` | Nudge outstanding recipients. Rate-limited to 1/recipient/24h. Built in Phase 3; see below. |
| `GET` | `/v1/envelopes/:id/documents/original` | The untouched upload |
| `GET` | `/v1/envelopes/:id/documents/completed` | The sealed document. `409` if not `COMPLETED`. |
| `GET` | `/v1/envelopes/:id/documents/versions/:n` | A specific version from the chain |
| `GET` | `/v1/envelopes/:id/audit` | Full audit trail |

#### `POST /v1/envelopes/:id/remind` (Phase 3)

```json
{ "recipientIds": ["9d4e..."] }
```

The body is optional. Without `recipientIds`, everyone whose turn it is and who has not finished is
reminded. `200 OK`:

```json
{
  "reminded": ["9d4e..."],
  "skipped": [{ "recipientId": "b71c...", "reason": "NOT_THEIR_TURN" }]
}
```

- `reason` is `TOO_SOON`, `NOT_THEIR_TURN` or `FINISHED`. If nobody could be reminded and at least
  one person was reminded within the last 24 hours, the answer is 429 `REMINDER_TOO_SOON`, with
  `Retry-After` for the soonest of them.
- If no email has reached the person yet, a reminder may be retried after 10 minutes. This is also
  how a failed invitation is sent again.
- **Every reminder carries a new link, and the previous one stops working.** Only the link's HMAC
  is stored, so there is nothing to resend (ADR 0009).
- Each reminder writes `REMINDER_REQUESTED`.
- A draft gets 409 `CONFLICT`, a closed envelope 409 `ENVELOPE_TERMINAL`, and a recipient id that
  is not on the envelope 404.

**Progress.** From Phase 3, `GET /v1/envelopes/:id` includes `sentAt` and `expiresAt`, and for
each recipient `invitedAt`, `notifiedAt` (the mail server accepted the last email), `lastRemindedAt`,
`viewedAt`, `signedAt`, `declinedAt` and `declinedReason`. The reason is shown to the sender only.

## Signing Session

Unauthenticated, token-gated. Consumed by the signer portal.

| Method | Path | Purpose | Audit event |
|---|---|---|---|
| `GET` | `/v1/sign/:token` | Fetch session: this recipient's fields (after consent), consent requirement | `ENVELOPE_VIEWED`, first time only |
| `GET` | `/v1/sign/:token/document` | The PDF, only after consent | — |
| `POST` | `/v1/sign/:token/consent` | Record consent. Body: `{ "agreed": true, "consentTextHash": "..." }` | `CONSENT_GIVEN` |
| `POST` | `/v1/sign/:token/adopt` | Adopt a signature or initials image | `SIGNATURE_ADOPTED` |
| `POST` | `/v1/sign/:token/submit` | Submit field values and finish | `RECIPIENT_SIGNED` |
| `POST` | `/v1/sign/:token/decline` | Decline. Body: `{ "reason": "..." }` — required | `RECIPIENT_DECLINED` |

`GET /v1/sign/:token` → `200 OK`, before consent:

```json
{
  "envelopeTitle": "Consulting Agreement — Acme Corp",
  "senderName": "Priya Sharma",
  "recipientName": "Raj Patel",
  "pageCount": 12,
  "expiresAt": "2026-09-24T09:20:00Z",
  "message": "Please review and sign by Friday.",
  "consentRequired": true,
  "consentText": "DRAFT — not legally reviewed. ...\n\nAgreement to sign electronically\n\nBy ticking the box below, you agree...",
  "consentTextHash": "5e88...",
  "fields": [],
  "adopted": {}
}
```

After consent, `consentRequired` is `false`, `consentText` and `consentTextHash` are `null`, and
`fields` holds this recipient's fields, in the order the signer is guided through them (page, then
top to bottom, then left to right):

```json
  "fields": [
    { "id": "a1b2...", "type": "SIGNATURE", "pageNumber": 4,
      "ratioX": 0.43, "ratioY": 0.74, "ratioWidth": 0.25, "ratioHeight": 0.06,
      "required": true }
  ],
  "adopted": { "SIGNATURE": "DRAWN" }
```

Only **this recipient's** fields are returned. Other recipients' fields are never exposed — that would leak who else is signing and where.

> **As built (Phase 3).** Where this differs from the original design:
>
> - **Nothing about the document before consent.** The design returned `documentUrl` and the fields
>   while `consentRequired` was still true. Doc 07 makes consent a server-side precondition, so the
>   fields are empty and `GET /v1/sign/:token/document` answers 403 `CONSENT_REQUIRED` until
>   consent is given. There is no signed storage URL: the document is streamed through the API, so
>   the token check applies to it as well.
> - **Consent carries the hash of what was shown.** `consentTextHash` is the SHA-256 of the notice
>   the portal displayed. If the notice has changed since, the answer is 409
>   `CONSENT_TEXT_CHANGED`, and the portal shows the new text. The stored text is therefore always
>   the text the signer saw (doc 07). `200 OK` returns `{ "consentGivenAt": "..." }`; repeating it
>   changes nothing.
> - **Signatures are adopted separately from submit.** The design sent a data URL in every
>   signature field of the submit body. Doc 07 audits *Adopt & Sign* and *Finish* as separate
>   events, and a 500 KB image per field would not fit in the 1 MB body limit.

`POST /v1/sign/:token/adopt`:

```json
{ "kind": "SIGNATURE", "method": "DRAWN", "image": "data:image/png;base64,iVBORw0KG..." }
```

- `kind` is `SIGNATURE` or `INITIALS`, and `method` is `DRAWN` or `TYPED`.
- The image must be a PNG with an alpha channel (never JPEG, doc 06), at most 500 KB and 4096 px on
  each side. Otherwise the answer is 400 `VALIDATION_FAILED` or 422 `INVALID_SIGNATURE_IMAGE`.
- One image is kept per kind. Adopting again replaces it, and the unused image is deleted.
- It is stored at `tenants/{t}/envelopes/{e}/signatures/{recipientId}/{kind}-{uuid}.png`, and the
  audit event records the method and the image's SHA-256.
- `200 OK` returns `{ "kind": "SIGNATURE", "method": "DRAWN" }`.

`POST /v1/sign/:token/submit`:

```json
{
  "fields": [
    { "id": "c3d4...", "value": "true" },
    { "id": "e5f6...", "value": "Acme Corp" }
  ]
}
```

- `TEXT_INPUT` takes the text, up to 500 characters. `CHECKBOX` takes `"true"` or `"false"`.
- Every required `SIGNATURE` and `INITIALS` field is filled from the adopted image of its kind. An
  optional one is filled only if it is listed, and any value sent for it is ignored.
- A field that belongs to someone else is refused with 400 `VALIDATION_FAILED`. Missing required
  values give 422 `REQUIRED_FIELDS_INCOMPLETE`, listing each one in `errors`.

`202 Accepted`:

```json
{
  "status": "SIGNED",
  "signedAt": "2026-09-10T14:32:11Z",
  "message": "Your signature has been recorded. The completed document will be emailed once everyone has signed."
}
```

`202`, not `200`: sealing is asynchronous. The signer gets immediate confirmation; the document is assembled on a worker.

On submit the token is invalidated. `DATE_SIGNED` fields are **server-generated** and any client-supplied value is discarded.

> **As built (Phase 3).** One transaction claims the recipient with a guarded update, so two
> submits cannot both succeed; the loser gets 410 `TOKEN_ALREADY_USED`. The same transaction stores
> the values, records the IP address and browser, moves the envelope to `PARTIALLY_SIGNED` and
> writes `RECIPIENT_SIGNED`, whose metadata names the version the signer was served
> (`documentVersion`, `documentSha256`). A `seal` job then stamps the signature into the next
> version (Phase 4), and with *one after another* the next group is invited once it exists.

`POST /v1/sign/:token/decline` is allowed before consent. The reason is required, up to 1000
characters. In one transaction it moves the recipient and the envelope to `DECLINED` and writes
`RECIPIENT_DECLINED`, which stops every link on the envelope. The reason stays on the recipient, not
in the audit metadata, which cannot be edited later. The sender is emailed with the reason.
`200 OK` returns `{ "status": "DECLINED", "declinedAt": "..." }`.

**Checking a link.** Every route checks the token in the same order, and the first match wins:

| Check | Answer |
|---|---|
| Malformed, unknown, or replaced by a reminder | 401 `TOKEN_INVALID` |
| The envelope was voided or declined | 409 `ENVELOPE_TERMINAL`, with `reason` `VOIDED`, `DECLINED` or `YOU_DECLINED` |
| This recipient has already signed | 410 `TOKEN_ALREADY_USED` |
| The link or the envelope has expired | 401 `TOKEN_EXPIRED` |

**Headers.** Every signing response sends `Cache-Control: no-store` and
`Referrer-Policy: no-referrer`. Problem details never echo the token: `instance` reads
`/v1/sign/[redacted]`.

## Completion Download (Phase 4)

### `GET /v1/download/:token`

The private link in a completion email when the finished document is too large to attach
(over `COMPLETION_ATTACHMENT_MAX_BYTES`, 15 MB by default). **No authentication**: the token
is the credential. It is 32 random bytes in hex, minted by the email worker. Only its HMAC is
stored, under a label that keeps it apart from signing tokens (ADR 0009). The link works for
`COMPLETION_LINK_DAYS` (30 by default) and can be used any number of times.

Returns the sealed file as `application/pdf` with `Content-Disposition: attachment`, read by
its locked storage version id (ADR 0007).

| Situation | Response |
|---|---|
| Malformed or unknown token | 404 `NOT_FOUND` |
| The link has expired | 410 `DOWNLOAD_LINK_EXPIRED` |

Every response sends `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, and
`instance` reads `/api/v1/download/[redacted]`. Limited to 30 requests a minute per IP.

## Verification

### `POST /v1/verify`

Accepts any PDF. `multipart/form-data`, field `file`. **No authentication required** — public verification is the point.

Match:

```json
{
  "verified": true,
  "envelopeId": "3f7a1b2c-...",
  "title": "Consulting Agreement — Acme Corp",
  "completedAt": "2026-09-10T14:33:02Z",
  "documentHash": "4c9e1a05...",
  "signers": [
    { "name": "Priya Sharma", "email": "priya@example.com",
      "signedAt": "2026-09-10T10:02:44Z", "ipAddress": "203.0.113.42" }
  ],
  "versionChain": [
    { "versionNumber": 0, "hash": "e3b0c442...", "signedBy": null },
    { "versionNumber": 1, "hash": "a591a6d4...", "signedBy": "Priya Sharma" }
  ]
}
```

No match:

```json
{
  "verified": false,
  "reason": "NO_MATCHING_DOCUMENT",
  "detail": "This document's fingerprint does not match any sealed document. Either it was not sealed by this platform, or it has been modified since sealing."
}
```

The `detail` wording is deliberate. The system genuinely cannot distinguish between the two cases, and claiming otherwise would be dishonest in exactly the setting where honesty matters most.

## Webhooks

### Events

| Event | Fires when |
|---|---|
| `envelope.sent` | Sent, tokens minted |
| `envelope.delivered` | Mail provider confirms delivery |
| `envelope.viewed` | A recipient opens the link |
| `recipient.consented` | Consent recorded |
| `recipient.signed` | A recipient completes their fields |
| `recipient.declined` | A recipient declines |
| `envelope.completed` | Sealed and locked |
| `envelope.voided` | Cancelled by the sender |
| `envelope.expired` | Passed `expiresAt` unsigned |

### Payload

```json
{
  "id": "evt_7f8a...",
  "type": "recipient.signed",
  "createdAt": "2026-09-10T14:32:11Z",
  "data": {
    "envelopeId": "3f7a1b2c-...",
    "recipientId": "9d4e...",
    "recipientEmail": "raj@example.com",
    "signedAt": "2026-09-10T14:32:11Z",
    "envelopeStatus": "PARTIALLY_SIGNED"
  }
}
```

### Verification

```
X-Signature-Timestamp: 1757512331
X-Signature: sha256=<hex>

signature = HMAC_SHA256(secret, "{timestamp}.{raw_body}")
```

Receivers MUST:

1. Reject if the timestamp is more than 5 minutes old — replay protection
2. Compare using a **constant-time** comparison
3. Compute over the **raw body**, before JSON parsing

### Delivery

At-least-once. Retries at 10s, 1m, 5m, 30m, 2h, 12h — 6 attempts over ~15 hours. A `2xx` within 5 seconds counts as success.

Consumers MUST be idempotent on `event.id`. Duplicates are expected, not exceptional.

Failed deliveries are retained 7 days and redrivable via `POST /v1/webhooks/:id/redrive`.

## Errors

RFC 7807:

```json
{
  "type": "https://docs.{host}/errors/invalid-coordinate-space",
  "title": "Invalid coordinate space",
  "status": 400,
  "detail": "Field at index 2 supplied pixel coordinates. Fields must use normalised ratios in [0.0, 1.0].",
  "instance": "/v1/envelopes/3f7a1b2c/fields",
  "code": "INVALID_COORDINATE_SPACE",
  "field": "fields[2].x"
}
```

| Code | Status | Meaning |
|---|---|---|
| `INVALID_COORDINATE_SPACE` | 400 | Pixel coordinates supplied |
| `RATIO_OUT_OF_RANGE` | 400 | A ratio outside `[0.0, 1.0]` |
| `FIELD_EXCEEDS_PAGE` | 400 | Position plus size overflows the page |
| `PAGE_OUT_OF_RANGE` | 400 | `pageNumber` beyond the document |
| `DOCUMENT_CATEGORY_BLOCKED` | 422 | Category not permitted in this jurisdiction |
| `RECIPIENT_HAS_NO_FIELDS` | 422 | A signer has nothing to sign |
| `NOT_READY_TO_SEND` | 422 | Any other reason a draft cannot be sent; `errors` lists every one |
| `ENVELOPE_NOT_DRAFT` | 409 | Change attempted on an envelope that has been sent |
| `RECIPIENT_EMAIL_TAKEN` | 409 | That email is already on this envelope |
| `DRAFT_REVISION_MISMATCH` | 412 | `If-Match` is behind the draft's current revision |
| `ENVELOPE_TERMINAL` | 409 | Action attempted on a completed/declined/voided envelope. On signing routes `reason` says which: `VOIDED`, `DECLINED` or `YOU_DECLINED` |
| `TOKEN_INVALID` | 401 | Unrecognised token, including one replaced by a reminder |
| `TOKEN_EXPIRED` | 401 | Past `tokenExpiresAt` or the envelope's `expiresAt` |
| `TOKEN_ALREADY_USED` | 410 | Single-use token already consumed |
| `CONSENT_REQUIRED` | 403 | Document, adopt or submit attempted before consent |
| `CONSENT_TEXT_CHANGED` | 409 | The notice changed after it was shown; show the new one |
| `INVALID_SIGNATURE_IMAGE` | 422 | Not a transparent PNG, or too large |
| `REQUIRED_FIELDS_INCOMPLETE` | 422 | Required fields unfilled |
| `REMINDER_TOO_SOON` | 429 | Reminded within 24 hours. Includes `Retry-After` |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | `Idempotency-Key` missing or malformed |
| `IDEMPOTENCY_KEY_MISMATCH` | 422 | The same key was sent with a different body |
| `FILE_TOO_LARGE` | 413 | Over 25 MB |
| `PAGE_LIMIT_EXCEEDED` | 422 | Over 500 pages |
| `ENCRYPTED_PDF` | 422 | Password-protected upload |
| `RATE_LIMITED` | 429 | Includes `Retry-After` |

`TOKEN_ALREADY_USED` returns `410 Gone` rather than `401`, so the portal can show *"you have already signed this"* rather than a misleading authentication error.

## Rate Limits

| Endpoint group | Limit |
|---|---|
| Envelope create/send | 100/min per tenant |
| Document upload | 20/min per tenant |
| Signing session reads | 60/min per token |
| Consent / submit | 10/min per token |
| Verify | 30/min per IP |
| Reminders | 1 per recipient per 24h |

Signing-session limits are per token rather than per IP, since legitimate signers may share an IP behind corporate NAT.

> **As built (Phase 3).** The signing limits apply to every signing route: 60 `GET`s and 10 of
> anything else a minute. They are counted against a hash of the token, never the token, and they
> apply even to a token that is unknown or was replaced, so guessing is limited too. Counters are
> held in memory in each API process; Phase 5 moves them to Redis.

## Deferred

- OpenAPI 3.1 specification — Sprint 2 deliverable, generated from route handlers
- SDKs (TypeScript, Python) — post-launch
- Bulk send endpoint — Sprint 3–4
- Template endpoints — Sprint 3–4
