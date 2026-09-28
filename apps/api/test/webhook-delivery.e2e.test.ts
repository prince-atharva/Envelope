import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CreateWebhookEndpointResponse, WebhookDeliverySummary } from '@envelope/shared';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WEBHOOK_DELIVERY_QUEUE } from '../src/queue/queue.module';
import { WebhookQueueService } from '../src/webhooks/webhook-queue.service';
import { signWebhookPayload } from '../src/webhooks/webhook-signature';
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
 * The delivery pipeline itself (docs/08, "Webhooks"; docs/18): producer
 * enqueue, signing, retries, exhaustion and redrive. Exercises
 * `WebhookQueueService.enqueue` directly through the DI container rather
 * than through a real envelope action — the 8 real call sites are wired and
 * tested separately (docs/18 step 5).
 */
describe('webhook delivery pipeline (e2e)', () => {
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
    // A previous file's worker may not have finished every retry before its
    // own teardown; this queue's name and Redis prefix are shared across
    // e2e files, so a leftover job would otherwise be picked up here, racing
    // this file's own advisory locks and deliveries.
    await t.app.get<Queue>(getQueueToken(WEBHOOK_DELIVERY_QUEUE)).obliterate({ force: true });
    worker = await createTestWorker();
    owner = await registerUser(t.http, {
      fullName: 'Webhook Owner',
      organization: 'Webhook Clinic',
    });

    receiver = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        received.push({ headers: req.headers, body });
        const status = respondWith(received.length);
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', () => resolve()));
    const port = (receiver.address() as AddressInfo).port;
    receiverUrl = `http://127.0.0.1:${port}/hook`;
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

  /**
   * Deactivates every endpoint this owner already has before creating a new
   * one: `WebhookQueueService.enqueue` fans out to every *active* endpoint
   * subscribed to an event, so a previous test's still-active endpoint would
   * otherwise also receive this test's deliveries, corrupting the shared
   * `received`/`respondWith` state.
   */
  async function registerEndpoint(): Promise<CreateWebhookEndpointResponse> {
    const existing = await request(t.http)
      .get('/api/v1/webhooks')
      .set('Authorization', bearer(owner))
      .expect(200);
    for (const endpoint of existing.body as { id: string; isActive: boolean }[]) {
      if (endpoint.isActive) {
        await request(t.http)
          .delete(`/api/v1/webhooks/${endpoint.id}`)
          .set('Authorization', bearer(owner))
          .expect(200);
      }
    }

    const res = await request(t.http)
      .post('/api/v1/webhooks')
      .set('Authorization', bearer(owner))
      .send({ url: receiverUrl, subscribedEvents: ['envelope.sent'] })
      .expect(201);
    return res.body as CreateWebhookEndpointResponse;
  }

  async function deliveriesFor(endpointId: string): Promise<WebhookDeliverySummary[]> {
    const res = await request(t.http)
      .get(`/api/v1/webhooks/${endpointId}/deliveries`)
      .set('Authorization', bearer(owner))
      .expect(200);
    return res.body as WebhookDeliverySummary[];
  }

  it('delivers with a verifiable HMAC signature over the exact bytes sent', async () => {
    const { endpoint, rawSecret } = await registerEndpoint();
    const queue = t.app.get(WebhookQueueService);
    await queue.enqueue(owner.body.user.tenant.id, 'envelope.sent', {
      envelopeId: '00000000-0000-4000-8000-000000000001',
    });

    const delivery = await waitFor(() => received.at(0));
    const payload = JSON.parse(delivery.body) as {
      type: string;
      apiVersion: string;
      data: { envelopeId: string };
    };
    expect(payload.type).toBe('envelope.sent');
    expect(payload.apiVersion).toBe('v1');
    expect(payload.data.envelopeId).toBe('00000000-0000-4000-8000-000000000001');

    const timestamp = delivery.headers['x-signature-timestamp'];
    const signature = delivery.headers['x-signature'];
    expect(typeof timestamp).toBe('string');
    const expected = `sha256=${signWebhookPayload(rawSecret, Number(timestamp), delivery.body)}`;
    expect(signature).toBe(expected);

    // Delivery headers (docs/18 workstream 8, ADR 0018): a receiver can log
    // and deduplicate before parsing the body.
    expect(delivery.headers['user-agent']).toMatch(/^Envelope-Webhooks\//);
    expect(delivery.headers['x-envelope-event-id']).toBe(
      (JSON.parse(delivery.body) as { id: string }).id,
    );
    expect(delivery.headers['x-envelope-event-type']).toBe('envelope.sent');
    expect(delivery.headers['x-envelope-delivery-attempt']).toBe('1');
    expect(typeof delivery.headers['x-envelope-delivery-id']).toBe('string');

    const deliveries = await waitFor(async () => {
      const list = await deliveriesFor(endpoint.id);
      return list.find((d) => d.status === 'SUCCEEDED');
    });
    expect(deliveries.lastStatusCode).toBe(200);
    expect(deliveries.attempts).toBe(1);
    expect(deliveries.nextAttemptAt).toBeNull();
    expect(delivery.headers['x-envelope-delivery-id']).toBe(deliveries.id);
  });

  it('retries a failing endpoint and succeeds once it recovers', async () => {
    const { endpoint } = await registerEndpoint();
    respondWith = (attempt) => (attempt === 1 ? 500 : 200);
    const queue = t.app.get(WebhookQueueService);
    await queue.enqueue(owner.body.user.tenant.id, 'envelope.sent', {
      envelopeId: '00000000-0000-4000-8000-000000000002',
    });

    // While the first attempt's retry is pending, nextAttemptAt is set —
    // an admin can see when the next try is scheduled, not just that one
    // failed.
    const failedOnce = await waitFor(async () => {
      const list = await deliveriesFor(endpoint.id);
      return list.find((d) => d.status === 'FAILED');
    });
    expect(failedOnce.nextAttemptAt).toBeTruthy();

    const succeeded = await waitFor(async () => {
      const list = await deliveriesFor(endpoint.id);
      return list.find((d) => d.status === 'SUCCEEDED');
    }, 15_000);
    expect(succeeded.attempts).toBe(2);
    expect(succeeded.nextAttemptAt).toBeNull();
    expect(received.length).toBe(2);
    // The second, successful attempt reports its own real ordinal.
    expect(received[1]?.headers['x-envelope-delivery-attempt']).toBe('2');
  });

  it('exhausts after every attempt fails, then delivers once redriven — attempts keep counting across the redrive', async () => {
    const { endpoint } = await registerEndpoint();
    respondWith = () => 500;
    const queue = t.app.get(WebhookQueueService);
    await queue.enqueue(owner.body.user.tenant.id, 'envelope.sent', {
      envelopeId: '00000000-0000-4000-8000-000000000003',
    });

    // 7 total attempts (docs/18 workstream 8): BullMQ's `attempts` counts the
    // first try as one of them, so the 6-entry documented delay schedule
    // needs one more than its own length to run every delay, including the
    // last (12h in production; the test schedule is overridden to
    // milliseconds — apps/api/test/test-env.ts).
    const exhausted = await waitFor(async () => {
      const list = await deliveriesFor(endpoint.id);
      return list.find((d) => d.status === 'EXHAUSTED');
    }, 15_000);
    expect(exhausted.attempts).toBe(7);
    expect(exhausted.lastError).toContain('500');
    expect(exhausted.nextAttemptAt).toBeNull();

    respondWith = () => 200;
    await request(t.http)
      .post(`/api/v1/webhooks/${exhausted.id}/redrive`)
      .set('Authorization', bearer(owner))
      .expect(200);

    const redelivered = await waitFor(async () => {
      const list = await deliveriesFor(endpoint.id);
      const match = list.find((d) => d.id === exhausted.id);
      return match?.status === 'SUCCEEDED' ? match : undefined;
    }, 15_000);
    // Not reset to 1: the delivery's lifetime count keeps counting past the
    // 7 attempts it already made before redrive.
    expect(redelivered.attempts).toBe(8);
  });

  it('refuses to redrive a delivery that is still pending or already succeeded', async () => {
    const { endpoint } = await registerEndpoint();
    const queue = t.app.get(WebhookQueueService);
    await queue.enqueue(owner.body.user.tenant.id, 'envelope.sent', {
      envelopeId: '00000000-0000-4000-8000-000000000004',
    });
    const succeeded = await waitFor(async () => {
      const list = await deliveriesFor(endpoint.id);
      return list.find((d) => d.status === 'SUCCEEDED');
    });

    const attempt = await request(t.http)
      .post(`/api/v1/webhooks/${succeeded.id}/redrive`)
      .set('Authorization', bearer(owner));
    expect(attempt.status).toBe(409);
    expect(attempt.body.code).toBe('WEBHOOK_DELIVERY_NOT_REDRIVABLE');
  });

  it('does not deliver to an endpoint that is not subscribed to the event', async () => {
    await registerEndpoint(); // subscribed to envelope.sent only
    const queue = t.app.get(WebhookQueueService);
    await queue.enqueue(owner.body.user.tenant.id, 'recipient.signed', {
      envelopeId: '00000000-0000-4000-8000-000000000005',
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(received).toHaveLength(0);
  });
});
