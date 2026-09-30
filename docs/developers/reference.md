# API Reference

| | |
|---|---|
| **Status** | Current |
| **Version** | 1.0.0 |
| **Last updated** | 30 September 2026 |
| **Audience** | Developers connecting an application to Envelope |
| **What this doc answers** | What does each operation an API key can call accept and return? |

## In Plain Terms

This page lists every request your server can make, with a copyable example and the answer you should
expect. It is produced from the same catalog the code is tested against, so it cannot drift from what
the API really does.

## Technical Detail

Paths are relative to `https://YOUR-ENVELOPE-HOST/api/v1`. Every request needs your API key. The
examples read `ENVELOPE_URL`, `ENVELOPE_API_KEY`, ids such as `ENVELOPE_ID` and `RECIPIENT_ID` from shell variables, and
carry ids between calls with `jq`: see the [quick start](quick-start.md). `DRAFT_REVISION` is the
latest `draftRevision`.

The machine-readable form of this reference is [openapi.json](openapi.json).

### Summary

<!-- generated:operations-table -->
| Operation | Method and path | Key access | Idempotency-Key | Rate limit |
|---|---|---|---|---|
| Upload a PDF | `POST /envelopes` | Full key | Optional | 100/min per workspace |
| List documents | `GET /envelopes` | Read-only key or full key | — | — |
| Count documents | `GET /envelopes/counts` | Read-only key or full key | — | — |
| Read a document | `GET /envelopes/:id` | Read-only key or full key | — | — |
| Read audit events | `GET /envelopes/:id/events` | Read-only key or full key | — | — |
| Download a PDF | `GET /envelopes/:id/file` | Read-only key or full key | — | — |
| Download the original PDF | `GET /envelopes/:id/documents/original` | Read-only key or full key | — | — |
| Download the completed PDF | `GET /envelopes/:id/documents/completed` | Read-only key or full key | — | — |
| Download the certificate pages | `GET /envelopes/:id/documents/certificate` | Read-only key or full key | — | 30/min per workspace |
| Update a draft | `PATCH /envelopes/:id` | Full key | — | — |
| Add a recipient | `POST /envelopes/:id/recipients` | Full key | — | — |
| Update a recipient | `PATCH /envelopes/:id/recipients/:recipientId` | Full key | — | — |
| Remove a recipient | `DELETE /envelopes/:id/recipients/:recipientId` | Full key | — | — |
| Place signing fields | `PUT /envelopes/:id/fields` | Full key | — | — |
| Send for signing | `POST /envelopes/:id/send` | Full key | Required | 100/min per workspace |
| Cancel or discard | `POST /envelopes/:id/void` | Full key | — | 30/min per workspace |
| Send a reminder | `POST /envelopes/:id/remind` | Full key | — | 30/min per workspace |
| Save an envelope as a template | `POST /templates` | Full key | — | 30/min per workspace |
| List templates | `GET /templates` | Read-only key or full key | — | — |
| Read a template | `GET /templates/:id` | Read-only key or full key | — | — |
| Create an envelope from a template | `POST /templates/:id/envelopes` | Full key | Optional | 100/min per workspace |
| Rename, archive or restore a template | `PATCH /templates/:id` | Full key | — | 30/min per workspace |
| Issue an embedded editor session | `POST /embed/sessions` | Full key | Optional | 30/min per workspace and API key |
| Revoke an embedded editor session | `DELETE /embed/sessions/:id` | Full key | — | 30/min per workspace and API key |
<!-- /generated:operations-table -->

### Operations

<!-- generated:operation-details -->
### Upload a PDF

`POST /envelopes` · Full key · Idempotency-Key: Optional · Rate limit: 100/min per workspace

Create a draft from one PDF. Save the returned id and draftRevision for the next steps.

- Multipart file (required): PDF, up to 25 MiB and 500 pages; encrypted PDFs are rejected.
- title (optional): 1–200 characters; defaults to the filename without its extension.
- documentCategory (optional): defaults to OTHER. jurisdictionCode (optional): overrides the workspace default. Policy is fixed at creation.
- externalId (optional): your own id for this document, 1–200 characters of letters, digits and _ . : @ -. Not unique. Echoed in every webhook and used to filter the list.
- metadata (optional): a JSON object as text, up to 10 string values and 2 KB in total. Echoed in every webhook.
- Idempotency-Key (optional): 8–128 letters, digits, dots, dashes or colons. Repeating the same key and body within 24 hours returns the envelope the first request created (Idempotency-Replayed: true) instead of a second draft. Without a key, every request creates a new draft.

```bash
curl --request POST "$ENVELOPE_URL/api/v1/envelopes" \
  --header "Authorization: Bearer $ENVELOPE_API_KEY" \
  --form 'file=@agreement.pdf' \
  --form 'title=Consulting agreement' \
  --form 'documentCategory=OTHER' \
  --form 'externalId=visit:1001' \
  --form 'metadata={"department":"billing"}'
```

201 · Envelope detail (excerpt). This uploads and creates together; there is no separate upload endpoint.

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "title": "Consulting agreement",
  "status": "DRAFT",
  "draftRevision": 0,
  "pageCount": 1,
  "recipients": [],
  "fields": [],
  "versions": [
    {
      "versionNumber": 0,
      "isFinal": false
    }
  ]
}
```

Errors: `FILE_REQUIRED`, `FILE_TOO_LARGE`, `UNSUPPORTED_FILE_TYPE`, `DOCUMENT_CATEGORY_BLOCKED`, `INVALID_PDF`, `ENCRYPTED_PDF`, `PAGE_LIMIT_EXCEEDED`, `MALWARE_DETECTED`, `IDEMPOTENCY_KEY_MISMATCH`. Uploads are scanned and validated before use. Reusing an Idempotency-Key with a different body answers IDEMPOTENCY_KEY_MISMATCH.

### List documents

`GET /envelopes` · Read-only key or full key · Idempotency-Key: — · Rate limit: —

Browse documents across the workspace, including documents created by people.

- view: all (default), attention, waiting, completed, cancelled or drafts.
- status: optional envelope status. limit: 1–100 (default 20). cursor: nextCursor from the previous response.
- Pass the returned cursor unchanged and URL-encode it. Continue until nextCursor is null.
- externalId: only documents created with exactly this id. Recover a document whose creation response you lost.

```bash
curl --request GET "$ENVELOPE_URL/api/v1/envelopes?view=drafts&limit=20" \
  --header "Authorization: Bearer $ENVELOPE_API_KEY"
```

200 · Paginated envelope summaries. An empty workspace returns this example.

```json
{
  "items": [],
  "nextCursor": null
}
```

Errors: `VALIDATION_FAILED`. Invalid query parameters are refused.

### Count documents

`GET /envelopes/counts` · Read-only key or full key · Idempotency-Key: — · Rate limit: —

Get a count for each dashboard view.

- No request body or query parameters.

```bash
curl --request GET "$ENVELOPE_URL/api/v1/envelopes/counts" \
  --header "Authorization: Bearer $ENVELOPE_API_KEY"
```

200 · Counts by view; views may overlap.

```json
{
  "all": 0,
  "attention": 0,
  "waiting": 0,
  "completed": 0,
  "cancelled": 0,
  "drafts": 0
}
```

Errors: —. Authentication and access errors apply to every operation.

### Read a document

`GET /envelopes/:id` · Read-only key or full key · Idempotency-Key: — · Rate limit: —

Get status, recipients, fields, versions, policy, draftRevision and the first part of the audit trail.

- id: the envelope UUID returned by upload.
- Optional If-None-Match: a previously returned ETag. An unchanged document returns 304 with no body.
- Use eventsCursor for remaining audit events. For the completed PDF, find versions[].isFinal and use its versionNumber.

```bash
curl --request GET "$ENVELOPE_URL/api/v1/envelopes/$ENVELOPE_ID" \
  --header "Authorization: Bearer $ENVELOPE_API_KEY"
```

200 · Envelope detail (excerpt); 304 when unchanged.

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "title": "Consulting agreement",
  "status": "DRAFT",
  "draftRevision": 0,
  "pageCount": 1,
  "recipients": [],
  "fields": [],
  "versions": [
    {
      "versionNumber": 0,
      "isFinal": false
    }
  ]
}
```

Errors: `NOT_FOUND`. A document that is not in this workspace is NOT_FOUND, never forbidden.

### Read audit events

`GET /envelopes/:id/events` · Read-only key or full key · Idempotency-Key: — · Rate limit: —

Page through the audit trail, oldest first. These are audit records, not webhook deliveries.

- id: envelope UUID. limit: 1–100 (default 20). cursor: eventsCursor or the previous nextCursor.

```bash
curl --request GET "$ENVELOPE_URL/api/v1/envelopes/$ENVELOPE_ID/events?limit=20" \
  --header "Authorization: Bearer $ENVELOPE_API_KEY"
```

200 · Audit records and continuation cursor.

```json
{
  "items": [
    {
      "sequence": 1,
      "action": "ENVELOPE_CREATED",
      "timestamp": "2026-09-27T10:00:00.000Z",
      "actorUserId": "44444444-4444-4444-8444-444444444444",
      "recipientId": null,
      "eventHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  ],
  "nextCursor": null
}
```

Errors: `NOT_FOUND`. Invalid query parameters are refused.

### Download a PDF

`GET /envelopes/:id/file` · Read-only key or full key · Idempotency-Key: — · Rate limit: —

Read the original, an intermediate signed version or the final sealed document.

- version: non-negative integer; defaults to 0 (the original).
- For the sealed PDF, use finalVersionNumber from envelope.completed, or the version marked isFinal in document detail.
- Optional If-None-Match: the file ETag; unchanged files return 304 without bytes.

```bash
curl --request GET "$ENVELOPE_URL/api/v1/envelopes/$ENVELOPE_ID/file?version=0" \
  --header "Authorization: Bearer $ENVELOPE_API_KEY" \
  --output 'document.pdf'
```

200 · Binary PDF, not JSON. Version 0 does not include signatures.

```text
HTTP 200
Content-Type: application/pdf

<PDF bytes saved to document.pdf>
```

Errors: `NOT_FOUND`, `ENVELOPE_PURGED`. ENVELOPE_PURGED once retention has removed the file.

### Download the original PDF

`GET /envelopes/:id/documents/original` · Read-only key or full key · Idempotency-Key: — · Rate limit: —

The PDF exactly as it was uploaded, with no signatures. Same bytes as version 0.

- Optional If-None-Match: the ETag from an earlier response; unchanged files return 304.

```bash
curl --request GET "$ENVELOPE_URL/api/v1/envelopes/$ENVELOPE_ID/documents/original" \
  --header "Authorization: Bearer $ENVELOPE_API_KEY" \
  --output 'original.pdf'
```

200 · Binary PDF, not JSON.

```text
HTTP 200
Content-Type: application/pdf

<PDF bytes saved to original.pdf>
```

Errors: `NOT_FOUND`, `ENVELOPE_PURGED`. ENVELOPE_PURGED once retention has removed the file.

### Download the completed PDF

`GET /envelopes/:id/documents/completed` · Read-only key or full key · Idempotency-Key: — · Rate limit: —

The sealed document with every signature and the certificate pages, without needing its version number.

- Available once the envelope is completed (after envelope.completed). Before that the request returns 409.
- Optional If-None-Match: the ETag from an earlier response; the sealed file never changes, so 304 is safe to rely on.

```bash
curl --request GET "$ENVELOPE_URL/api/v1/envelopes/$ENVELOPE_ID/documents/completed" \
  --header "Authorization: Bearer $ENVELOPE_API_KEY" \
  --output 'completed.pdf'
```

200 · Binary PDF, not JSON. The SHA-256 of these bytes is the envelope’s finalHash.

```text
HTTP 200
Content-Type: application/pdf

<PDF bytes saved to completed.pdf>
```

Errors: `CONFLICT`, `NOT_FOUND`, `ENVELOPE_PURGED`. CONFLICT until the envelope is completed.

### Download the certificate pages

`GET /envelopes/:id/documents/certificate` · Read-only key or full key · Idempotency-Key: — · Rate limit: 30/min per workspace

Only the certificate of completion, cut from the sealed PDF when you ask. Nothing extra is stored.

- Available once the envelope is completed; before that the request returns 409.
- Limited to 30 requests a minute per workspace. Keep the file rather than asking again; an unchanged one answers If-None-Match with 304.

```bash
curl --request GET "$ENVELOPE_URL/api/v1/envelopes/$ENVELOPE_ID/documents/certificate" \
  --header "Authorization: Bearer $ENVELOPE_API_KEY" \
  --output 'certificate.pdf'
```

200 · Binary PDF, not JSON. Its pages are the certificate pages of the completed file.

```text
HTTP 200
Content-Type: application/pdf

<PDF bytes saved to certificate.pdf>
```

Errors: `CONFLICT`, `RATE_LIMITED`, `NOT_FOUND`, `ENVELOPE_PURGED`. CONFLICT until the envelope is completed. After 30 requests a minute the request is RATE_LIMITED.

### Update a draft

`PATCH /envelopes/:id` · Full key · Idempotency-Key: — · Rate limit: —

Change draft settings before sending. Save draftRevision from each successful edit.

- At least one of: title (1–200 characters), message (up to 2,000 characters; null clears it), sequentialSigning (boolean).
- With sequentialSigning true, equal routingOrder values sign together; lower groups go first.
- externalId (string or null) and metadata (object or null) replace your reference while the document is a draft; they are fixed once it is sent.

```bash
curl --request PATCH "$ENVELOPE_URL/api/v1/envelopes/$ENVELOPE_ID" \
  --header "Authorization: Bearer $ENVELOPE_API_KEY" \
  --header "If-Match: \"$DRAFT_REVISION\"" \
  --header 'Content-Type: application/json' \
  --data '{
  "title": "Consulting agreement",
  "sequentialSigning": true
}'
```

200 · New draft revision.

```json
{
  "draftRevision": 1
}
```

Errors: `ENVELOPE_NOT_DRAFT`, `DRAFT_REVISION_MISMATCH`. A stale If-Match answers 412 DRAFT_REVISION_MISMATCH.

### Add a recipient

`POST /envelopes/:id/recipients` · Full key · Idempotency-Key: — · Rate limit: —

Add someone to the draft; retain recipient.id to assign their fields.

- name (required): 1–200 characters. email (required): valid email address.
- role: SIGNER (default), APPROVER, VIEWER or CC. routingOrder: optional integer 1–50, defaults to the end.
- Up to 50 recipients. SIGNER needs a required field; APPROVER may approve without fields.

```bash
curl --request POST "$ENVELOPE_URL/api/v1/envelopes/$ENVELOPE_ID/recipients" \
  --header "Authorization: Bearer $ENVELOPE_API_KEY" \
  --header "If-Match: \"$DRAFT_REVISION\"" \
  --header 'Content-Type: application/json' \
  --data '{
  "name": "Alex Morgan",
  "email": "alex@example.com",
  "role": "SIGNER",
  "routingOrder": 1
}'
```

201 · Recipient and new revision.

```json
{
  "recipient": {
    "id": "22222222-2222-4222-8222-222222222222",
    "name": "Alex Morgan",
    "email": "alex@example.com",
    "role": "SIGNER",
    "routingOrder": 1,
    "status": "PENDING",
    "colorIndex": 0
  },
  "draftRevision": 1
}
```

Errors: `RECIPIENT_EMAIL_TAKEN`, `ENVELOPE_NOT_DRAFT`, `DRAFT_REVISION_MISMATCH`. A stale If-Match answers 412 DRAFT_REVISION_MISMATCH.

### Update a recipient

`PATCH /envelopes/:id/recipients/:recipientId` · Full key · Idempotency-Key: — · Rate limit: —

Change a draft recipient. Switching to VIEWER or CC removes fields assigned to them.

- id and recipientId: returned UUIDs. Supply at least one of name, email, role or routingOrder, with the same limits as adding a recipient.

```bash
curl --request PATCH "$ENVELOPE_URL/api/v1/envelopes/$ENVELOPE_ID/recipients/$RECIPIENT_ID" \
  --header "Authorization: Bearer $ENVELOPE_API_KEY" \
  --header "If-Match: \"$DRAFT_REVISION\"" \
  --header 'Content-Type: application/json' \
  --data '{
  "name": "Alex Taylor"
}'
```

200 · Recipient and new revision; fieldsRemoved may also be returned.

```json
{
  "recipient": {
    "id": "22222222-2222-4222-8222-222222222222",
    "name": "Alex Taylor",
    "email": "alex@example.com",
    "role": "SIGNER",
    "routingOrder": 1,
    "status": "PENDING",
    "colorIndex": 0
  },
  "draftRevision": 2
}
```

Errors: `NOT_FOUND`, `RECIPIENT_EMAIL_TAKEN`, `ENVELOPE_NOT_DRAFT`, `DRAFT_REVISION_MISMATCH`. A stale If-Match answers 412 DRAFT_REVISION_MISMATCH.

### Remove a recipient

`DELETE /envelopes/:id/recipients/:recipientId` · Full key · Idempotency-Key: — · Rate limit: —

Remove a draft recipient and all of their fields.

- id and recipientId: returned UUIDs. No request body.

```bash
curl --request DELETE "$ENVELOPE_URL/api/v1/envelopes/$ENVELOPE_ID/recipients/$RECIPIENT_ID" \
  --header "Authorization: Bearer $ENVELOPE_API_KEY" \
  --header "If-Match: \"$DRAFT_REVISION\""
```

200 · New revision; the response is JSON, not an empty 204.

```json
{
  "draftRevision": 2
}
```

Errors: `NOT_FOUND`, `ENVELOPE_NOT_DRAFT`, `DRAFT_REVISION_MISMATCH`. A stale If-Match answers 412 DRAFT_REVISION_MISMATCH.

### Place signing fields

`PUT /envelopes/:id/fields` · Full key · Idempotency-Key: — · Rate limit: —

Replace the entire layout. Include every field you want to keep.

- fields: up to 1,000 entries. Each needs a new client-generated UUID id, recipientId, type and pageNumber (starting at 1). Keep the same field id on later saves.
- type: SIGNATURE, INITIALS, DATE_SIGNED, TEXT_INPUT or CHECKBOX. required defaults to true.
- ratioX, ratioY, ratioWidth, ratioHeight: page-relative fractions, not pixels. Origin is top-left. Width and height must be positive and the box must fit inside the page.
- Only SIGNER and APPROVER recipients can own fields. Replace the example recipientId with the id returned when adding the recipient.

```bash
curl --request PUT "$ENVELOPE_URL/api/v1/envelopes/$ENVELOPE_ID/fields" \
  --header "Authorization: Bearer $ENVELOPE_API_KEY" \
  --header "If-Match: \"$DRAFT_REVISION\"" \
  --header 'Content-Type: application/json' \
  --data '{
  "fields": [
    {
      "id": "'"$(uuidgen)"'",
      "recipientId": "'"$RECIPIENT_ID"'",
      "type": "SIGNATURE",
      "pageNumber": 1,
      "ratioX": 0.1,
      "ratioY": 0.7,
      "ratioWidth": 0.3,
      "ratioHeight": 0.08,
      "required": true
    }
  ]
}'
```

200 · Saved fields and new revision.

```json
{
  "fields": [
    {
      "id": "33333333-3333-4333-8333-333333333333",
      "recipientId": "22222222-2222-4222-8222-222222222222",
      "type": "SIGNATURE",
      "pageNumber": 1,
      "ratioX": 0.1,
      "ratioY": 0.7,
      "ratioWidth": 0.3,
      "ratioHeight": 0.08,
      "required": true
    }
  ],
  "draftRevision": 2
}
```

Errors: `INVALID_COORDINATE_SPACE`, `RATIO_OUT_OF_RANGE`, `FIELD_EXCEEDS_PAGE`, `PAGE_OUT_OF_RANGE`, `DRAFT_REVISION_MISMATCH`. Pixel coordinates are refused with INVALID_COORDINATE_SPACE. A stale If-Match answers 412 DRAFT_REVISION_MISMATCH.

### Send for signing

`POST /envelopes/:id/send` · Full key · Idempotency-Key: Required · Rate limit: 100/min per workspace

Validate the draft and queue invitations. Signing happens on Envelope through emailed links.

- Optional JSON: expiresInDays (1–90), message (up to 2,000 characters or null), reminderIntervalDays (1–30 or null to disable). Omitted timing values use server defaults.
- Idempotency-Key (required): 8–128 letters, digits, dots, dashes or colons; a UUID is ideal. Reuse the same key and body on a network retry within 24 hours. A replay includes Idempotency-Replayed: true.
- Sending is asynchronous: a successful response does not mean mail has arrived or signing is complete. Wait for envelope.completed before downloading the sealed version.

```bash
curl --request POST "$ENVELOPE_URL/api/v1/envelopes/$ENVELOPE_ID/send" \
  --header "Authorization: Bearer $ENVELOPE_API_KEY" \
  --header "Idempotency-Key: $SEND_IDEMPOTENCY_KEY" \
  --header 'Content-Type: application/json' \
  --data '{
  "expiresInDays": 14,
  "reminderIntervalDays": 3
}'
```

200 · Sent envelope and recipients invited now. No signing tokens are returned.

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "status": "SENT",
  "sentAt": "2026-09-27T10:00:00.000Z",
  "expiresAt": "2026-10-11T10:00:00.000Z",
  "invited": [
    {
      "id": "22222222-2222-4222-8222-222222222222",
      "status": "SENT"
    }
  ]
}
```

Errors: `NOT_READY_TO_SEND`, `ENVELOPE_NOT_DRAFT`, `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_MISMATCH`, `NOT_FOUND`. NOT_READY_TO_SEND lists every readiness problem in `errors`. Retry after a network failure with the same Idempotency-Key and body.

### Cancel or discard

`POST /envelopes/:id/void` · Full key · Idempotency-Key: — · Rate limit: 30/min per workspace

Cancel a sent envelope so its links stop working and the people emailed are told why, or discard a draft.

- JSON reason (1–1,000 characters): required for a sent envelope, optional for a draft. It is emailed to recipients and is not stored in the audit trail.
- A full-access key only. Fires envelope.voided. Limited to 30 requests a minute per workspace, shared with reminders and deadline changes.

```bash
curl --request POST "$ENVELOPE_URL/api/v1/envelopes/$ENVELOPE_ID/void" \
  --header "Authorization: Bearer $ENVELOPE_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{
  "reason": "Sent to the wrong patient"
}'
```

200 · discarded is true when a draft was thrown away and nobody was emailed.

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "status": "VOIDED",
  "voidedAt": "2026-09-27T10:00:00.000Z",
  "discarded": false
}
```

Errors: `ENVELOPE_TERMINAL`, `ENVELOPE_ON_LEGAL_HOLD`, `VALIDATION_FAILED`, `NOT_FOUND`. ENVELOPE_TERMINAL when the envelope is already completed, declined or cancelled.

### Send a reminder

`POST /envelopes/:id/remind` · Full key · Idempotency-Key: — · Rate limit: 30/min per workspace

Email a fresh signing link to the people whose turn it is and who have not finished. The previous link stops working.

- Optional JSON: recipientIds, a list of recipient UUIDs. Omitted, it reminds everyone whose turn it is.
- One reminder per person per 24 hours: anyone reminded sooner comes back in skipped with a reason, and if nobody could be reminded the request answers 429 REMINDER_TOO_SOON with Retry-After. A full-access key only; shares the 30 a minute workspace limit with cancel.

```bash
curl --request POST "$ENVELOPE_URL/api/v1/envelopes/$ENVELOPE_ID/remind" \
  --header "Authorization: Bearer $ENVELOPE_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{}'
```

200 · Recipients reminded now, and those skipped with the reason for each.

```json
{
  "reminded": [
    "22222222-2222-4222-8222-222222222222"
  ],
  "skipped": [
    {
      "recipientId": "77777777-7777-4777-8777-777777777777",
      "reason": "TOO_SOON"
    }
  ]
}
```

Errors: `CONFLICT`, `ENVELOPE_TERMINAL`, `ENVELOPE_EXPIRED`, `REMINDER_TOO_SOON`, `RATE_LIMITED`, `NOT_FOUND`. REMINDER_TOO_SOON (429, with Retry-After) when everyone due was already reminded in the last 24 hours.

### Save an envelope as a template

`POST /templates` · Full key · Idempotency-Key: — · Rate limit: 30/min per workspace

Turn a prepared envelope into a reusable template: its PDF, its people as named roles, and where they sign. The template keeps its own copy of the PDF.

- envelopeId (required): an envelope in your workspace with at least one person and every signer given a required field. It may be a draft or already sent.
- name (required): 1–120 characters, different from every other active template.
- description (optional): up to 1,000 characters.
- roleNames (optional): an object from recipient id to the role’s name, such as "Patient". A role is named after the person on the envelope unless listed here. Names must differ.

```bash
curl --request POST "$ENVELOPE_URL/api/v1/templates" \
  --header "Authorization: Bearer $ENVELOPE_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{
  "envelopeId": "'"$ENVELOPE_ID"'",
  "name": "Intake consent",
  "roleNames": {
    "'"$RECIPIENT_ID"'": "Patient"
  }
}'
```

201 · The template, with its roles and fields.

```json
{
  "id": "44444444-4444-4444-8444-444444444444",
  "name": "Intake consent",
  "description": null,
  "pageCount": 2,
  "documentCategory": "OTHER",
  "roleCount": 1,
  "fieldCount": 1,
  "archivedAt": null,
  "createdAt": "2026-09-27T10:00:00.000Z",
  "createdByName": "Jordan Lee",
  "defaultMessage": null,
  "sequentialSigning": false,
  "reminderIntervalDays": null,
  "roles": [
    {
      "id": "55555555-5555-4555-8555-555555555555",
      "name": "Patient",
      "role": "SIGNER",
      "routingOrder": 1,
      "colorIndex": 0
    }
  ],
  "fields": [
    {
      "id": "66666666-6666-4666-8666-666666666666",
      "templateRoleId": "55555555-5555-4555-8555-555555555555",
      "type": "SIGNATURE",
      "pageNumber": 1,
      "ratioX": 0.1,
      "ratioY": 0.7,
      "ratioWidth": 0.3,
      "ratioHeight": 0.08,
      "required": true
    }
  ]
}
```

Errors: `NOT_FOUND`, `NOT_READY_TO_SEND`, `TEMPLATE_NAME_TAKEN`, `ENVELOPE_PURGED`. NOT_READY_TO_SEND lists what the envelope still needs, exactly as the send operation does. Only a full-access key, never a read-only one, can save templates.

### List templates

`GET /templates` · Read-only key or full key · Idempotency-Key: — · Rate limit: —

Active templates, newest first. Use an id from here to create envelopes from it.

- archived (optional query): true lists archived templates instead. Defaults to false.

```bash
curl --request GET "$ENVELOPE_URL/api/v1/templatesarchived=false" \
  --header "Authorization: Bearer $ENVELOPE_API_KEY"
```

200 · Template summaries, at most 500.

```json
{
  "templates": [
    {
      "id": "44444444-4444-4444-8444-444444444444",
      "name": "Intake consent",
      "description": null,
      "pageCount": 2,
      "documentCategory": "OTHER",
      "roleCount": 1,
      "fieldCount": 1,
      "archivedAt": null,
      "createdAt": "2026-09-27T10:00:00.000Z",
      "createdByName": "Jordan Lee"
    }
  ]
}
```

Errors: —. No operation-specific errors.

### Read a template

`GET /templates/:id` · Read-only key or full key · Idempotency-Key: — · Rate limit: —

One template with its roles and fields. An archived template can still be read, but cannot start new envelopes.

- id (path): the template id.

```bash
curl --request GET "$ENVELOPE_URL/api/v1/templates/$ENVELOPE_ID" \
  --header "Authorization: Bearer $ENVELOPE_API_KEY"
```

200 · The template with its roles and fields.

```json
{
  "id": "44444444-4444-4444-8444-444444444444",
  "name": "Intake consent",
  "description": null,
  "pageCount": 2,
  "documentCategory": "OTHER",
  "roleCount": 1,
  "fieldCount": 1,
  "archivedAt": null,
  "createdAt": "2026-09-27T10:00:00.000Z",
  "createdByName": "Jordan Lee",
  "defaultMessage": null,
  "sequentialSigning": false,
  "reminderIntervalDays": null,
  "roles": [
    {
      "id": "55555555-5555-4555-8555-555555555555",
      "name": "Patient",
      "role": "SIGNER",
      "routingOrder": 1,
      "colorIndex": 0
    }
  ],
  "fields": [
    {
      "id": "66666666-6666-4666-8666-666666666666",
      "templateRoleId": "55555555-5555-4555-8555-555555555555",
      "type": "SIGNATURE",
      "pageNumber": 1,
      "ratioX": 0.1,
      "ratioY": 0.7,
      "ratioWidth": 0.3,
      "ratioHeight": 0.08,
      "required": true
    }
  ]
}
```

Errors: `TEMPLATE_NOT_FOUND`. TEMPLATE_NOT_FOUND when the id is not in your workspace.

### Create an envelope from a template

`POST /templates/:id/envelopes` · Full key · Idempotency-Key: Optional · Rate limit: 100/min per workspace

Give each role of the template a name and an email, and get a draft (or a sent envelope) with the people, fields and signing order already in place. It is an ordinary envelope from then on.

- recipients (required): one entry per role of the template, each `{ role, name, email }`, where `role` is the template role’s name (for example "Patient"). No role may be missing or repeated, and no email may be used twice.
- send (optional): true sends it at once, false (the default) leaves a draft you can still edit.
- message (optional): the note in the invitation; defaults to the template’s. title (optional): defaults to the template’s name.
- externalId and metadata (optional): as on upload.
- Idempotency-Key (optional): as on upload. Repeating the same key and body within 24 hours returns the envelope the first request created (Idempotency-Replayed: true).

```bash
curl --request POST "$ENVELOPE_URL/api/v1/templates/$ENVELOPE_ID/envelopes" \
  --header "Authorization: Bearer $ENVELOPE_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{
  "recipients": [
    {
      "role": "Patient",
      "name": "Alex Morgan",
      "email": "alex@example.com"
    }
  ],
  "send": false
}'
```

201 · Envelope detail (excerpt). Policy is frozen when this call runs, not when the template was saved.

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "title": "Consulting agreement",
  "status": "DRAFT",
  "draftRevision": 0,
  "pageCount": 1,
  "recipients": [],
  "fields": [],
  "versions": [
    {
      "versionNumber": 0,
      "isFinal": false
    }
  ]
}
```

Errors: `TEMPLATE_NOT_FOUND`, `TEMPLATE_ARCHIVED`, `TEMPLATE_ROLE_MISMATCH`, `DOCUMENT_CATEGORY_BLOCKED`, `IDEMPOTENCY_KEY_MISMATCH`. TEMPLATE_ROLE_MISMATCH lists each problem in `errors`. DOCUMENT_CATEGORY_BLOCKED when the workspace’s policy no longer allows the template’s category.

### Rename, archive or restore a template

`PATCH /templates/:id` · Full key · Idempotency-Key: — · Rate limit: 30/min per workspace

Change a template’s name, description, default message or whether it is archived. The layout cannot be edited: save a new template instead.

- name (optional): 1–120 characters, different from every other active template.
- description and defaultMessage (optional): text, or null to clear.
- archived (optional): true hides the template from new use, false restores it.
- Send at least one of these.

```bash
curl --request PATCH "$ENVELOPE_URL/api/v1/templates/$ENVELOPE_ID" \
  --header "Authorization: Bearer $ENVELOPE_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{
  "archived": true
}'
```

200 · The updated template.

```json
{
  "id": "44444444-4444-4444-8444-444444444444",
  "name": "Intake consent",
  "description": null,
  "pageCount": 2,
  "documentCategory": "OTHER",
  "roleCount": 1,
  "fieldCount": 1,
  "archivedAt": "2026-09-27T10:00:00.000Z",
  "createdAt": "2026-09-27T10:00:00.000Z",
  "createdByName": "Jordan Lee",
  "defaultMessage": null,
  "sequentialSigning": false,
  "reminderIntervalDays": null,
  "roles": [
    {
      "id": "55555555-5555-4555-8555-555555555555",
      "name": "Patient",
      "role": "SIGNER",
      "routingOrder": 1,
      "colorIndex": 0
    }
  ],
  "fields": [
    {
      "id": "66666666-6666-4666-8666-666666666666",
      "templateRoleId": "55555555-5555-4555-8555-555555555555",
      "type": "SIGNATURE",
      "pageNumber": 1,
      "ratioX": 0.1,
      "ratioY": 0.7,
      "ratioWidth": 0.3,
      "ratioHeight": 0.08,
      "required": true
    }
  ]
}
```

Errors: `TEMPLATE_NOT_FOUND`, `TEMPLATE_NAME_TAKEN`. TEMPLATE_NAME_TAKEN when a rename or restore would duplicate an active name.

### Issue an embedded editor session

`POST /embed/sessions` · Full key · Idempotency-Key: Optional · Rate limit: 30/min per workspace and API key

Authorize one staff member to prepare one document (or upload one) inside the embedded editor. Call it from your backend after authorizing your own user and record.

- mode (required): existing (reopen a draft you uploaded) or upload (staff upload inside the editor).
- envelopeId: required for existing, forbidden for upload.
- parentOrigin (required): the exact HTTPS origin of the page that will host the iframe. It must be registered on this API key first; loopback HTTP is accepted for local testing only.
- externalActorId (required): your own opaque id for the staff member, 1–200 characters. Recorded in the audit trail.
- actions (required): [edit] or [edit, send]. Editing is always required.
- externalId and metadata (upload mode only, optional): recorded on the draft the upload creates and echoed in every webhook.
- Idempotency-Key (optional): a retry after a lost response returns a fresh launchToken for the same session, and the earlier token stops working.

```bash
curl --request POST "$ENVELOPE_URL/api/v1/embed/sessions" \
  --header "Authorization: Bearer $ENVELOPE_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{
  "mode": "existing",
  "envelopeId": "'"$ENVELOPE_ID"'",
  "parentOrigin": "https://app.example.com",
  "externalActorId": "staff:123",
  "actions": [
    "edit",
    "send"
  ]
}'
```

201 · The launch token is valid for 60 seconds and redeemable once; keep it in memory. Send it to your browser with Cache-Control: no-store and never log it.

```json
{
  "sessionId": "66666666-6666-4666-8666-666666666666",
  "launchToken": "eel_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "launchExpiresAt": "2026-09-27T10:00:00.000Z",
  "frameUrl": "https://envelope.example/api/v1/embed/frame/66666666-6666-4666-8666-666666666666"
}
```

Errors: `EMBED_ORIGIN_NOT_ALLOWED`, `API_KEY_READ_ONLY`, `NOT_FOUND`, `ENVELOPE_NOT_DRAFT`, `VALIDATION_FAILED`, `RATE_LIMITED`, `IDEMPOTENCY_KEY_MISMATCH`. EMBED_ORIGIN_NOT_ALLOWED when parentOrigin is not registered on this key; ENVELOPE_NOT_DRAFT when reopening a document that was already sent.

### Revoke an embedded editor session

`DELETE /embed/sessions/:id` · Full key · Idempotency-Key: — · Rate limit: 30/min per workspace and API key

End a session immediately, for example when your staff member signs out. Only the API key that issued the session can revoke it.

- id: the sessionId returned when the session was issued. No request body.

```bash
curl --request DELETE "$ENVELOPE_URL/api/v1/embed/sessions/$SESSION_ID" \
  --header "Authorization: Bearer $ENVELOPE_API_KEY"
```

204 · No body.

```text
HTTP 204 No Content
```

Errors: `NOT_FOUND`, `API_KEY_READ_ONLY`, `RATE_LIMITED`. NOT_FOUND if the session belongs to another key or workspace.
<!-- /generated:operation-details -->
