import {
  API_BASE_PATH,
  EXAMPLE_ENVELOPE_ID,
  EXAMPLE_RECIPIENT_ID,
  type OperationContract,
} from './integration-contract';

/**
 * Runnable examples for the integration guides (docs/18 workstream 13, ADR 0021). The in-app guide
 * and `docs/developers/` both print exactly these strings, and tests execute or syntax-check them,
 * so what a partner copies is what was tested.
 */

const EXAMPLE_FIELD_ID = '33333333-3333-4333-8333-333333333333';

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * The shell variable that carries a path parameter. Ids come from earlier responses via `jq`
 * (see `WORKFLOW_EXAMPLE`); no example puts a literal id in a URL.
 */
function pathVariable(operation: OperationContract, name: string): string {
  if (name === 'recipientId') return '$RECIPIENT_ID';
  if (operation.id === 'embed-session-revoke') return '$SESSION_ID';
  return '$ENVELOPE_ID';
}

/**
 * One operation as a cURL command. `base` is `https://host/api/v1`, or `$ENVELOPE_URL/api/v1` in
 * the developer guide. User-controlled body text stays inside single quotes; only the two example
 * ids are swapped for variables, by closing and reopening the quotes.
 */
export function curlExample(operation: OperationContract, base: string): string {
  const path = operation.path.replace(/:(\w+)/g, (_match, name: string) =>
    pathVariable(operation, name),
  );
  const lines = [
    `curl --request ${operation.method} "${base}${path}${operation.query ?? ''}"`,
    '  --header "Authorization: Bearer $ENVELOPE_API_KEY"',
  ];
  if (operation.revision) lines.push('  --header "If-Match: \\"$DRAFT_REVISION\\""');
  if (operation.id === 'upload')
    lines.push(
      "  --form 'file=@agreement.pdf'",
      "  --form 'title=Consulting agreement'",
      "  --form 'documentCategory=OTHER'",
      "  --form 'externalId=visit:1001'",
      `  --form 'metadata={"department":"billing"}'`,
    );
  if (operation.id === 'send') lines.push('  --header "Idempotency-Key: $SEND_IDEMPOTENCY_KEY"');
  if (operation.body) {
    const json = shellQuote(JSON.stringify(operation.body, null, 2))
      .replaceAll(EXAMPLE_RECIPIENT_ID, `'"$RECIPIENT_ID"'`)
      .replaceAll(EXAMPLE_FIELD_ID, `'"$(uuidgen)"'`)
      .replaceAll(EXAMPLE_ENVELOPE_ID, `'"$ENVELOPE_ID"'`);
    lines.push("  --header 'Content-Type: application/json'", `  --data ${json}`);
  }
  if (operation.id === 'file') lines.push("  --output 'document.pdf'");
  if (operation.id === 'document-original') lines.push("  --output 'original.pdf'");
  if (operation.id === 'document-completed') lines.push("  --output 'completed.pdf'");
  if (operation.id === 'document-certificate') lines.push("  --output 'certificate.pdf'");
  return lines.join(' \\\n');
}

/**
 * The whole path from a PDF to a sent envelope, carrying ids forward with `jq`. Needs `curl`, `jq`
 * and `uuidgen`, plus ENVELOPE_URL and ENVELOPE_API_KEY. The API e2e suite runs this script.
 */
export const WORKFLOW_EXAMPLE = `#!/usr/bin/env bash
set -euo pipefail
# Needs curl, jq and uuidgen. Set ENVELOPE_URL (https://your-envelope-host) and ENVELOPE_API_KEY.
API="$ENVELOPE_URL${API_BASE_PATH}"
AUTH="Authorization: Bearer $ENVELOPE_API_KEY"

# 1. Upload. Keep the id and the draft revision.
UPLOAD=$(curl -sS --fail-with-body --request POST "$API/envelopes" --header "$AUTH" \\
  --form 'file=@agreement.pdf' --form 'title=Consulting agreement')
ENVELOPE_ID=$(jq -r .id <<<"$UPLOAD")
DRAFT_REVISION=$(jq -r .draftRevision <<<"$UPLOAD")

# 2. Add a recipient. Every edit sends the latest revision in If-Match and returns the next one.
RECIPIENT=$(curl -sS --fail-with-body --request POST "$API/envelopes/$ENVELOPE_ID/recipients" \\
  --header "$AUTH" --header "If-Match: \\"$DRAFT_REVISION\\"" \\
  --header 'Content-Type: application/json' \\
  --data '{"name":"Alex Morgan","email":"alex@example.com","role":"SIGNER","routingOrder":1}')
RECIPIENT_ID=$(jq -r .recipient.id <<<"$RECIPIENT")
DRAFT_REVISION=$(jq -r .draftRevision <<<"$RECIPIENT")

# 3. Place a required signature field for that recipient. Ratios are fractions of the page.
FIELDS=$(curl -sS --fail-with-body --request PUT "$API/envelopes/$ENVELOPE_ID/fields" \\
  --header "$AUTH" --header "If-Match: \\"$DRAFT_REVISION\\"" \\
  --header 'Content-Type: application/json' \\
  --data '{"fields":[{"id":"'"$(uuidgen)"'","recipientId":"'"$RECIPIENT_ID"'","type":"SIGNATURE","pageNumber":1,"ratioX":0.1,"ratioY":0.7,"ratioWidth":0.3,"ratioHeight":0.08,"required":true}]}')
DRAFT_REVISION=$(jq -r .draftRevision <<<"$FIELDS")

# 4. Send. Reuse SEND_IDEMPOTENCY_KEY and the same body if you must retry after a network failure.
SEND_IDEMPOTENCY_KEY=$(uuidgen)
curl -sS --fail-with-body --request POST "$API/envelopes/$ENVELOPE_ID/send" \\
  --header "$AUTH" --header "Idempotency-Key: $SEND_IDEMPOTENCY_KEY" \\
  --header 'Content-Type: application/json' \\
  --data '{"expiresInDays":14}' | jq '{id, status, expiresAt}'
`;

// The displayed verifier is executed by tests, so it is exactly what a partner copies.
export const WEBHOOK_VERIFIER = `function verifyWebhook(rawBody, timestamp, signature, secret) {
  if (typeof timestamp !== 'string' || !/^\\d{1,12}$/.test(timestamp)) return false;
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
}`;

/**
 * A complete receiver with no adapter to write: a file-backed inbox that stores each event id once.
 * Swap `saveEventOnce` for a database insert with a UNIQUE event id in production.
 */
export const WEBHOOK_RECEIVER = `import { createHmac, timingSafeEqual } from 'node:crypto';
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
    ? readFileSync(inboxFile, 'utf8').split('\\n').filter(Boolean).map((line) => JSON.parse(line).id)
    : [],
);
function saveEventOnce(event) {
  if (seen.has(event.id)) return;
  appendFileSync(inboxFile, JSON.stringify(event) + '\\n');
  seen.add(event.id);
}

${WEBHOOK_VERIFIER}

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
`;

export const EMBED_EXISTING_EXAMPLE = {
  mode: 'existing',
  envelopeId: '123e4567-e89b-42d3-a456-426614174000',
  parentOrigin: 'https://app.example.com',
  externalActorId: 'staff:123',
  actions: ['edit', 'send'],
} as const;

export const EMBED_UPLOAD_EXAMPLE = {
  mode: 'upload',
  parentOrigin: 'https://app.example.com',
  externalActorId: 'staff:123',
  actions: ['edit', 'send'],
} as const;

export const EMBED_BACKEND_EXAMPLE = `// Your backend: authenticate the staff member and authorize the record first.
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
// DELETE /api/v1/embed/sessions/:sessionId using the issuing backend API key.`;

export const EMBED_SDK_SCRIPT_TAG =
  '<script src="https://YOUR-ENVELOPE-HOST/api/v1/embed/sdk/v1/envelope.js"></script>';

export const EMBED_SDK_EXAMPLE = `// Load the SDK with one tag, no npm install and no build step:
//   ${EMBED_SDK_SCRIPT_TAG}
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
// destroy() removes immediately and does not guarantee a save.`;

export const EMBED_IFRAME_EXAMPLE = `let session = await getAuthorizedEditorSessionFromYourBackend();
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
// Revoke the session from YOUR backend. Never use '*' as targetOrigin.`;
