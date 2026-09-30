import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import { createPartnerApp } from '../../../examples/embedded-partner/server.mjs';
import { WEB_URL } from './stack/stack.mjs';

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
  // The partner application is the published example itself (examples/embedded-partner), so the
  // suite proves what a partner would actually copy.
  const app = createPartnerApp({
    envelopeUrl: WEB_URL,
    apiKey: rawKey,
    envelopeId,
    actorId: 'staff:fixture',
  });
  const origin = await app.listen();
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
  app.setWebhookSecret((await webhook.json()).rawSecret);
  return {
    origin,
    events: app.state.events,
    sessions: app.state.sessions,
    get envelopeId() {
      return app.state.envelopeId;
    },
    backendHeaders,
    manage,
    async close() {
      try {
        await app.close();
      } finally {
        await request.delete(`${WEB_URL}/api/v1/api-keys/${apiKey.id}`, { headers: manage });
      }
    },
  };
}
