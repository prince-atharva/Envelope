# Templates and Bulk Send

| | |
|---|---|
| **Status** | Current |
| **Version** | 1.0.0 |
| **Last updated** | 1 October 2026 |
| **Audience** | Developers connecting an application to Envelope |
| **What this doc answers** | How do I send the same document to many people, from a saved template or a whole list at once? |

## In Plain Terms

If your application sends the same form again and again (a consent, an intake sheet), set it up once as a
**template**: the PDF, who signs, and where. After that you create an envelope by giving each role a
name and an email, instead of uploading, adding people and placing boxes every time. To send to a whole list
at once, start a **bulk send**: Envelope creates one envelope per row, in the background, and you read back
how each row went.

## Technical Detail

The operations are listed with their access level and limits in the [reference](reference.md) and in
[Envelopes](envelopes.md#the-operations-at-a-glance). This page explains how they fit together.

### A template is a document and its roles

A template keeps its own copy of the PDF, a list of **roles** and the fields that belong to each role. A
role is a person to be named later: it has a name you choose ("Patient"), what it does (sign, approve, view or
get a copy), its place in the signing order and its colour. A template never stores anyone's name or email.

You make one from an envelope you have already prepared, so the boxes are exactly where you placed them:

```
POST /templates
{ "envelopeId": "<id>", "name": "Intake consent",
  "roleNames": { "<recipientId>": "Patient" } }
```

Each person on the envelope becomes a role, named after them unless `roleNames` says otherwise. The envelope
must have someone to sign and every signer needs a required field, the same as for sending. Saving does not
change the envelope.

Templates cannot be edited. To change the layout, save a new template and archive the old one
(`PATCH /templates/:id` with `{"archived": true}`). You can still rename a template, describe it and set the
message it carries. An archived template is kept, can still be read, and cannot start new envelopes. Saving
templates needs a full-access key.

### Create one envelope from a template

```
POST /templates/:id/envelopes
{ "recipients": [ { "role": "Patient", "name": "Alex Morgan", "email": "alex@example.com" } ],
  "send": false }
```

There must be exactly one entry for every role of the template, using the role's name as `role`, and no email
may appear twice; otherwise the answer is `422 TEMPLATE_ROLE_MISMATCH` with each problem in `errors`. The
result is an ordinary envelope. With `"send": false` (the default) it is a draft you can still change; with
`"send": true` it is sent at once.

What is fresh each time: the envelope gets its own copy of the PDF, and **policy is frozen when this call
runs**, not when the template was saved. If your workspace's policy has since blocked the template's document
category, you get `422 DOCUMENT_CATEGORY_BLOCKED` and nothing is created. Send an `Idempotency-Key` to make
a retry safe: the same key and body within 24 hours returns the envelope the first request made
(`Idempotency-Replayed: true`).

### Bulk send

```
POST /templates/:id/bulk
{ "rows": [ { "recipients": [ { "role": "Patient", "name": "Alex Morgan", "email": "alex@example.com" } ],
              "externalId": "visit:1001" } ],
  "send": true }
```

- Up to 500 rows per batch (`422 BULK_TOO_LARGE` beyond that), and 10 batches an hour per workspace. Split a
  larger list.
- The call answers `202` with a `batchId` straight away. Envelopes are made, and sent if you asked, in the
  background, one row at a time.
- A malformed row (an email that is not one, a missing name) refuses the whole request with
  `400 VALIDATION_FAILED` and nothing is stored. A row whose people do not match the template's roles is
  accepted and later reported as failed with `TEMPLATE_ROLE_MISMATCH`: one typo does not cost you the other
  499 rows.
- A failed row never stops the rest. Nothing is retried for you: fix the failed rows and send them as a new
  batch. Use an `Idempotency-Key` to make a retry of the request itself safe.

Read progress and results with `GET /bulk-batches/:id`:

```
{ "id": "...", "status": "COMPLETED", "totalRows": 2, "succeededRows": 1, "failedRows": 1,
  "rows": [ { "rowIndex": 0, "status": "SUCCEEDED", "envelopeId": "...", "errorCode": null },
            { "rowIndex": 1, "status": "FAILED", "envelopeId": null, "errorCode": "TEMPLATE_ROLE_MISMATCH" } ] }
```

`status` is `PROCESSING` until every row has a result. Rows are in the order you sent them, and never show an
email address. Envelope-level events (`envelope.sent` and the rest) fire for each envelope as usual, so a
webhook receiver needs no change. The addresses kept on failed rows are cleared 30 days after the batch.

### When an email does not arrive

If the workspace has delivery tracking set up, a recipient on an envelope can have
`"emailProblem": "BOUNCED"` (the address could not be reached) or `"COMPLAINED"` (they reported the email as
spam) on the envelope's detail, and the audit trail gains an `EMAIL_BOUNCED` or `EMAIL_COMPLAINED` event. There
is no webhook event for this yet; read the envelope.

### Errors

| Code | When |
|---|---|
| `TEMPLATE_NOT_FOUND` | The id is not a template of your workspace |
| `TEMPLATE_ARCHIVED` | The template cannot start new envelopes or batches |
| `TEMPLATE_NAME_TAKEN` | Another active template has that name |
| `TEMPLATE_ROLE_MISMATCH` | The people given do not match the template's roles |
| `BULK_TOO_LARGE` | More than 500 rows |
| `BULK_BATCH_NOT_FOUND` | The id is not a batch of yours |

The full list, with what to do about each, is in [Errors](errors.md).
