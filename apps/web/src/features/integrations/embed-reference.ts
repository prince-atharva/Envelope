import type { CreateEmbedSessionInput } from '@envelope/shared';

export const EMBED_EXISTING_EXAMPLE: CreateEmbedSessionInput = {
  mode: 'existing',
  envelopeId: '123e4567-e89b-42d3-a456-426614174000',
  parentOrigin: 'https://healthprohub.example',
  externalActorId: 'staff:123',
  actions: ['edit', 'send'],
};
export const EMBED_UPLOAD_EXAMPLE: CreateEmbedSessionInput = {
  mode: 'upload',
  parentOrigin: 'https://healthprohub.example',
  externalActorId: 'staff:123',
  actions: ['edit', 'send'],
};

export const EMBED_BACKEND_EXAMPLE = `// HealthProHub backend: authenticate staff and authorize the record first.
// Load envelopeId from YOUR trusted record mapping, never directly from a browser.
const response = await fetch(process.env.ENVELOPE_URL + '/api/v1/embed/sessions', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer ' + process.env.ENVELOPE_API_KEY,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    mode: 'existing', envelopeId: authorizedRecord.envelopeId,
    parentOrigin: 'https://healthprohub.example',
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
// Send an Idempotency-Key header (a UUID) when issuing: a retry after a lost response gets
// a fresh launchToken for the same session and the earlier token stops working.
// Save the resulting draft.created envelopeId against the authorized record.
// Revoke this session when the HealthProHub page/login ends:
// DELETE /api/v1/embed/sessions/:sessionId using the issuing backend API key.`;

export const EMBED_SDK_EXAMPLE = `// Workspace SDK: packages/embed (ESM + TypeScript declarations).
// Build with: pnpm --filter @envelope/embed build
// Not published to a registry; wire this package into your application build.
import { createEnvelopeEditor } from '@envelope/embed';

let editor;
let session = await getAuthorizedEditorSessionFromYourBackend();
editor = createEnvelopeEditor({
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

export const EMBED_IFRAME_EXAMPLE = `import { embedEventSchema } from '@envelope/shared';
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
  const parsed = embedEventSchema.safeParse(event.data);
  if (!parsed.success || parsed.data.sessionId !== sessionId) return;
  if (parsed.data.type === 'ready' && launchToken) {
    frame.contentWindow.postMessage({
      version: 1, sessionId, type: 'launch', launchToken,
    }, origin);
    launchToken = null;
  }
  // Other validated events are UI notifications; verify status on YOUR backend.
}
window.addEventListener('message', receive);
const timeout = setTimeout(() => { launchToken = null; }, 60000);
frame.src = frameUrl;
document.getElementById('envelope-editor').appendChild(frame);
// Normal close: frame.contentWindow.postMessage({version:1,sessionId,type:'request.close'},origin)
// Teardown: clearTimeout(timeout); launchToken = null;
// window.removeEventListener('message', receive); frame.remove();
// Revoke the session from YOUR backend. Never use '*' as targetOrigin.`;
