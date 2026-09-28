import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type {
  AuthResponse,
  CreateApiKeyResponse,
  CreateWebhookEndpointResponse,
  WebhookDeliveryPage,
  WebhookEndpointSummary,
} from '@envelope/shared';
import { MAX_WEBHOOK_ENDPOINTS_PER_TENANT } from '@envelope/shared';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WEBHOOK_DELIVERY_QUEUE } from '../src/queue/queue.module';
import { WebhookQueueService } from '../src/webhooks/webhook-queue.service';
import {
  createTestApp,
  createTestWorker,
  type TestApp,
  type TestWorker,
  waitFor,
} from './helpers/app';
import { registerUser, type SignedInUser, uniqueEmail } from './helpers/auth';
import { ownerQuery, truncateAll } from './helpers/db';
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
    // See webhook-delivery.e2e.test.ts: a leftover job from a previous file
    // can otherwise be picked up by this file's fresh worker.
    await t.app.get<Queue>(getQueueToken(WEBHOOK_DELIVERY_QUEUE)).obliterate({ force: true });
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

  describe('tenant-wide delivery browsing (docs/18 workstream 8 step 8.4)', () => {
    // A dedicated app instance, with WEBHOOK_ALLOW_INSECURE_LOCAL_URLS set
    // before it boots, so a real local receiver can be used — the same
    // reason webhook-delivery.e2e.test.ts sets it for its whole file. The
    // outer describe's `t` must keep rejecting loopback URLs for its own
    // "refuses http and private/loopback/metadata addresses" test, so this
    // relaxation cannot be applied to that shared instance.
    let localApp: TestApp;
    let localWorker: TestWorker;

    beforeAll(async () => {
      process.env.WEBHOOK_ALLOW_INSECURE_LOCAL_URLS = 'true';
      localApp = await createTestApp();
      localWorker = await createTestWorker();
    });

    afterAll(async () => {
      delete process.env.WEBHOOK_ALLOW_INSECURE_LOCAL_URLS;
      await localWorker.close();
      await localApp.close();
    });

    it('pages, filters and reads one delivery by id, all scoped to this tenant', async () => {
      const receiver = http.createServer((_req, res) => {
        res.writeHead(200);
        res.end('{}');
      });
      await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', () => resolve()));
      const port = (receiver.address() as AddressInfo).port;
      try {
        const solo = await registerUser(localApp.http, {
          fullName: 'Browse Owner',
          organization: 'Browse Co',
        });
        const endpointA = await request(localApp.http)
          .post('/api/v1/webhooks')
          .set('Authorization', bearer(solo))
          .send({ url: `http://127.0.0.1:${port}/browse-a` })
          .expect(201);
        const endpointB = await request(localApp.http)
          .post('/api/v1/webhooks')
          .set('Authorization', bearer(solo))
          .send({ url: `http://127.0.0.1:${port}/browse-b` })
          .expect(201);
        const idA = (endpointA.body as CreateWebhookEndpointResponse).endpoint.id;
        const idB = (endpointB.body as CreateWebhookEndpointResponse).endpoint.id;
        const tenantId = solo.body.user.tenant.id;

        const queue = localApp.app.get(WebhookQueueService);
        const envelopeId = '11111111-1111-4111-8111-111111111111';
        await queue.enqueue(tenantId, 'envelope.sent', { envelopeId });
        await queue.enqueue(tenantId, 'recipient.signed', { envelopeId });
        await queue.enqueue(tenantId, 'envelope.voided', {
          envelopeId: '22222222-2222-4222-8222-222222222222',
        });

        // Poll the database, not the rate-limited HTTP route, while waiting
        // for the worker to finish all 6 deliveries — the same reason other
        // e2e files poll a local receiver or the database instead of the API.
        await waitFor(async () => {
          const rows = await ownerQuery<{ count: string }>(
            `SELECT count(*)::text AS count FROM "WebhookDelivery"
             WHERE "tenantId" = $1 AND status = 'SUCCEEDED'`,
            [tenantId],
          );
          return Number(rows.rows[0]?.count ?? 0) >= 6 ? true : undefined;
        }, 15_000);
        const allRes = await request(localApp.http)
          .get('/api/v1/webhooks/deliveries')
          .set('Authorization', bearer(solo))
          .expect(200);
        const all = allRes.body as WebhookDeliveryPage;
        expect(
          all.items.every(
            (item) => item.webhookEndpointId === idA || item.webhookEndpointId === idB,
          ),
        ).toBe(true);

        const firstPage = await request(localApp.http)
          .get('/api/v1/webhooks/deliveries?limit=2')
          .set('Authorization', bearer(solo))
          .expect(200);
        const page1 = firstPage.body as WebhookDeliveryPage;
        expect(page1.items).toHaveLength(2);
        expect(page1.nextCursor).toBeTruthy();
        const secondPage = await request(localApp.http)
          .get(
            `/api/v1/webhooks/deliveries?limit=2&cursor=${encodeURIComponent(page1.nextCursor ?? '')}`,
          )
          .set('Authorization', bearer(solo))
          .expect(200);
        const page2 = secondPage.body as WebhookDeliveryPage;
        expect(page2.items).toHaveLength(2);
        expect(page1.items.map((i) => i.id)).not.toEqual(page2.items.map((i) => i.id));

        const byEndpoint = await request(localApp.http)
          .get(`/api/v1/webhooks/deliveries?endpointId=${idA}`)
          .set('Authorization', bearer(solo))
          .expect(200);
        expect(
          (byEndpoint.body as WebhookDeliveryPage).items.every((i) => i.webhookEndpointId === idA),
        ).toBe(true);

        const byEnvelope = await request(localApp.http)
          .get(`/api/v1/webhooks/deliveries?envelopeId=${envelopeId}`)
          .set('Authorization', bearer(solo))
          .expect(200);
        const envelopeItems = (byEnvelope.body as WebhookDeliveryPage).items;
        expect(envelopeItems.length).toBe(4); // 2 events × 2 endpoints
        expect(envelopeItems.every((i) => i.envelopeId === envelopeId)).toBe(true);

        const byEventType = await request(localApp.http)
          .get('/api/v1/webhooks/deliveries?eventType=envelope.voided')
          .set('Authorization', bearer(solo))
          .expect(200);
        expect(
          (byEventType.body as WebhookDeliveryPage).items.every(
            (i) => i.eventType === 'envelope.voided',
          ),
        ).toBe(true);

        const oneEventId = all.items[0]?.eventId;
        const byEventId = await request(localApp.http)
          .get(`/api/v1/webhooks/deliveries?eventId=${oneEventId}`)
          .set('Authorization', bearer(solo))
          .expect(200);
        expect(
          (byEventId.body as WebhookDeliveryPage).items.every((i) => i.eventId === oneEventId),
        ).toBe(true);

        const byStatus = await request(localApp.http)
          .get('/api/v1/webhooks/deliveries?status=SUCCEEDED')
          .set('Authorization', bearer(solo))
          .expect(200);
        expect(
          (byStatus.body as WebhookDeliveryPage).items.every((i) => i.status === 'SUCCEEDED'),
        ).toBe(true);

        // Reads one delivery directly by id.
        const oneId = all.items[0]?.id ?? '';
        const single = await request(localApp.http)
          .get(`/api/v1/webhooks/deliveries/${oneId}`)
          .set('Authorization', bearer(solo))
          .expect(200);
        expect(single.body.id).toBe(oneId);

        // An outsider's tenant never sees this tenant's deliveries.
        const outsider = await registerUser(localApp.http, {
          fullName: 'Browse Outsider',
          organization: 'Outsider Co',
        });
        const outsiderList = await request(localApp.http)
          .get('/api/v1/webhooks/deliveries')
          .set('Authorization', bearer(outsider))
          .expect(200);
        expect((outsiderList.body as WebhookDeliveryPage).items).toHaveLength(0);
        const crossTenant = await request(localApp.http)
          .get(`/api/v1/webhooks/deliveries/${oneId}`)
          .set('Authorization', bearer(outsider));
        expect(crossTenant.status).toBe(404);
        expect(crossTenant.body.code).toBe('NOT_FOUND');
      } finally {
        await new Promise<void>((resolve) => receiver.close(() => resolve()));
      }
    });

    it('is refused to a MEMBER and to an API key', async () => {
      const member = await inviteMember('Browse Member');
      const memberAttempt = await request(t.http)
        .get('/api/v1/webhooks/deliveries')
        .set('Authorization', bearer(member));
      expect(memberAttempt.status).toBe(403);
      expect(memberAttempt.body.code).toBe('FORBIDDEN_ROLE');

      const key = await request(t.http)
        .post('/api/v1/api-keys')
        .set('Authorization', bearer(owner))
        .send({ label: 'Browse deliveries key' })
        .expect(201);
      const rawKey = (key.body as CreateApiKeyResponse).rawKey;
      const keyAttempt = await request(t.http)
        .get('/api/v1/webhooks/deliveries')
        .set('Authorization', `Bearer ${rawKey}`);
      expect(keyAttempt.status).toBe(403);
      expect(keyAttempt.body.code).toBe('API_KEY_NOT_ALLOWED');
    });

    it('refuses a malformed cursor', async () => {
      const bad = await request(t.http)
        .get('/api/v1/webhooks/deliveries?cursor=not-a-real-cursor')
        .set('Authorization', bearer(owner));
      expect(bad.status).toBe(400);
      expect(bad.body.code).toBe('BAD_REQUEST');
    });
  });
});
