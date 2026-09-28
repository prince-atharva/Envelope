# Envelope embedded sender SDK

| | |
|---|---|
| Status | Implemented; unpublished workspace package |
| Version | Workspace version; unpublished |
| Last updated | 28 September 2026 |
| Audience | Tenant integration developers |
| What this doc answers | How to open and close the Envelope sender editor safely |

## In Plain Terms

Any tenant application can use Envelope's existing upload, recipient, PDF field placement and send UI
inside an iframe. The application backend can upload first and open that draft, or create an upload session
and let staff upload within the editor. Recipients sign through Envelope's emailed hosted link.

## Technical Detail

Build the workspace package with `pnpm --filter @envelope/embed build`. This package is private;
there is no registry publication or CDN URL. Bundle its ESM artifact into the partner frontend.
Use the Settings → Integrations → Integration guide → Embedded editor examples
for backend authorization, both session bodies, direct iframe integration and webhook recovery.

```ts
import { createEnvelopeEditor } from '@envelope/embed';

const session = await authorizedHealthProHubBackend.createEditorSession(recordId);
const editor = createEnvelopeEditor({
  container: document.getElementById('editor')!,
  frameUrl: session.frameUrl,
  launchToken: session.launchToken,
  onEvent(event) {
    // IDs are hints: authorize mappings and reconcile status through your backend.
    if (event.type === 'close') editor.destroy();
  },
});
// Ask the editor to save before closing. Destroy after the close event.
editor.requestClose();
// On application teardown: editor.destroy(); backend revoke session.sessionId.
```

The backend MUST authorize the signed-in staff member and business record before issuing a
session, select the envelope and actions itself, and keep full API keys on the server. Register
the exact canonical HTTPS parent origin in Settings. Launch credentials expire after 60 seconds
and are redeemed once; access expires 30 minutes after issuance. Tokens MUST stay in memory,
never URLs, browser storage, analytics or logs. The SDK checks frame window, origin, protocol
version and session ID before forwarding events. `envelope.sent` means sent, not signed.
Verify webhook signatures and reconcile final status through the backend API.

Deployment MUST serve the API's dynamic `/api/v1/embed/frame/:id` through the same public origin
as the web assets. `APP_ROOT_DIR` must locate `apps/web/dist` including its Vite manifest. Only
this dynamic HTML permits the registered parent via CSP. Normal sender and hosted signer HTML
MUST retain `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY` in the
production reverse proxy. Vite development and preview apply those headers locally. Configure a
unique `EMBED_SESSION_HASH_SECRET` and the session purge maintenance schedule before deployment.
