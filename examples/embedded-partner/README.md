# Embedded partner example

A complete, runnable partner application for Envelope's embedded sender editor. It has no
dependencies and no build step; it needs Node 22 or newer. Envelope's own browser tests run against
this exact file (`apps/web/e2e/embed-host.ts`), so it stays working.

## What it shows

| Piece | Where | Why it matters |
|---|---|---|
| Loading the SDK | one `<script src=".../api/v1/embed/sdk/v1/envelope.js">` tag | No npm install or bundler; the global is `EnvelopeEmbed` |
| Issuing a session | `POST /session` on this server | The API key stays on the server; the browser gets only a one-time launch credential |
| Reopening a draft | `POST /mapping`, then `mode: 'existing'` | The envelope id sent by the browser is re-checked with the server-side key before it is trusted |
| Webhook receiver | `POST /webhook` | Verifies `X-Signature` over `timestamp.body`, rejects stale timestamps, stores each delivery once |

## Run it

1. In Envelope, open **Settings → Integrations** and create an API key. Copy it once.
2. Start the example (the port must match the origin you register in step 3):

   ```bash
   ENVELOPE_URL=https://your-envelope-host ENVELOPE_API_KEY=eak_... node server.mjs
   ```

3. Register the origin it prints (default `http://localhost:3000`) as an embed origin on that key,
   under **Embedded editor origins** in Settings. Plain HTTP is accepted for `localhost` only.
4. Open the printed address and press **Prepare for signing**.

Optional variables: `PORT` (default 3000), `PUBLIC_ORIGIN` (when served from another address),
`ENVELOPE_ID` (start from an existing draft) and `WEBHOOK_SECRET` (the secret shown once when you
register `<origin>/webhook`; Envelope only delivers to a public HTTPS address in production).

## Before you copy it

This example authenticates the browser with one random cookie. In your application, the session
endpoint must authorize the signed-in staff member and the business record before it issues a
session. See `docs/developers/embedded-editor.md`.
