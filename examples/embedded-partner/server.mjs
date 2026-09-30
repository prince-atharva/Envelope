// A complete, runnable partner application for Envelope's embedded sender editor.
// No dependencies and no build step: Node 22+, and one <script> tag for the SDK.
//
//   ENVELOPE_URL=https://envelope.example ENVELOPE_API_KEY=... node server.mjs
//
// The API key stays on this server. The browser only ever receives a one-time launch credential.

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

/**
 * @param {{
 *   envelopeUrl: string,
 *   apiKey: string,
 *   envelopeId?: string,
 *   webhookSecret?: string,
 *   actorId?: string,
 * }} options
 */
export function createPartnerApp(options) {
  const envelopeUrl = new URL(options.envelopeUrl).origin;
  const api = `${envelopeUrl}/api/v1`;
  const authorization = { Authorization: `Bearer ${options.apiKey}` };
  // A real application authenticates its own staff here. This example uses one random cookie.
  const cookie = `partner_session=${randomUUID()}`;
  const state = {
    origin: '',
    webhookSecret: options.webhookSecret ?? '',
    envelopeId: options.envelopeId,
    /** Every session issued, so they can be revoked on shutdown. */
    sessions: /** @type {string[]} */ ([]),
    /** Webhook events by delivery id; a retry of the same delivery is stored once. */
    events: /** @type {Map<string, any>} */ (new Map()),
  };

  const signedIn = (req) => req.headers.cookie === cookie;
  const readBody = async (req) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    return raw;
  };
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
    res.end(body);
  };

  function verifyWebhook(req, raw) {
    const timestamp = req.headers['x-signature-timestamp'];
    const signature = req.headers['x-signature'];
    if (typeof timestamp !== 'string' || !/^\d+$/.test(timestamp)) return false;
    // Reject old deliveries so a captured request cannot be replayed later.
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
    if (typeof signature !== 'string' || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
    const expected = createHmac('sha256', state.webhookSecret)
      .update(`${timestamp}.${raw}`)
      .digest();
    return timingSafeEqual(Buffer.from(signature.slice(7), 'hex'), expected);
  }

  async function issueSession() {
    const result = await fetch(`${api}/embed/sessions`, {
      method: 'POST',
      headers: { ...authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Reopen the draft once we know it, otherwise let staff upload inside the editor.
        ...(state.envelopeId
          ? { mode: 'existing', envelopeId: state.envelopeId }
          : { mode: 'upload' }),
        parentOrigin: state.origin,
        externalActorId: options.actorId ?? 'staff:demo',
        actions: ['edit', 'send'],
      }),
    });
    const body = await result.text();
    if (result.ok) state.sessions.push(JSON.parse(body).sessionId);
    return { status: result.status, body };
  }

  const page = () => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Partner document</title></head>
<body style="margin:0;font-family:system-ui">
<h1>Partner document</h1>
<button id="open">Prepare for signing</button>
<button id="close">Save and close</button>
<div id="events" role="status"></div>
<div id="editor" style="height:1000px"></div>
<!-- The whole SDK: one file served by Envelope, no npm install, no build step. -->
<script src="${envelopeUrl}/api/v1/embed/sdk/v1/envelope.js"></script>
<script>
let editor;
document.getElementById('open').onclick = async () => {
  editor?.destroy();
  const session = await (await fetch('/session', { method: 'POST' })).json();
  editor = EnvelopeEmbed.createEnvelopeEditor({
    container: document.getElementById('editor'),
    frameUrl: session.frameUrl,
    launchToken: session.launchToken,
    onEvent: (event) => {
      document.getElementById('events').textContent = event.type;
      // Event ids are hints. Your backend re-reads the envelope with its own key before trusting one.
      if (event.type === 'draft.created')
        fetch('/mapping', { method: 'POST', body: JSON.stringify({ envelopeId: event.envelopeId }) });
      if (event.type === 'close') editor.destroy();
    },
  });
};
document.getElementById('close').onclick = () => editor?.requestClose();
</script>
</body></html>`;

  const server = createServer((req, res) => {
    void (async () => {
      const route = `${req.method} ${req.url}`;
      if (route === 'POST /webhook') {
        const raw = await readBody(req);
        if (!state.webhookSecret || !verifyWebhook(req, raw)) return send(res, 401, '');
        const event = JSON.parse(raw);
        state.events.set(event.id, event);
        return send(res, 204, '');
      }
      if (route === 'GET /') {
        return send(res, 200, page(), {
          'Content-Type': 'text/html',
          'Set-Cookie': `${cookie}; HttpOnly; SameSite=Strict; Path=/`,
        });
      }
      if (route === 'POST /session') {
        if (!signedIn(req)) return send(res, 401, '');
        const { status, body } = await issueSession();
        return send(res, status, body, { 'Content-Type': 'application/json' });
      }
      if (route === 'POST /mapping') {
        if (!signedIn(req)) return send(res, 401, '');
        const candidate = JSON.parse(await readBody(req)).envelopeId;
        // Never trust an id from the browser: ask Envelope, with the server-side key.
        const verified = await fetch(`${api}/envelopes/${encodeURIComponent(candidate)}`, {
          headers: authorization,
        });
        if (!verified.ok) return send(res, 403, '');
        state.envelopeId = candidate;
        return send(res, 204, '');
      }
      if (route === 'GET /events') {
        if (!signedIn(req)) return send(res, 401, '');
        const list = [...state.events.values()].map(({ id, type }) => ({ id, type }));
        return send(res, 200, JSON.stringify(list), { 'Content-Type': 'application/json' });
      }
      return send(res, 404, '');
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  return {
    state,
    setWebhookSecret(secret) {
      state.webhookSecret = secret;
    },
    /** Resolves to the origin to register on the API key (`PUT /api-keys/:id/embed-origins`). */
    async listen({ port = 0, host = '127.0.0.1', origin } = {}) {
      await new Promise((resolve) => server.listen(port, host, resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Did not bind');
      state.origin = origin ?? `http://${host}:${address.port}`;
      return state.origin;
    },
    async close() {
      try {
        for (const id of state.sessions)
          await fetch(`${api}/embed/sessions/${id}`, { method: 'DELETE', headers: authorization });
      } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { ENVELOPE_URL, ENVELOPE_API_KEY, ENVELOPE_ID, WEBHOOK_SECRET, PORT, PUBLIC_ORIGIN } =
    process.env;
  if (!ENVELOPE_URL || !ENVELOPE_API_KEY) {
    console.error('Set ENVELOPE_URL and ENVELOPE_API_KEY (see README.md).');
    process.exit(1);
  }
  const app = createPartnerApp({
    envelopeUrl: ENVELOPE_URL,
    apiKey: ENVELOPE_API_KEY,
    envelopeId: ENVELOPE_ID,
    webhookSecret: WEBHOOK_SECRET,
  });
  const port = Number(PORT ?? 3000);
  const origin = await app.listen({
    port,
    host: '127.0.0.1',
    origin: PUBLIC_ORIGIN ?? `http://localhost:${port}`,
  });
  process.stdout.write(`Partner example: ${origin}\nRegister that origin on the API key.\n`);
  process.on('SIGINT', () => void app.close().then(() => process.exit(0)));
}
