# Webhooks

| | |
|---|---|
| **Status** | Current |
| **Version** | 1.0.0 |
| **Last updated** | 30 September 2026 |
| **Audience** | Developers connecting an application to Envelope |
| **What this doc answers** | How do I receive, verify and recover event notifications? |

## In Plain Terms

Instead of asking Envelope "is it signed yet?" over and over, you give Envelope an address on your
server. Whenever something happens (sent, viewed, signed, completed…) Envelope posts a small signed
message there. You check the signature, store the message and answer "got it". If your server is down
Envelope tries again for about fifteen hours, and you can replay failures from the web app for a week.

## Technical Detail

### Register a receiver

In **Settings → Integrations → Manage connections** an Admin or Owner chooses **Add webhook**:

1. Enter a public `https://` URL. Private addresses, localhost and redirects are refused, checked at
   registration and again on every delivery.
2. Choose all events or a selection.
3. Copy the signing secret once into `ENVELOPE_WEBHOOK_SECRET` on your server. Rotate it from the same
   screen; the previous secret keeps verifying for 24 hours by default (up to 72) so you can switch
   without missing events.

Up to five endpoints can be active per workspace. An endpoint whose deliveries fail every retry ten
times in a row is switched off automatically and the workspace admins are emailed; fix the receiver,
use **Send test event**, then reactivate it.

### What a delivery looks like

Envelope sends `POST` with `Content-Type: application/json` and these headers:

<!-- generated:webhook-headers -->
| Header | Meaning |
|---|---|
| `X-Signature` | sha256=<hex HMAC-SHA256 of "<timestamp>.<raw body>">. During a secret rotation it lists one signature per accepted secret, comma-separated. |
| `X-Signature-Timestamp` | Unix seconds when this attempt was signed. Reject anything older than five minutes. |
| `X-Envelope-Event-Id` | The event id, the same on every retry and redrive. Deduplicate on this. |
| `X-Envelope-Event-Type` | The event type, so you can route before parsing the body. |
| `X-Envelope-Delivery-Id` | Identifies this delivery record; it is what the Deliveries screen shows. |
| `X-Envelope-Delivery-Attempt` | The attempt number, starting at 1 and continuing across manual redrives. |
<!-- /generated:webhook-headers -->

The body is:

```json
{
  "id": "evt_…",
  "type": "recipient.signed",
  "apiVersion": "v1",
  "createdAt": "2026-09-27T10:00:00.000Z",
  "data": { "envelopeId": "…", "externalId": "visit:1001", "metadata": { "department": "billing" } }
}
```

`apiVersion` is the contract version. Additive fields do not change it; ignore fields and event types
you do not recognise. Every envelope event's `data` carries `externalId` and `metadata` (each `null`
when none was set) and `envelopeTitle`.

### Events

<!-- generated:webhook-events -->
| Event | Sent when |
|---|---|
| `envelope.sent` | The envelope was sent and invitations were queued; this does not confirm inbox delivery. |
| `envelope.viewed` | A recipient opened their link for the first time. |
| `recipient.consented` | A recipient accepted electronic signing consent. |
| `recipient.signed` | A recipient finished; the sealing worker may still be running. |
| `recipient.declined` | A recipient declined and the envelope closed. |
| `recipient.delegated` | A recipient passed their part to someone else. The new person has their own recipient id and link. |
| `envelope.completed` | The final PDF is sealed. Use finalVersionNumber to download it. |
| `envelope.voided` | The sender cancelled the envelope or discarded its draft. |
| `envelope.expired` | The deadline passed with unfinished recipients. Signing is paused. |
| `envelope.extended` | The sender gave an expired envelope a new deadline, reopening it. |
<!-- /generated:webhook-events -->

`envelope.delivered` is reserved and is never sent: mail is handed to a mail server, which cannot
confirm that it reached an inbox. Use `envelope.sent` and `envelope.viewed`. Only `envelope.completed`
confirms completion: `recipient.signed` reports `allSigned`, but sealing is asynchronous. A test
delivery uses the type `webhook.test` and needs no action.

#### Payload for each event

<!-- generated:webhook-payloads -->
#### `envelope.sent`

```json
{
  "id": "evt_55555555-5555-4555-8555-555555555555",
  "type": "envelope.sent",
  "apiVersion": "v1",
  "createdAt": "2026-09-27T10:00:00.000Z",
  "data": {
    "envelopeId": "11111111-1111-4111-8111-111111111111",
    "envelopeTitle": "Consulting agreement",
    "envelopeStatus": "SENT",
    "sentAt": "2026-09-27T10:00:00.000Z",
    "expiresAt": "2026-10-11T10:00:00.000Z",
    "recipientCount": 1,
    "invitedCount": 1,
    "externalId": "visit:1001",
    "metadata": {
      "department": "billing"
    }
  }
}
```

#### `envelope.viewed`

```json
{
  "id": "evt_55555555-5555-4555-8555-555555555555",
  "type": "envelope.viewed",
  "apiVersion": "v1",
  "createdAt": "2026-09-27T10:00:00.000Z",
  "data": {
    "envelopeId": "11111111-1111-4111-8111-111111111111",
    "envelopeTitle": "Consulting agreement",
    "recipientId": "22222222-2222-4222-8222-222222222222",
    "recipientEmail": "alex@example.com",
    "envelopeStatus": "SENT",
    "viewedAt": "2026-09-27T10:00:00.000Z",
    "externalId": "visit:1001",
    "metadata": {
      "department": "billing"
    }
  }
}
```

#### `recipient.consented`

```json
{
  "id": "evt_55555555-5555-4555-8555-555555555555",
  "type": "recipient.consented",
  "apiVersion": "v1",
  "createdAt": "2026-09-27T10:00:00.000Z",
  "data": {
    "envelopeId": "11111111-1111-4111-8111-111111111111",
    "envelopeTitle": "Consulting agreement",
    "recipientId": "22222222-2222-4222-8222-222222222222",
    "recipientEmail": "alex@example.com",
    "envelopeStatus": "SENT",
    "consentGivenAt": "2026-09-27T10:00:00.000Z",
    "externalId": "visit:1001",
    "metadata": {
      "department": "billing"
    }
  }
}
```

#### `recipient.signed`

```json
{
  "id": "evt_55555555-5555-4555-8555-555555555555",
  "type": "recipient.signed",
  "apiVersion": "v1",
  "createdAt": "2026-09-27T10:00:00.000Z",
  "data": {
    "envelopeId": "11111111-1111-4111-8111-111111111111",
    "envelopeTitle": "Consulting agreement",
    "recipientId": "22222222-2222-4222-8222-222222222222",
    "recipientEmail": "alex@example.com",
    "envelopeStatus": "PARTIALLY_SIGNED",
    "signedAt": "2026-09-27T10:00:00.000Z",
    "allSigned": false,
    "remainingSigners": 1,
    "externalId": "visit:1001",
    "metadata": {
      "department": "billing"
    }
  }
}
```

#### `recipient.declined`

```json
{
  "id": "evt_55555555-5555-4555-8555-555555555555",
  "type": "recipient.declined",
  "apiVersion": "v1",
  "createdAt": "2026-09-27T10:00:00.000Z",
  "data": {
    "envelopeId": "11111111-1111-4111-8111-111111111111",
    "envelopeTitle": "Consulting agreement",
    "recipientId": "22222222-2222-4222-8222-222222222222",
    "recipientEmail": "alex@example.com",
    "declinedAt": "2026-09-27T10:00:00.000Z",
    "envelopeStatus": "DECLINED",
    "externalId": "visit:1001",
    "metadata": {
      "department": "billing"
    }
  }
}
```

#### `recipient.delegated`

```json
{
  "id": "evt_55555555-5555-4555-8555-555555555555",
  "type": "recipient.delegated",
  "apiVersion": "v1",
  "createdAt": "2026-09-27T10:00:00.000Z",
  "data": {
    "envelopeId": "11111111-1111-4111-8111-111111111111",
    "envelopeTitle": "Consulting agreement",
    "fromRecipientId": "22222222-2222-4222-8222-222222222222",
    "fromRecipientEmail": "alex@example.com",
    "toRecipientId": "33333333-3333-4333-8333-333333333333",
    "toRecipientEmail": "sam@example.com",
    "envelopeStatus": "SENT",
    "delegatedAt": "2026-09-27T10:00:00.000Z",
    "externalId": "visit:1001",
    "metadata": {
      "department": "billing"
    }
  }
}
```

#### `envelope.completed`

```json
{
  "id": "evt_55555555-5555-4555-8555-555555555555",
  "type": "envelope.completed",
  "apiVersion": "v1",
  "createdAt": "2026-09-27T10:00:00.000Z",
  "data": {
    "envelopeId": "11111111-1111-4111-8111-111111111111",
    "envelopeTitle": "Consulting agreement",
    "envelopeStatus": "COMPLETED",
    "completedAt": "2026-09-27T10:00:00.000Z",
    "finalVersionNumber": 2,
    "finalHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "externalId": "visit:1001",
    "metadata": {
      "department": "billing"
    }
  }
}
```

#### `envelope.voided`

```json
{
  "id": "evt_55555555-5555-4555-8555-555555555555",
  "type": "envelope.voided",
  "apiVersion": "v1",
  "createdAt": "2026-09-27T10:00:00.000Z",
  "data": {
    "envelopeId": "11111111-1111-4111-8111-111111111111",
    "envelopeTitle": "Consulting agreement",
    "envelopeStatus": "VOIDED",
    "voidedAt": "2026-09-27T10:00:00.000Z",
    "fromStatus": "SENT",
    "reason": "Sent to the wrong patient",
    "externalId": "visit:1001",
    "metadata": {
      "department": "billing"
    }
  }
}
```

#### `envelope.expired`

```json
{
  "id": "evt_55555555-5555-4555-8555-555555555555",
  "type": "envelope.expired",
  "apiVersion": "v1",
  "createdAt": "2026-09-27T10:00:00.000Z",
  "data": {
    "envelopeId": "11111111-1111-4111-8111-111111111111",
    "envelopeTitle": "Consulting agreement",
    "envelopeStatus": "EXPIRED",
    "expiredAt": "2026-09-27T10:00:00.000Z",
    "unsigned": 1,
    "externalId": "visit:1001",
    "metadata": {
      "department": "billing"
    }
  }
}
```

#### `envelope.extended`

```json
{
  "id": "evt_55555555-5555-4555-8555-555555555555",
  "type": "envelope.extended",
  "apiVersion": "v1",
  "createdAt": "2026-09-27T10:00:00.000Z",
  "data": {
    "envelopeId": "11111111-1111-4111-8111-111111111111",
    "envelopeTitle": "Consulting agreement",
    "envelopeStatus": "SENT",
    "expiresAt": "2026-11-11T10:00:00.000Z",
    "previousExpiresAt": "2026-10-11T10:00:00.000Z",
    "reopened": true,
    "reinvitedCount": 1,
    "externalId": "visit:1001",
    "metadata": {
      "department": "billing"
    }
  }
}
```
<!-- /generated:webhook-payloads -->

Some events contain recipient email addresses and your own labels; protect stored payloads as personal
data.

### Verify before you trust

`X-Signature` is `sha256=` followed by the hex HMAC-SHA256, keyed with your signing secret, of the
timestamp, a period and the exact raw request body:

```
signature = HMAC_SHA256(secret, "<X-Signature-Timestamp>.<raw body>")
```

1. Reject timestamps more than five minutes from your clock (replay protection).
2. Compare in constant time.
3. Verify the raw bytes before parsing or re-serialising the JSON.
4. During a rotation the header lists two signatures separated by a comma, the new one first
   (`sha256=NEW,sha256=OLD`): accept the request if any one matches.

### A complete receiver

Runs as it is with Node 22: `ENVELOPE_WEBHOOK_SECRET=… node receiver.mjs`. It keeps a file-backed inbox
and stores each event id once, so a retry or a redrive is acknowledged without being stored twice. In
production replace `saveEventOnce` with a database insert that has a unique event id, and do business
work in a separate worker.

<!-- generated:webhook-receiver -->
```js
import { createHmac, timingSafeEqual } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const secret = process.env.ENVELOPE_WEBHOOK_SECRET;
if (!secret) throw new Error('Set ENVELOPE_WEBHOOK_SECRET');
const inboxFile = process.env.INBOX_FILE ?? 'envelope-events.ndjson';
const port = Number(process.env.PORT ?? 8080);

// A durable inbox: one JSON line per event. Keep the ids already stored so a retry or a redrive
// is acknowledged without being stored twice. Business work belongs in a separate worker.
const seen = new Set(
  existsSync(inboxFile)
    ? readFileSync(inboxFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line).id)
    : [],
);
function saveEventOnce(event) {
  if (seen.has(event.id)) return;
  appendFileSync(inboxFile, JSON.stringify(event) + '\n');
  seen.add(event.id);
}

function verifyWebhook(rawBody, timestamp, signature, secret) {
  if (typeof timestamp !== 'string' || !/^\d{1,12}$/.test(timestamp)) return false;
  if (typeof signature !== 'string') return false;
  const seconds = Number(timestamp);
  if (Math.abs(Date.now() / 1000 - seconds) > 300) return false;
  const expected = createHmac('sha256', secret)
    .update(timestamp + '.')
    .update(rawBody)
    .digest();
  // While a secret is being rotated the header lists one signature per
  // accepted secret, comma-separated. Accept the request if any one matches.
  return signature.split(',').some((part) => {
    const candidate = part.trim();
    if (!/^sha256=[a-f0-9]{64}$/.test(candidate)) return false;
    const received = Buffer.from(candidate.slice(7), 'hex');
    return received.length === expected.length && timingSafeEqual(received, expected);
  });
}

createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/webhooks/envelope') {
    res.writeHead(404).end();
    return;
  }
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 1024 * 1024) { res.writeHead(413).end(); return; }
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks);
    if (!verifyWebhook(rawBody, req.headers['x-signature-timestamp'],
        req.headers['x-signature'], secret)) {
      res.writeHead(401).end();
      return;
    }
    let event;
    try { event = JSON.parse(rawBody.toString('utf8')); }
    catch { res.writeHead(400).end(); return; }
    if (!event || typeof event.id !== 'string' || typeof event.type !== 'string'
        || !event.data || typeof event.data !== 'object') {
      res.writeHead(400).end();
      return;
    }
    saveEventOnce(event);
    res.writeHead(204).end();
  } catch {
    // Storage failed: a non-2xx answer makes Envelope retry this delivery.
    res.writeHead(503).end();
  }
}).listen(port, '127.0.0.1');
// Publish it through your HTTPS reverse proxy at /webhooks/envelope.
```
<!-- /generated:webhook-receiver -->

### Delivery, retries and recovery

- **At least once.** Duplicates are expected, including after retries and manual redrive. Deduplicate
  on `event.id`, never on the timestamp or delivery id. Do not rely on order; read the current
  envelope when it matters.
- **Answer fast.** Return a `2xx` within five seconds after durably storing the event; `204` is ideal.
  Any other status, a timeout or a connection error counts as a failure.
- **Retries** follow after 10 seconds, 1 minute, 5 minutes, 30 minutes, 2 hours and 12 hours: seven
  attempts in all, spread over about fifteen hours.
- **Redrive.** A failed delivery can be retried from **Manage connections → Deliveries** for seven
  days; after that the history is purged.
- **Test.** **Send test event** delivers one signed `webhook.test` with a single attempt and no
  retries. It never counts toward automatic deactivation.
