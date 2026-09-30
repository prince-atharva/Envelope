# Embedded Editor

| | |
|---|---|
| **Status** | Current |
| **Version** | 1.0.0 |
| **Last updated** | 30 September 2026 |
| **Audience** | Developers connecting an application to Envelope |
| **What this doc answers** | How do I let my staff prepare and send documents inside my own page? |

## In Plain Terms

Envelope's document editor (upload, preview, add people, place boxes, review and send) can appear
inside your application in an iframe, so your staff never leave your page. Your server decides who may
open which document and asks Envelope for a one-time pass. Recipients still sign on Envelope's own
page, reached from the email. A small script, served by Envelope, connects your page to the editor.

## Technical Detail

```
  your browser page                your server                  Envelope
  ─────────────────                ───────────                  ────────
  click "Prepare"  ───────────►  authorize staff + record
                                  POST /embed/sessions  ─────►  issue session
                   ◄─────────── { frameUrl, launchToken } ◄──── (API key stays here)
  EnvelopeEmbed.createEnvelopeEditor(...)  ──iframe──►  frame loads
  frame: "ready"  ─────────────────────────────────────────────►
  SDK posts launchToken (once) ─────────────────────────────────►  editor opens
  events: draft.created, draft.saved, envelope.sent, close
```

### 1. Load the SDK

One script tag, no npm install and no build step. Envelope serves the file at a stable, versioned URL:

```html
<script src="https://YOUR-ENVELOPE-HOST/api/v1/embed/sdk/v1/envelope.js"></script>
```

It defines the global `EnvelopeEmbed`. As an ES module use
`https://YOUR-ENVELOPE-HOST/api/v1/embed/sdk/v1/envelope.mjs`. The `v1` in the path is the
compatibility promise; a breaking change would ship at `/sdk/v2/`. Responses are cached for five
minutes and carry an `ETag`. If your page has a Content-Security-Policy, add Envelope's origin to
`script-src` and `frame-src`.

### 2. Register your page's origin

On the API key that will issue sessions, register the exact origin of the page that hosts the iframe,
for example `https://app.example.com` (Settings → Integrations, **Embedded editor origins**). No
wildcards or paths. Plain HTTP is accepted for `localhost` only, for local testing.

### 3. Issue a session from your backend

Two entry modes.

**Existing draft.** Your backend uploads the PDF with `POST /envelopes`, stores the returned `id`
against your record, then asks for a session for that draft:

<!-- generated:embed-existing-body -->
```json
{
  "mode": "existing",
  "envelopeId": "123e4567-e89b-42d3-a456-426614174000",
  "parentOrigin": "https://app.example.com",
  "externalActorId": "staff:123",
  "actions": [
    "edit",
    "send"
  ]
}
```
<!-- /generated:embed-existing-body -->

**Upload inside the editor.** Staff choose the PDF in the iframe. One session creates at most one
draft; a retry returns that draft. Add `externalId` and `metadata` to have them recorded on it:

<!-- generated:embed-upload-body -->
```json
{
  "mode": "upload",
  "parentOrigin": "https://app.example.com",
  "externalActorId": "staff:123",
  "actions": [
    "edit",
    "send"
  ]
}
```
<!-- /generated:embed-upload-body -->

Issue the session from your server:

<!-- generated:embed-backend -->
```js
// Your backend: authenticate the staff member and authorize the record first.
// Load envelopeId from YOUR trusted record mapping, never directly from a browser.
const response = await fetch(process.env.ENVELOPE_URL + '/api/v1/embed/sessions', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer ' + process.env.ENVELOPE_API_KEY,
    'Content-Type': 'application/json',
    // Optional: a retry after a lost response gets a fresh launchToken for the same session.
    'Idempotency-Key': crypto.randomUUID(),
  },
  body: JSON.stringify({
    mode: 'existing', envelopeId: authorizedRecord.envelopeId,
    parentOrigin: 'https://app.example.com',
    externalActorId: authorizedStaff.opaqueId, actions: ['edit', 'send'],
  }),
});
if (!response.ok) throw new Error('Editor session could not be issued');
const session = await response.json();
// Return session only to the authorized caller with Cache-Control: no-store.
// Do not log session, cache it, or persist its launchToken.
// For upload inside the editor: mode: 'upload', omit envelopeId. Add externalId (your
// record's id) and metadata to have them recorded on the draft it creates and echoed in
// every webhook; the browser in the editor cannot set or change them.
// Save the resulting draft.created envelopeId against the authorized record.
// Revoke this session when your page or login ends:
// DELETE /api/v1/embed/sessions/:sessionId using the issuing backend API key.
```
<!-- /generated:embed-backend -->

Grant only the actions you need: `edit` is always required; omit `send` to allow preparation only.

### 4. Mount the editor in your page

<!-- generated:embed-sdk -->
```js
// Load the SDK with one tag, no npm install and no build step:
//   <script src="https://YOUR-ENVELOPE-HOST/api/v1/embed/sdk/v1/envelope.js"></script>
// It defines the global EnvelopeEmbed. (As a module: import { createEnvelopeEditor } from
// 'https://YOUR-ENVELOPE-HOST/api/v1/embed/sdk/v1/envelope.mjs'.)
let editor;
let session = await getAuthorizedEditorSessionFromYourBackend();
editor = EnvelopeEmbed.createEnvelopeEditor({
  container: document.getElementById('envelope-editor'), // give it a height
  frameUrl: session.frameUrl,
  launchToken: session.launchToken,
  onEvent(event) {
    if (event.type === 'draft.created') {
      // Ask YOUR backend to verify and store this record-to-envelope mapping.
    }
    if (event.type === 'envelope.sent') {
      // Sent is not signed/completed. Refresh business status through YOUR backend.
    }
    if (event.type === 'close') editor.destroy();
    if (event.type === 'error' || event.type === 'session.expired') {
      // Show recovery; request a fresh session to reopen the same saved draft.
    }
  },
});
session = null; // release your launch credential after mounting
// To save/confirm before closing: editor.requestClose()
// On component teardown: editor.destroy(); revoke via YOUR backend.
// destroy() removes immediately and does not guarantee a save.
```
<!-- /generated:embed-sdk -->

Prefer no SDK? The direct iframe handshake is short:

<!-- generated:embed-iframe -->
```js
let session = await getAuthorizedEditorSessionFromYourBackend();
const { sessionId, frameUrl } = session;
let launchToken = session.launchToken;
session = null;
const origin = new URL(frameUrl).origin;
const frame = document.createElement('iframe');
frame.title = 'Envelope document editor';
frame.referrerPolicy = 'no-referrer';
frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals');
frame.style.cssText = 'width:100%;height:800px;border:0';
function receive(event) {
  if (event.origin !== origin || event.source !== frame.contentWindow) return;
  const message = event.data;
  if (!message || message.version !== 1 || message.sessionId !== sessionId) return;
  if (message.type === 'ready' && launchToken) {
    frame.contentWindow.postMessage({
      version: 1, sessionId, type: 'launch', launchToken,
    }, origin);
    launchToken = null;
  }
  // Other events are UI notifications: ready, draft.created, draft.saved, envelope.sent, close,
  // error and session.expired. Verify status on YOUR backend.
}
window.addEventListener('message', receive);
const timeout = setTimeout(() => { launchToken = null; }, 60000);
frame.src = frameUrl;
document.getElementById('envelope-editor').appendChild(frame);
// Normal close: frame.contentWindow.postMessage({version:1,sessionId,type:'request.close'},origin)
// Teardown: clearTimeout(timeout); launchToken = null;
// window.removeEventListener('message', receive); frame.remove();
// Revoke the session from YOUR backend. Never use '*' as targetOrigin.
```
<!-- /generated:embed-iframe -->

### Events

`ready`, `draft.created`, `draft.saved`, `envelope.sent`, `close`, `error` and `session.expired`. Ids
in events are hints: verify a mapping on your backend with the API key before trusting it. `saved`
follows persistence; `envelope.sent` means the signing request was accepted, not that anyone signed.
Confirm the outcome with [webhooks](webhooks.md) and `GET /envelopes/:id`.

### Security rules

- The launch token lasts 60 seconds and works once; the session lasts 30 minutes from issue with no
  refresh. Keep tokens in memory: never in URLs, storage, analytics or logs.
- The SDK checks the frame's window, origin, protocol version and session id before it forwards an
  event.
- Revoke a session when your staff member signs out: `DELETE /embed/sessions/:id` with the issuing
  key. Deleting the key or removing its origin also blocks the editor.
- A session reaches only its one envelope. It cannot read other documents, the dashboard, Settings or
  signing routes.

### A complete example application

`examples/embedded-partner/` in the Envelope repository is a zero-dependency Node application that
loads the hosted script, issues sessions with an API key kept on the server, reopens the draft and
verifies webhooks. Envelope's own browser tests run against that same file. Start it with
`ENVELOPE_URL=… ENVELOPE_API_KEY=… node server.mjs` and register the origin it prints.

### Operations

The session operations are in the [API reference](reference.md).

### Troubleshooting

- **Framing blocked**: check the exact origin registered on the key, your host's `frame-src` and that
  you are using the `frameUrl` returned by the session (a normal sender URL cannot be framed).
- **Invalid or expired launch**: issue a new session and reopen the saved draft rather than creating
  another envelope.
- **Cookies blocked**: the editor uses no cookies. A login prompt means a normal sender URL was
  opened.
- **SDK script 503**: the Envelope deployment lacks the SDK build; ask its operator to build
  `packages/embed` and deploy `packages/embed/dist`.
