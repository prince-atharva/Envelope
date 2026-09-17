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

### `POST /v1/envelopes/:id/fields`

Bulk placement. **Ratios only.**

```json
{
  "fields": [
    {
      "recipientId": "9d4e...",
      "type": "SIGNATURE",
      "pageNumber": 4,
      "ratioX": 0.43, "ratioY": 0.74,
      "ratioWidth": 0.25, "ratioHeight": 0.06,
      "required": true
    },
    {
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
- `recipientId` belongs to this envelope

Pixel coordinates are not accepted in any form. A request containing `x`, `y`, `width`, or `height` is rejected with `INVALID_COORDINATE_SPACE` — a deliberately loud failure, because silently accepting pixels is exactly how misplaced signatures reach production.

### `POST /v1/envelopes/:id/send`

**Requires `Idempotency-Key`.**

```json
{ "message": "Please review and sign by Friday.", "expiresInDays": 14 }
```

`200 OK`:

```json
{
  "id": "3f7a1b2c-...",
  "status": "SENT",
  "sentAt": "2026-09-10T09:20:00Z",
  "expiresAt": "2026-09-24T09:20:00Z",
  "recipients": [
    { "id": "9d4e...", "status": "SENT", "notifiedAt": "2026-09-10T09:20:01Z" }
  ]
}
```

Replaying the same `Idempotency-Key` within 24 hours returns the original response with `Idempotency-Replayed: true`. It does not resend.

Preconditions: at least one recipient; every `SIGNER` and `APPROVER` has at least one required field; at least one document; status is `DRAFT`.

### Other envelope operations

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/envelopes/:id` | Full state including recipients, fields, versions |
| `GET` | `/v1/envelopes?status=&cursor=&limit=` | List, filterable |
| `POST` | `/v1/envelopes/:id/void` | Cancel. Body: `{ "reason": "..." }`. Invalidates all tokens synchronously. |
| `POST` | `/v1/envelopes/:id/remind` | Nudge outstanding recipients. Rate-limited to 1/recipient/24h. |
| `GET` | `/v1/envelopes/:id/documents/original` | The untouched upload |
| `GET` | `/v1/envelopes/:id/documents/completed` | The sealed document. `409` if not `COMPLETED`. |
| `GET` | `/v1/envelopes/:id/documents/versions/:n` | A specific version from the chain |
| `GET` | `/v1/envelopes/:id/audit` | Full audit trail |

## Signing Session

Unauthenticated, token-gated. Consumed by the signer portal.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/sign/:token` | Fetch session: document URL, this recipient's fields, consent requirement |
| `POST` | `/v1/sign/:token/consent` | Record consent. Body: `{ "agreed": true }` |
| `POST` | `/v1/sign/:token/submit` | Submit field values and finish |
| `POST` | `/v1/sign/:token/decline` | Decline. Body: `{ "reason": "..." }` — required |

`GET /v1/sign/:token` → `200 OK`:

```json
{
  "envelopeTitle": "Consulting Agreement — Acme Corp",
  "recipientName": "Raj Patel",
  "documentUrl": "https://.../signed-url?expires=...",
  "pageCount": 12,
  "consentRequired": true,
  "consentText": "By checking this box, you agree to sign electronically...",
  "fields": [
    { "id": "a1b2...", "type": "SIGNATURE", "pageNumber": 4,
      "ratioX": 0.43, "ratioY": 0.74, "ratioWidth": 0.25, "ratioHeight": 0.06,
      "required": true, "isCompleted": false }
  ],
  "expiresAt": "2026-09-24T09:20:00Z"
}
```

Only **this recipient's** fields are returned. Other recipients' fields are never exposed — that would leak who else is signing and where.

`POST /v1/sign/:token/submit`:

```json
{
  "fields": [
    { "id": "a1b2...", "value": "data:image/png;base64,iVBORw0KG..." },
    { "id": "c3d4...", "value": "true" }
  ]
}
```

`202 Accepted`:

```json
{
  "status": "SIGNED",
  "signedAt": "2026-09-10T14:32:11Z",
  "message": "Your signature has been recorded. The completed document will be emailed shortly."
}
```

`202`, not `200`: sealing is asynchronous. The signer gets immediate confirmation; the document is assembled on a worker.

On submit the token is invalidated. `DATE_SIGNED` fields are **server-generated** and any client-supplied value is discarded.

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
| `ENVELOPE_NOT_DRAFT` | 409 | Mutation attempted on a sent envelope |
| `ENVELOPE_TERMINAL` | 409 | Action attempted on a completed/declined/voided envelope |
| `TOKEN_INVALID` | 401 | Unrecognised token |
| `TOKEN_EXPIRED` | 401 | Past `tokenExpiresAt` |
| `TOKEN_ALREADY_USED` | 410 | Single-use token already consumed |
| `CONSENT_REQUIRED` | 403 | Submit attempted before consent |
| `REQUIRED_FIELDS_INCOMPLETE` | 422 | Required fields unfilled |
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

## Deferred

- OpenAPI 3.1 specification — Sprint 2 deliverable, generated from route handlers
- SDKs (TypeScript, Python) — post-launch
- Bulk send endpoint — Sprint 3–4
- Template endpoints — Sprint 3–4
