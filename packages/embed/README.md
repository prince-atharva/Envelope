# Envelope embedded sender SDK

| | |
|---|---|
| Status | Implemented; served by the Envelope API as a hosted script (ADR 0020) |
| Version | Workspace version; unpublished |
| Last updated | 30 September 2026 |
| Audience | Tenant integration developers |
| What this doc answers | How to open and close the Envelope sender editor safely |

## In Plain Terms

Any tenant application can use Envelope's existing upload, recipient, PDF field placement and send UI
inside an iframe. The application backend can upload first and open that draft, or create an upload session
and let staff upload within the editor. Recipients sign through Envelope's emailed hosted link.

## Technical Detail

The SDK is one self-contained file with no dependencies. Envelope serves it at a stable,
versioned URL, so a partner page needs no npm install and no build step:

```html
<script src="https://YOUR-ENVELOPE-HOST/api/v1/embed/sdk/v1/envelope.js"></script>
<!-- global: EnvelopeEmbed.createEnvelopeEditor(...) -->
<!-- or, as a module: import { createEnvelopeEditor } from '.../embed/sdk/v1/envelope.mjs' -->
```

A working page is in `examples/embedded-partner/`. The `v1` path segment is the compatibility
promise: a breaking change would ship at `/sdk/v2/`. The response is cached for five minutes and
carries an ETag. Deployment MUST include `packages/embed/dist` (build with
`pnpm --filter @envelope/embed build`, which the root `pnpm build` already runs) under
`APP_ROOT_DIR`; without it the URL answers 503. There is no npm or CDN publication and no
subresource-integrity hash in this phase.

```ts
const session = await authorizedHealthProHubBackend.createEditorSession(recordId);
const editor = EnvelopeEmbed.createEnvelopeEditor({
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
