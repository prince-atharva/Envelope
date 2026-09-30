# Envelopes

| | |
|---|---|
| **Status** | Current |
| **Version** | 1.0.0 |
| **Last updated** | 30 September 2026 |
| **Audience** | Developers connecting an application to Envelope |
| **What this doc answers** | How do I create, prepare, send, track, download, cancel and remind? |

## In Plain Terms

Sending a document is four calls: upload it, add the people, place their boxes and send. After that
you either wait for a notification or ask for the status. When it is finished you download the sealed
copy. You can also cancel a document that was sent by mistake, or nudge someone who has not signed.

## Technical Detail

Full request and response examples for every operation are in the [API reference](reference.md).

### The operations at a glance

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
| Rename, archive or restore a template | `PATCH /templates/:id` | Full key | — | 30/min per workspace |
| Issue an embedded editor session | `POST /embed/sessions` | Full key | Optional | 30/min per workspace and API key |
| Revoke an embedded editor session | `DELETE /embed/sessions/:id` | Full key | — | 30/min per workspace and API key |
<!-- /generated:operations-table -->

### Creating and preparing a draft

1. **Upload** creates the draft and its first version in one multipart call (`POST /envelopes`). There
   is no separate upload endpoint. Add `title`, `documentCategory`, `externalId` and `metadata` as
   form fields.
2. **Add recipients** (`POST /envelopes/:id/recipients`), then update or remove them.
3. **Place fields** with `PUT /envelopes/:id/fields`, which replaces the whole layout.
4. **Update settings** such as `title`, `message` and `sequentialSigning` with `PATCH /envelopes/:id`.

Every draft edit takes the latest `draftRevision` in `If-Match` and returns the next one. A draft can
be edited only until it is sent (`ENVELOPE_NOT_DRAFT` afterwards).

### Sending

`POST /envelopes/:id/send` validates the draft and queues the invitations. **An `Idempotency-Key`
header is required.** Sending is asynchronous: a successful response means the invitations are
queued, not that mail has arrived or anyone has signed. Track progress with webhooks or by reading the
envelope.

If the draft is not ready you get `422 NOT_READY_TO_SEND` with an `errors` array naming every problem,
for example a signer with no required field.

### Reading status

`GET /envelopes/:id` returns the status, recipients (with `viewedAt`, `signedAt`, …), fields,
versions, the first part of the audit trail and `draftRevision`. It carries an `ETag`; send it back in
`If-None-Match` to get `304` when nothing changed. Use `GET /envelopes/:id/events` to page through
the rest of the audit trail. `GET /envelopes` lists documents across the workspace with `view`,
`status`, `externalId`, `limit` and `cursor`; `GET /envelopes/counts` counts each view.

### Downloading

| Route | Returns |
|---|---|
| `GET /envelopes/:id/documents/original` | The PDF exactly as uploaded, without signatures |
| `GET /envelopes/:id/documents/completed` | The sealed PDF with every signature and the certificate pages. `409 CONFLICT` until completed |
| `GET /envelopes/:id/documents/certificate` | Only the certificate pages, cut from the sealed PDF on request (rate limited) |
| `GET /envelopes/:id/file?version=n` | A specific version. `0` is the original |

The SHA-256 of the completed file is the envelope's `finalHash`. Files are kept for the retention
period, then removed (`410 ENVELOPE_PURGED`); keep the copies you need.

### Cancelling and reminding

- `POST /envelopes/:id/void` with a `reason` cancels a sent envelope: its links stop working and the
  people who were emailed are told why. On a draft it discards the draft and emails nobody. Needs a
  full-access key. Fires `envelope.voided`.
- `POST /envelopes/:id/remind` emails a fresh link to the people whose turn it is and who have not
  finished; the previous link stops working. Each person can be reminded once every 24 hours; those
  skipped are listed with a reason, and if nobody could be reminded you get `429 REMINDER_TOO_SOON`
  with `Retry-After`.
- Extending an expired deadline is not available to an API key.

### Where signing happens

A recipient always signs on Envelope's own hosted page, reached by the emailed link. The API and
webhooks cover creation, sending and status; there is no API to sign, and signing is never embedded in
your page.
