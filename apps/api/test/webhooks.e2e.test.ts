import type {
  AuthResponse,
  CreateWebhookEndpointResponse,
  WebhookEndpointSummary,
} from '@envelope/shared';
import { MAX_WEBHOOK_ENDPOINTS_PER_TENANT } from '@envelope/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createTestWorker,
  type TestApp,
  type TestWorker,
  waitFor,
} from './helpers/app';
import { registerUser, type SignedInUser, uniqueEmail } from './helpers/auth';
import { truncateAll } from './helpers/db';
import { bearer } from './helpers/signing';

const INVITE_LINK = /\/accept-invite\/([0-9a-f]{64})/;

/** Webhook endpoint registration (docs/08, "Webhooks"; docs/18). */
describe('webhooks (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    worker = await createTestWorker();
    owner = await registerUser(t.http, { fullName: 'Hook Owner', organization: 'Hook Clinic' });
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
  });

  async function inviteMember(fullName: string): Promise<SignedInUser> {
    const email = uniqueEmail('member');
    await request(t.http)
      .post('/api/v1/users')
      .set('Authorization', bearer(owner))
      .send({ fullName, email, role: 'MEMBER' })
      .expect(201);
    const message = await waitFor(() =>
      worker.mailbox.messages.filter((m) => m.to === email && m.template === 'user-invited').at(-1),
    );
    const token = INVITE_LINK.exec(message.text)?.[1];
    if (!token) throw new Error('no invite link in the email');
    const accepted = await request(t.http)
      .post(`/api/v1/auth/invitations/${token}/accept`)
      .send({ password: 'a fresh chosen password' })
      .expect(200);
    const body = accepted.body as AuthResponse;
    return {
      email,
      password: 'a fresh chosen password',
      accessToken: body.accessToken,
      cookie: '',
      body,
    };
  }

  it('registers an endpoint, shows the secret once, then lists it without the secret', async () => {
    const created = await request(t.http)
      .post('/api/v1/webhooks')
      .set('Authorization', bearer(owner))
      .send({ url: 'https://93.184.216.34/receive', description: 'HealthProHub' })
      .expect(201);
    const body = created.body as CreateWebhookEndpointResponse;
    expect(body.rawSecret).toMatch(/^whsec_/);
    expect(body.endpoint.isActive).toBe(true);
    expect(body.endpoint.subscribedEvents).toEqual([]);

    const listed = await request(t.http)
      .get('/api/v1/webhooks')
      .set('Authorization', bearer(owner))
      .expect(200);
    const endpoints = listed.body as WebhookEndpointSummary[];
    const match = endpoints.find((e) => e.id === body.endpoint.id);
    expect(match).toBeDefined();
    expect(JSON.stringify(match)).not.toContain(body.rawSecret);
  });

  it('refuses http and private/loopback/metadata addresses', async () => {
    for (const url of [
      'http://93.184.216.34/receive',
      'https://localhost/receive',
      'https://127.0.0.1/receive',
      'https://169.254.169.254/receive',
    ]) {
      const attempt = await request(t.http)
        .post('/api/v1/webhooks')
        .set('Authorization', bearer(owner))
        .send({ url });
      expect(attempt.status).toBe(422);
      expect(attempt.body.code).toBe('WEBHOOK_URL_NOT_ALLOWED');
    }
  });

  it('updates and deactivates an endpoint; deactivating twice is a no-op', async () => {
    const created = await request(t.http)
      .post('/api/v1/webhooks')
      .set('Authorization', bearer(owner))
      .send({ url: 'https://93.184.216.34/toggle', subscribedEvents: ['envelope.sent'] })
      .expect(201);
    const id = (created.body as CreateWebhookEndpointResponse).endpoint.id;

    const updated = await request(t.http)
      .patch(`/api/v1/webhooks/${id}`)
      .set('Authorization', bearer(owner))
      .send({ subscribedEvents: ['envelope.sent', 'envelope.completed'] })
      .expect(200);
    expect((updated.body as WebhookEndpointSummary).subscribedEvents).toEqual([
      'envelope.sent',
      'envelope.completed',
    ]);

    const deactivated = await request(t.http)
      .delete(`/api/v1/webhooks/${id}`)
      .set('Authorization', bearer(owner))
      .expect(200);
    expect((deactivated.body as WebhookEndpointSummary).isActive).toBe(false);

    const again = await request(t.http)
      .delete(`/api/v1/webhooks/${id}`)
      .set('Authorization', bearer(owner))
      .expect(200);
    expect((again.body as WebhookEndpointSummary).isActive).toBe(false);
  });

  it('lists an endpoint’s deliveries (empty before anything has fired)', async () => {
    const created = await request(t.http)
      .post('/api/v1/webhooks')
      .set('Authorization', bearer(owner))
      .send({ url: 'https://93.184.216.34/deliveries' })
      .expect(201);
    const id = (created.body as CreateWebhookEndpointResponse).endpoint.id;

    const deliveries = await request(t.http)
      .get(`/api/v1/webhooks/${id}/deliveries`)
      .set('Authorization', bearer(owner))
      .expect(200);
    expect(deliveries.body).toEqual([]);
  });

  it('caps the number of endpoints per tenant', async () => {
    const solo = await registerUser(t.http, { fullName: 'Cap Owner', organization: 'Cap Co' });
    for (let i = 0; i < MAX_WEBHOOK_ENDPOINTS_PER_TENANT; i++) {
      await request(t.http)
        .post('/api/v1/webhooks')
        .set('Authorization', bearer(solo))
        .send({ url: `https://93.184.216.34/cap-${i}` })
        .expect(201);
    }
    const overLimit = await request(t.http)
      .post('/api/v1/webhooks')
      .set('Authorization', bearer(solo))
      .send({ url: 'https://93.184.216.34/cap-over' });
    expect(overLimit.status).toBe(409);
    expect(overLimit.body.code).toBe('WEBHOOK_ENDPOINT_LIMIT_REACHED');
  });

  it('refuses a MEMBER on every webhook route', async () => {
    const member = await inviteMember('Hook Member');
    await request(t.http)
      .post('/api/v1/webhooks')
      .set('Authorization', bearer(member))
      .send({ url: 'https://93.184.216.34/member' })
      .expect(403);
    await request(t.http).get('/api/v1/webhooks').set('Authorization', bearer(member)).expect(403);
  });
});
