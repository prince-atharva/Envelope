# Quick Start

| | |
|---|---|
| **Status** | Current |
| **Version** | 1.0.0 |
| **Last updated** | 30 September 2026 |
| **Audience** | Developers connecting an application to Envelope |
| **What this doc answers** | How do I send my first document from a script in five minutes? |

## In Plain Terms

You create a key in Envelope, then run one script. It uploads a PDF, adds a person who must sign,
places a signature box for them and sends the document. That person receives an email and signs on
Envelope's page.

## Technical Detail

### 1. Create an API key

A workspace Admin or Owner opens **Settings → Integrations → Manage connections** and creates a
full-access key. The key is shown once. Store it in your server's secret manager as
`ENVELOPE_API_KEY`, and set `ENVELOPE_URL` to your Envelope host, for example
`https://envelope.example.com`. Keep the key out of browsers, repositories and logs.

### 2. Run the script

You need `bash`, `curl`, `jq` and `uuidgen`, and a PDF named `agreement.pdf` in the current folder.
The script carries every id forward from the previous response, so nothing needs editing by hand.

<!-- generated:workflow-script -->
```bash
#!/usr/bin/env bash
set -euo pipefail
# Needs curl, jq and uuidgen. Set ENVELOPE_URL (https://your-envelope-host) and ENVELOPE_API_KEY.
API="$ENVELOPE_URL/api/v1"
AUTH="Authorization: Bearer $ENVELOPE_API_KEY"

# 1. Upload. Keep the id and the draft revision.
UPLOAD=$(curl -sS --fail-with-body --request POST "$API/envelopes" --header "$AUTH" \
  --form 'file=@agreement.pdf' --form 'title=Consulting agreement')
ENVELOPE_ID=$(jq -r .id <<<"$UPLOAD")
DRAFT_REVISION=$(jq -r .draftRevision <<<"$UPLOAD")

# 2. Add a recipient. Every edit sends the latest revision in If-Match and returns the next one.
RECIPIENT=$(curl -sS --fail-with-body --request POST "$API/envelopes/$ENVELOPE_ID/recipients" \
  --header "$AUTH" --header "If-Match: \"$DRAFT_REVISION\"" \
  --header 'Content-Type: application/json' \
  --data '{"name":"Alex Morgan","email":"alex@example.com","role":"SIGNER","routingOrder":1}')
RECIPIENT_ID=$(jq -r .recipient.id <<<"$RECIPIENT")
DRAFT_REVISION=$(jq -r .draftRevision <<<"$RECIPIENT")

# 3. Place a required signature field for that recipient. Ratios are fractions of the page.
FIELDS=$(curl -sS --fail-with-body --request PUT "$API/envelopes/$ENVELOPE_ID/fields" \
  --header "$AUTH" --header "If-Match: \"$DRAFT_REVISION\"" \
  --header 'Content-Type: application/json' \
  --data '{"fields":[{"id":"'"$(uuidgen)"'","recipientId":"'"$RECIPIENT_ID"'","type":"SIGNATURE","pageNumber":1,"ratioX":0.1,"ratioY":0.7,"ratioWidth":0.3,"ratioHeight":0.08,"required":true}]}')
DRAFT_REVISION=$(jq -r .draftRevision <<<"$FIELDS")

# 4. Send. Reuse SEND_IDEMPOTENCY_KEY and the same body if you must retry after a network failure.
SEND_IDEMPOTENCY_KEY=$(uuidgen)
curl -sS --fail-with-body --request POST "$API/envelopes/$ENVELOPE_ID/send" \
  --header "$AUTH" --header "Idempotency-Key: $SEND_IDEMPOTENCY_KEY" \
  --header 'Content-Type: application/json' \
  --data '{"expiresInDays":14}' | jq '{id, status, expiresAt}'
```
<!-- /generated:workflow-script -->

The last command prints the sent envelope, for example:

```json
{ "id": "…", "status": "SENT", "expiresAt": "…" }
```

### 3. What happens next

1. Alex receives an email with a personal link and signs on Envelope's hosted page. Signing is never
   embedded in your application; every signer sees Envelope's own page.
2. When everyone has signed, Envelope seals the PDF and records a certificate of completion.
3. If you registered a [webhook](webhooks.md), it receives `envelope.completed`. Download the sealed
   PDF with `GET /envelopes/:id/documents/completed`.

### Where to go next

- Be told about progress without polling: [Webhooks](webhooks.md).
- Retry safely after a timeout: [Recipes](recipes.md).
- Let your staff prepare the document inside your own page: [Embedded editor](embedded-editor.md).
