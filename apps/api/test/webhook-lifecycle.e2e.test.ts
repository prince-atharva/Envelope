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
import { WebhookDeliveryPurgeService } from '../src/maintenance/webhook-delivery-purge.service';
import { WEBHOOK_DELIVERY_QUEUE } from '../src/queue/queue.module';
import { WebhookQueueService } from '../src/webhooks/webhook-queue.service';
import { signWebhookPayload } from '../src/webhooks/webhook-signature';
import {
  captureLogs,
  createTestApp,
  createTestWorker,
  type TestApp,
  type TestWorker,
  waitFor,
} from './helpers/app';
import { registerUser, type SignedInUser } from './helpers/auth';
import { ownerQuery, truncateAll } from './helpers/db';
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

  describe('secret rotation', () => {
    async function rotate(
      id: string,
      body?: { overlapHours?: number },
    ): Promise<CreateWebhookEndpointResponse> {
      const req = request(t.http)
        .post(`/api/v1/webhooks/${id}/rotate-secret`)
        .set('Authorization', bearer(owner));
      const res = await (body ? req.send(body) : req).expect(200);
      return res.body as CreateWebhookEndpointResponse;
    }

    async function sendEvent(): Promise<ReceivedRequest> {
      received = [];
      await t.app.get(WebhookQueueService).enqueue(owner.body.user.tenant.id, 'envelope.sent', {
        envelopeId: '00000000-0000-4000-8000-0000000000a1',
      });
      return waitFor(() => received.at(0));
    }

    function signatures(hit: ReceivedRequest): string[] {
      return String(hit.headers['x-signature']).split(',');
    }

    function expectedSignature(secret: string, hit: ReceivedRequest): string {
      return `sha256=${signWebhookPayload(secret, Number(hit.headers['x-signature-timestamp']), hit.body)}`;
    }

    it('signs with both secrets during the overlap window, current secret first', async () => {
      await deactivateAll();
      const created = await createEndpoint();
      const rotated = await rotate(created.endpoint.id, { overlapHours: 24 });

      expect(rotated.rawSecret).not.toBe(created.rawSecret);
      expect(rotated.endpoint.secretDisplayHint).toBe(rotated.rawSecret.slice(0, 12));
      expect(rotated.endpoint.secretRotatedAt).toBeTruthy();
      const closes = new Date(String(rotated.endpoint.previousSecretExpiresAt)).getTime();
      expect(closes).toBeGreaterThan(Date.now() + 23 * 3600 * 1000);
      expect(closes).toBeLessThan(Date.now() + 25 * 3600 * 1000);

      const hit = await sendEvent();
      expect(signatures(hit)).toEqual([
        expectedSignature(rotated.rawSecret, hit),
        expectedSignature(created.rawSecret, hit),
      ]);
    });

    it('signs with only the new secret when the overlap is 0', async () => {
      await deactivateAll();
      const created = await createEndpoint();
      const rotated = await rotate(created.endpoint.id, { overlapHours: 0 });
      expect(rotated.endpoint.previousSecretExpiresAt).toBeNull();

      const hit = await sendEvent();
      expect(signatures(hit)).toEqual([expectedSignature(rotated.rawSecret, hit)]);
      expect(signatures(hit)[0]).not.toBe(expectedSignature(created.rawSecret, hit));
    });

    it('defaults to a 24 hour window with no body, and rejects an overlap over 72 hours', async () => {
      await deactivateAll();
      const created = await createEndpoint();
      const rotated = await rotate(created.endpoint.id);
      const closes = new Date(String(rotated.endpoint.previousSecretExpiresAt)).getTime();
      expect(closes).toBeGreaterThan(Date.now() + 23 * 3600 * 1000);

      await request(t.http)
        .post(`/api/v1/webhooks/${created.endpoint.id}/rotate-secret`)
        .set('Authorization', bearer(owner))
        .send({ overlapHours: 73 })
        .expect(400);
      await request(t.http)
        .post(`/api/v1/webhooks/${created.endpoint.id}/rotate-secret`)
        .set('Authorization', bearer(owner))
        .send({ overlapHours: 24, extra: true })
        .expect(400);
    });

    it('drops the older secret when rotated again inside a window', async () => {
      await deactivateAll();
      const first = await createEndpoint();
      const second = await rotate(first.endpoint.id, { overlapHours: 24 });
      const third = await rotate(first.endpoint.id, { overlapHours: 24 });

      const hit = await sendEvent();
      expect(signatures(hit)).toEqual([
        expectedSignature(third.rawSecret, hit),
        expectedSignature(second.rawSecret, hit),
      ]);
    });

    it('stops signing with the old secret once the window has passed, and the purge clears it', async () => {
      await deactivateAll();
      const created = await createEndpoint();
      const rotated = await rotate(created.endpoint.id, { overlapHours: 24 });
      await ownerQuery(
        `UPDATE "WebhookEndpoint" SET "previousSecretExpiresAt" = now() - interval '1 minute' WHERE id = $1`,
        [created.endpoint.id],
      );

      const hit = await sendEvent();
      expect(signatures(hit)).toEqual([expectedSignature(rotated.rawSecret, hit)]);
      expect((await listEndpoints())[0]?.previousSecretExpiresAt).toBeNull();

      await worker.module.get(WebhookDeliveryPurgeService).run();
      const row = await ownerQuery<{ previousSecretCiphertext: string | null }>(
        `SELECT "previousSecretCiphertext" FROM "WebhookEndpoint" WHERE id = $1`,
        [created.endpoint.id],
      );
      expect(row.rows[0]?.previousSecretCiphertext).toBeNull();
    });

    it('is tenant-scoped, and never logs either secret', async () => {
      await deactivateAll();
      const created = await createEndpoint();
      const stranger = await registerUser(t.http, {
        fullName: 'Rotation Stranger',
        organization: 'Stranger Clinic',
      });
      await request(t.http)
        .post(`/api/v1/webhooks/${created.endpoint.id}/rotate-secret`)
        .set('Authorization', bearer(stranger))
        .send({ overlapHours: 1 })
        .expect(404);

      const logs = captureLogs();
      try {
        const rotated = await rotate(created.endpoint.id, { overlapHours: 1 });
        await sendEvent();
        expect(logs.find('Webhook secret rotated')).toHaveLength(1);
        expect(logs.text()).not.toContain(rotated.rawSecret);
        expect(logs.text()).not.toContain(created.rawSecret);
      } finally {
        logs.restore();
      }
    });
  });
});
