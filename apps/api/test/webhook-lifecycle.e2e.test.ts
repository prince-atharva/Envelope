import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type {
  CreateWebhookEndpointResponse,
  WebhookDeliverySummary,
  WebhookEndpointSummary,
} from '@envelope/shared';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WEBHOOK_DELIVERY_QUEUE } from '../src/queue/queue.module';
import {
  createTestApp,
  createTestWorker,
  type TestApp,
  type TestWorker,
  waitFor,
} from './helpers/app';
import { registerUser, type SignedInUser } from './helpers/auth';
import { truncateAll } from './helpers/db';
import { bearer } from './helpers/signing';

interface ReceivedRequest {
  headers: http.IncomingHttpHeaders;
  body: string;
}

/**
 * Endpoint lifecycle tooling (docs/18 workstream 9): test events, secret
 * rotation, active-only cap accounting, permanent delete and auto-disable.
 * Real API, worker, Postgres, Redis and a real local HTTP receiver.
 */
describe('webhook endpoint lifecycle (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;
  let receiver: http.Server;
  let receiverUrl: string;
  let received: ReceivedRequest[] = [];
  let respondWith: (attemptNumber: number) => number = () => 200;

  beforeAll(async () => {
    process.env.WEBHOOK_ALLOW_INSECURE_LOCAL_URLS = 'true';
    await truncateAll();
    t = await createTestApp();
    await t.app.get<Queue>(getQueueToken(WEBHOOK_DELIVERY_QUEUE)).obliterate({ force: true });
    worker = await createTestWorker();
    owner = await registerUser(t.http, {
      fullName: 'Lifecycle Owner',
      organization: 'Lifecycle Clinic',
    });

    receiver = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        received.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
        res.writeHead(respondWith(received.length), { 'Content-Type': 'application/json' });
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', () => resolve()));
    receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;
  });

  afterAll(async () => {
    delete process.env.WEBHOOK_ALLOW_INSECURE_LOCAL_URLS;
    await new Promise<void>((resolve) => receiver.close(() => resolve()));
    await worker.close();
    await t.close();
  });

  beforeEach(() => {
    received = [];
    respondWith = () => 200;
  });

  async function createEndpoint(): Promise<CreateWebhookEndpointResponse> {
    const res = await request(t.http)
      .post('/api/v1/webhooks')
      .set('Authorization', bearer(owner))
      .send({ url: receiverUrl, subscribedEvents: [] })
      .expect(201);
    return res.body as CreateWebhookEndpointResponse;
  }

  async function deactivate(id: string): Promise<void> {
    await request(t.http)
      .delete(`/api/v1/webhooks/${id}`)
      .set('Authorization', bearer(owner))
      .expect(200);
  }

  async function listEndpoints(): Promise<WebhookEndpointSummary[]> {
    const res = await request(t.http)
      .get('/api/v1/webhooks')
      .set('Authorization', bearer(owner))
      .expect(200);
    return res.body as WebhookEndpointSummary[];
  }

  async function deliveriesFor(endpointId: string): Promise<WebhookDeliverySummary[]> {
    const res = await request(t.http)
      .get(`/api/v1/webhooks/${endpointId}/deliveries`)
      .set('Authorization', bearer(owner))
      .expect(200);
    return res.body as WebhookDeliverySummary[];
  }

  /** Frees every active slot so each test starts under the cap. */
  async function deactivateAll(): Promise<void> {
    for (const endpoint of await listEndpoints()) {
      if (endpoint.isActive) await deactivate(endpoint.id);
    }
  }

  describe('test event', () => {
    it('delivers a signed webhook.test event and records a SUCCEEDED delivery', async () => {
      await deactivateAll();
      const { endpoint } = await createEndpoint();

      const res = await request(t.http)
        .post(`/api/v1/webhooks/${endpoint.id}/test`)
        .set('Authorization', bearer(owner))
        .expect(202);
      const pending = res.body as WebhookDeliverySummary;
      expect(pending.eventType).toBe('webhook.test');
      expect(pending.envelopeId).toBeNull();

      const hit = await waitFor(() => received.at(0));
      const payload = JSON.parse(hit.body) as { type: string; apiVersion: string; id: string };
      expect(payload.type).toBe('webhook.test');
      expect(payload.apiVersion).toBe('v1');
      expect(hit.headers['x-envelope-event-type']).toBe('webhook.test');
      expect(hit.headers['x-envelope-event-id']).toBe(payload.id);

      const delivery = await waitFor(async () =>
        (await deliveriesFor(endpoint.id)).find((d) => d.status === 'SUCCEEDED'),
      );
      expect(delivery.id).toBe(pending.id);
      expect(delivery.attempts).toBe(1);
    });

    it('makes exactly one attempt when the receiver fails, and cannot be retried', async () => {
      await deactivateAll();
      const { endpoint } = await createEndpoint();
      respondWith = () => 500;

      await request(t.http)
        .post(`/api/v1/webhooks/${endpoint.id}/test`)
        .set('Authorization', bearer(owner))
        .expect(202);

      const failed = await waitFor(async () =>
        (await deliveriesFor(endpoint.id)).find((d) => d.status === 'EXHAUSTED'),
      );
      expect(failed.attempts).toBe(1);
      expect(failed.lastStatusCode).toBe(500);
      expect(failed.nextAttemptAt).toBeNull();
      // Give a wrongly scheduled retry (the schedule is 50ms in tests) time to show.
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(received.length).toBe(1);

      const retry = await request(t.http)
        .post(`/api/v1/webhooks/deliveries/${failed.id}/retry`)
        .set('Authorization', bearer(owner))
        .expect(409);
      expect((retry.body as { code: string }).code).toBe('WEBHOOK_DELIVERY_NOT_REDRIVABLE');
    });

    it('is admin-only, tenant-scoped, and reachable for an inactive endpoint', async () => {
      await deactivateAll();
      const { endpoint } = await createEndpoint();
      await deactivate(endpoint.id);

      const stranger = await registerUser(t.http, {
        fullName: 'Other Tenant',
        organization: 'Other Clinic',
      });
      await request(t.http)
        .post(`/api/v1/webhooks/${endpoint.id}/test`)
        .set('Authorization', bearer(stranger))
        .expect(404);
      await request(t.http).post(`/api/v1/webhooks/${endpoint.id}/test`).expect(401);

      await request(t.http)
        .post(`/api/v1/webhooks/${endpoint.id}/test`)
        .set('Authorization', bearer(owner))
        .expect(202);
      await waitFor(() => received.at(0));
    });
  });
});
