import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import { WEB_OUT_DIR, WEB_URL } from './stack/stack.mjs';

/** Real isolated partner backend; its browser never receives the permanent API key. */
export async function createEmbedHost(request: APIRequestContext, mode: 'existing' | 'upload') {
  const registered = await request.post(`${WEB_URL}/api/v1/auth/register`, {
    data: {
      fullName: 'Partner Staff',
      email: `embed-${randomUUID()}@example.test`,
      password: 'isolated host password 123',
      organization: 'Embedded Clinic',
    },
  });
  if (!registered.ok()) throw new Error('Partner registration failed');
  const manage = { Authorization: `Bearer ${(await registered.json()).accessToken}` };
  const created = await request.post(`${WEB_URL}/api/v1/api-keys`, {
    headers: manage,
    data: { label: 'Isolated partner' },
  });
  const { rawKey, apiKey } = await created.json();
  const backendHeaders = { Authorization: `Bearer ${rawKey}` };
  let envelopeId: string | undefined;
  if (mode === 'existing') {
    const upload = await request.post(`${WEB_URL}/api/v1/envelopes`, {
      headers: backendHeaders,
      multipart: {
        file: {
          name: 'existing.pdf',
          mimeType: 'application/pdf',
          buffer: await readFile(path.resolve('e2e/fixtures/demo-agreement.pdf')),
        },
      },
    });
    if (!upload.ok()) throw new Error('Partner upload failed');
    envelopeId = (await upload.json()).id;
  }
  const cookie = `hph_test=${randomUUID()}`;
  let origin = '';
  let secret = '';
  const sessions: string[] = [];
  const events = new Map<string, { type: string; data: { envelopeId: string } }>();
  const manifest = JSON.parse(
    await readFile(path.join(WEB_OUT_DIR, '.vite/manifest.json'), 'utf8'),
  ) as Record<string, { file: string }>;
  const sdk = Object.entries(manifest).find(([name]) =>
    name.endsWith('packages/embed/src/index.ts'),
  )?.[1].file;
  if (!sdk) throw new Error('Build must include the SDK entry');
  const server = createServer((req, res) => {
    void (async () => {
      if (req.url === '/webhook') {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const timestamp = req.headers['x-signature-timestamp'];
        const signature = req.headers['x-signature'];
        const expected = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest();
        const presented =
          typeof signature === 'string' && /^sha256=[a-f0-9]{64}$/.test(signature)
            ? Buffer.from(signature.slice(7), 'hex')
            : Buffer.alloc(0);
        if (
          typeof timestamp !== 'string' ||
          !/^\d+$/.test(timestamp) ||
          Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
          presented.length !== expected.length ||
          !timingSafeEqual(presented, expected)
        ) {
          res.writeHead(401).end();
          return;
        }
        const event = JSON.parse(raw);
        events.set(event.id, event);
        res.writeHead(204).end();
        return;
      }
      if (req.url?.startsWith('/assets/')) {
        const name = req.url.slice(8);
        if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/javascript' });
        res.end(await readFile(path.join(WEB_OUT_DIR, 'assets', name)));
        return;
      }
      if (req.url === '/session' && req.method === 'POST') {
        if (req.headers.cookie !== cookie) {
          res.writeHead(401).end();
          return;
        }
        const result = await request.post(`${WEB_URL}/api/v1/embed/sessions`, {
          headers: backendHeaders,
          data: {
            mode: envelopeId ? 'existing' : mode,
            ...(envelopeId ? { envelopeId } : {}),
            parentOrigin: origin,
            externalActorId: 'staff:fixture',
            actions: ['edit', 'send'],
          },
        });
        const session = await result.json();
        if (result.ok()) sessions.push(session.sessionId);
        res.writeHead(result.status(), {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(session));
        return;
      }
      if (req.url === '/mapping' && req.method === 'POST') {
        if (req.headers.cookie !== cookie) {
          res.writeHead(401).end();
          return;
        }
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const candidate = JSON.parse(raw).envelopeId;
        const verified = await request.get(`${WEB_URL}/api/v1/envelopes/${candidate}`, {
          headers: backendHeaders,
        });
        if (!verified.ok()) {
          res.writeHead(403).end();
          return;
        }
        envelopeId = candidate;
        res.writeHead(204).end();
        return;
      }
      if (req.url !== '/') {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Set-Cookie': `${cookie}; HttpOnly; SameSite=Strict; Path=/`,
        'Cache-Control': 'no-store',
      });
      res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>HealthProHub test host</title></head><body style="margin:0;font-family:system-ui"><h1>HealthProHub document</h1><button id="open">Prepare for signing</button><button id="close">Save and close</button><div id="events" role="status"></div><div id="editor" style="height:1000px"></div><script type="module">
import { createEnvelopeEditor } from '/${sdk}';
let editor;
document.getElementById('open').onclick=async()=>{
  editor?.destroy(); let session=await(await fetch('/session',{method:'POST'})).json();
  editor=createEnvelopeEditor({container:document.getElementById('editor'),frameUrl:session.frameUrl,launchToken:session.launchToken,onEvent:event=>{
    document.getElementById('events').textContent=event.type;
    if(event.type==='draft.created') fetch('/mapping',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({envelopeId:event.envelopeId})});
    if(event.type==='close') editor.destroy();
  }}); session=null;
};
document.getElementById('close').onclick=()=>editor?.requestClose();
</script></body></html>`);
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Host did not bind');
  origin = `http://127.0.0.1:${address.port}`;
  // Origins belong to the issuing key, not the tenant (docs/18 workstream 7,
  // ADR 0017); the human management bearer sets them after the server
  // (and so its own origin) exists.
  const allowed = await request.put(`${WEB_URL}/api/v1/api-keys/${apiKey.id}/embed-origins`, {
    headers: manage,
    data: { origins: [origin] },
  });
  if (!allowed.ok()) throw new Error('Origin setup failed');
  const webhook = await request.post(`${WEB_URL}/api/v1/webhooks`, {
    headers: manage,
    data: { url: `${origin}/webhook`, subscribedEvents: ['envelope.completed'] },
  });
  if (!webhook.ok()) throw new Error('Webhook setup failed');
  secret = (await webhook.json()).rawSecret;
  return {
    origin,
    events,
    sessions,
    get envelopeId() {
      return envelopeId;
    },
    backendHeaders,
    manage,
    async close() {
      try {
        for (const id of sessions)
          await request.delete(`${WEB_URL}/api/v1/embed/sessions/${id}`, {
            headers: backendHeaders,
          });
        await request.delete(`${WEB_URL}/api/v1/api-keys/${apiKey.id}`, { headers: manage });
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  };
}
