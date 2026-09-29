import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type {
  AuthResponse,
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
import { registerUser, type SignedInUser, uniqueEmail } from './helpers/auth';
import { ownerQuery, truncateAll } from './helpers/db';
import { bearer, emailsTo } from './helpers/signing';

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

  // A fresh workspace per test: request limits are per tenant, and each test
  // then starts with no endpoints, deliveries or in-flight jobs of its own.
  beforeEach(async () => {
    received = [];
    respondWith = () => 200;
    owner = await registerUser(t.http, {
      fullName: 'Lifecycle Owner',
      organization: `Lifecycle Clinic ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
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

  describe('endpoint cap and permanent delete', () => {
    function as(
      user: SignedInUser,
      method: 'post' | 'patch' | 'delete',
      path: string,
      body?: object,
    ) {
      const req = request(t.http)
        [method](`/api/v1/webhooks${path}`)
        .set('Authorization', bearer(user));
      return body ? req.send(body) : req;
    }

    async function newTenant(name: string): Promise<SignedInUser> {
      return registerUser(t.http, { fullName: name, organization: `${name} Clinic` });
    }

    function createFor(user: SignedInUser, path = 'a') {
      return as(user, 'post', '', { url: `https://93.184.216.34/${path}` });
    }

    it('counts only active endpoints toward the cap of five', async () => {
      const user = await newTenant('Active Cap');
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const res = await createFor(user, `cap-${i}`).expect(201);
        ids.push((res.body as CreateWebhookEndpointResponse).endpoint.id);
      }
      const sixth = await createFor(user, 'cap-6').expect(409);
      expect((sixth.body as { code: string }).code).toBe('WEBHOOK_ENDPOINT_LIMIT_REACHED');

      // Deactivating frees a slot, which used to stay used forever.
      await as(user, 'delete', `/${ids[0]}`).expect(200);
      await createFor(user, 'cap-6').expect(201);

      // Reactivating takes a slot back, so it faces the cap too.
      const blocked = await as(user, 'patch', `/${ids[0]}`, { isActive: true }).expect(409);
      expect((blocked.body as { code: string }).code).toBe('WEBHOOK_ENDPOINT_LIMIT_REACHED');
      await as(user, 'delete', `/${ids[1]}`).expect(200);
      const reactivated = await as(user, 'patch', `/${ids[0]}`, { isActive: true }).expect(200);
      expect((reactivated.body as WebhookEndpointSummary).isActive).toBe(true);

      // Editing an already-active endpoint is not a reactivation.
      await as(user, 'patch', `/${ids[2]}`, { isActive: true, description: 'still fine' }).expect(
        200,
      );
    });

    it('lets only one of several simultaneous creates take the last slot', async () => {
      const user = await newTenant('Race Cap');
      for (let i = 0; i < 4; i++) await createFor(user, `race-${i}`).expect(201);

      const results = await Promise.all(
        [0, 1, 2, 3].map((i) => createFor(user, `race-x${i}`).then((r) => r.status)),
      );
      expect(results.filter((status) => status === 201)).toHaveLength(1);
      expect(results.filter((status) => status === 409)).toHaveLength(3);
    });

    it('stops at twenty saved endpoints until one is deleted permanently', async () => {
      const user = await newTenant('Total Cap');
      const first = await createFor(user, 'total').expect(201);
      const firstId = (first.body as CreateWebhookEndpointResponse).endpoint.id;
      await as(user, 'delete', `/${firstId}`).expect(200);
      await ownerQuery(
        `INSERT INTO "WebhookEndpoint"
           (id, "tenantId", url, "secretCiphertext", "secretDisplayHint", "subscribedEvents",
            "isActive", "createdByUserId", "createdAt", "updatedAt")
         SELECT gen_random_uuid(), "tenantId", url, "secretCiphertext", "secretDisplayHint",
                "subscribedEvents", false, "createdByUserId", now(), now()
           FROM "WebhookEndpoint" e, generate_series(1, 19)
          WHERE e.id = $1`,
        [firstId],
      );

      const full = await createFor(user, 'over').expect(409);
      expect((full.body as { code: string }).code).toBe('WEBHOOK_ENDPOINT_TOTAL_LIMIT_REACHED');

      await as(user, 'delete', `/${firstId}/permanent`).expect(204);
      await createFor(user, 'over').expect(201);
    });

    it('deletes only an inactive endpoint, together with its deliveries', async () => {
      await deactivateAll();
      const { endpoint } = await createEndpoint();
      await request(t.http)
        .post(`/api/v1/webhooks/${endpoint.id}/test`)
        .set('Authorization', bearer(owner))
        .expect(202);
      await waitFor(async () =>
        (await deliveriesFor(endpoint.id)).find((d) => d.status === 'SUCCEEDED'),
      );

      const refused = await as(owner, 'delete', `/${endpoint.id}/permanent`).expect(409);
      expect((refused.body as { code: string }).code).toBe('WEBHOOK_ENDPOINT_ACTIVE');
      expect((await listEndpoints()).some((e) => e.id === endpoint.id)).toBe(true);

      await deactivate(endpoint.id);
      await as(owner, 'delete', `/${endpoint.id}/permanent`).expect(204);
      expect((await listEndpoints()).some((e) => e.id === endpoint.id)).toBe(false);
      const left = await ownerQuery<{ n: string }>(
        `SELECT count(*)::text AS n FROM "WebhookDelivery" WHERE "webhookEndpointId" = $1`,
        [endpoint.id],
      );
      expect(left.rows[0]?.n).toBe('0');
      await as(owner, 'delete', `/${endpoint.id}/permanent`).expect(404);
    });

    it("never deletes another tenant's endpoint", async () => {
      await deactivateAll();
      const { endpoint } = await createEndpoint();
      await deactivate(endpoint.id);
      const stranger = await newTenant('Delete Stranger');
      await as(stranger, 'delete', `/${endpoint.id}/permanent`).expect(404);
      expect((await listEndpoints()).some((e) => e.id === endpoint.id)).toBe(true);
    });
  });

  describe('auto-disable', () => {
    const INVITE_LINK = /\/accept-invite\/([0-9a-f]{64})/;

    async function invite(role: 'ADMIN' | 'MEMBER'): Promise<SignedInUser> {
      const email = uniqueEmail(role.toLowerCase());
      await request(t.http)
        .post('/api/v1/users')
        .set('Authorization', bearer(owner))
        .send({ fullName: `Lifecycle ${role}`, email, role })
        .expect(201);
      const message = await waitFor(() => emailsTo(worker.mailbox, email, 'user-invited').at(-1));
      const token = INVITE_LINK.exec(message.text)?.[1];
      const accepted = await request(t.http)
        .post(`/api/v1/auth/invitations/${token}/accept`)
        .send({ password: 'a fresh chosen password' })
        .expect(200);
      return {
        email,
        password: 'a fresh chosen password',
        accessToken: (accepted.body as AuthResponse).accessToken,
        cookie: '',
        body: accepted.body as AuthResponse,
      };
    }

    let eventCounter = 0;
    async function fireEvent(): Promise<void> {
      eventCounter += 1;
      await t.app.get(WebhookQueueService).enqueue(owner.body.user.tenant.id, 'envelope.sent', {
        envelopeId: `00000000-0000-4000-8000-${String(eventCounter).padStart(12, '0')}`,
      });
    }

    async function state(id: string): Promise<WebhookEndpointSummary> {
      const found = (await listEndpoints()).find((e) => e.id === id);
      if (!found) throw new Error('endpoint missing');
      return found;
    }

    it('turns an endpoint off after repeated exhausted deliveries and emails only human admins, once', async () => {
      const admin = await invite('ADMIN');
      const member = await invite('MEMBER');
      await request(t.http)
        .post('/api/v1/api-keys')
        .set('Authorization', bearer(owner))
        .send({ label: 'creates the service account' })
        .expect(201);
      const service = await ownerQuery<{ email: string }>(
        `SELECT email FROM "User" WHERE "tenantId" = $1 AND "isServiceAccount"`,
        [owner.body.user.tenant.id],
      );
      const serviceEmail = service.rows[0]?.email;
      expect(serviceEmail).toBeTruthy();

      const { endpoint, rawSecret } = await createEndpoint();
      respondWith = () => 500;
      await fireEvent();
      await fireEvent();

      const disabled = await waitFor(async () => {
        const current = await state(endpoint.id);
        return current.isActive ? undefined : current;
      }, 20_000);
      expect(disabled.disabledAt).toBeTruthy();
      expect(disabled.disabledReason).toContain('2 deliveries in a row');
      expect(disabled.consecutiveFailures).toBeGreaterThanOrEqual(2);

      const ownerMail = await waitFor(() =>
        emailsTo(worker.mailbox, owner.email, 'webhook-disabled').at(0),
      );
      await waitFor(() => emailsTo(worker.mailbox, admin.email, 'webhook-disabled').at(0));
      expect(ownerMail.subject).toBe('Webhook endpoint 127.0.0.1 was turned off');
      // Host only: never the path a URL may carry, and never the secret.
      expect(ownerMail.text).not.toContain('/hook');
      expect(ownerMail.text).not.toContain(rawSecret);
      expect(ownerMail.text).toContain('/settings/integrations');

      // Let any straggler job run before asserting who was NOT mailed and that nobody got two.
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(emailsTo(worker.mailbox, member.email, 'webhook-disabled')).toHaveLength(0);
      expect(emailsTo(worker.mailbox, serviceEmail ?? '', 'webhook-disabled')).toHaveLength(0);
      expect(emailsTo(worker.mailbox, owner.email, 'webhook-disabled')).toHaveLength(1);
      expect(emailsTo(worker.mailbox, admin.email, 'webhook-disabled')).toHaveLength(1);

      // Off means off: no more events are sent to it.
      const before = received.length;
      await fireEvent();
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(received.length).toBe(before);

      // Reactivating starts fresh, and a second collapse is a new event that is mailed again.
      const reactivated = await request(t.http)
        .patch(`/api/v1/webhooks/${endpoint.id}`)
        .set('Authorization', bearer(owner))
        .send({ isActive: true })
        .expect(200);
      const summary = reactivated.body as WebhookEndpointSummary;
      expect(summary.isActive).toBe(true);
      expect(summary.consecutiveFailures).toBe(0);
      expect(summary.disabledAt).toBeNull();
      expect(summary.disabledReason).toBeNull();

      await fireEvent();
      await fireEvent();
      await waitFor(async () => ((await state(endpoint.id)).isActive ? undefined : true), 20_000);
      await waitFor(() => {
        const mails = emailsTo(worker.mailbox, owner.email, 'webhook-disabled');
        return mails.length === 2 ? mails : undefined;
      });
    }, 60_000);

    it('resets the streak on any success, so scattered failures never disable an endpoint', async () => {
      const { endpoint } = await createEndpoint();
      let failing = true;
      respondWith = () => (failing ? 500 : 200);

      await fireEvent();
      await waitFor(
        async () => ((await state(endpoint.id)).consecutiveFailures === 1 ? true : undefined),
        15_000,
      );

      failing = false;
      await fireEvent();
      await waitFor(
        async () => ((await state(endpoint.id)).consecutiveFailures === 0 ? true : undefined),
        15_000,
      );

      failing = true;
      await fireEvent();
      await waitFor(
        async () => ((await state(endpoint.id)).consecutiveFailures === 1 ? true : undefined),
        15_000,
      );
      expect((await state(endpoint.id)).isActive).toBe(true);
      expect(emailsTo(worker.mailbox, owner.email, 'webhook-disabled')).toHaveLength(0);
    }, 60_000);

    it('does not count a manual retry of the same failed delivery as another failure', async () => {
      const { endpoint } = await createEndpoint();
      respondWith = () => 500;
      await fireEvent();
      const exhausted = await waitFor(
        async () => (await deliveriesFor(endpoint.id)).find((d) => d.status === 'EXHAUSTED'),
        15_000,
      );
      await waitFor(async () =>
        (await state(endpoint.id)).consecutiveFailures === 1 ? true : undefined,
      );

      await request(t.http)
        .post(`/api/v1/webhooks/deliveries/${exhausted.id}/retry`)
        .set('Authorization', bearer(owner))
        .expect(200);
      await waitFor(async () => {
        const again = (await deliveriesFor(endpoint.id)).find((d) => d.id === exhausted.id);
        return again?.status === 'EXHAUSTED' && again.attempts > exhausted.attempts
          ? true
          : undefined;
      }, 15_000);
      await new Promise((resolve) => setTimeout(resolve, 300));

      const current = await state(endpoint.id);
      expect(current.consecutiveFailures).toBe(1);
      expect(current.isActive).toBe(true);
    }, 45_000);

    it('never counts a failed test event toward the streak', async () => {
      const { endpoint } = await createEndpoint();
      respondWith = () => 500;
      for (let i = 0; i < 3; i++) {
        await request(t.http)
          .post(`/api/v1/webhooks/${endpoint.id}/test`)
          .set('Authorization', bearer(owner))
          .expect(202);
      }
      await waitFor(async () => {
        const list = await deliveriesFor(endpoint.id);
        return list.length === 3 && list.every((d) => d.status === 'EXHAUSTED') ? true : undefined;
      }, 15_000);
      await new Promise((resolve) => setTimeout(resolve, 300));

      const current = await state(endpoint.id);
      expect(current.isActive).toBe(true);
      expect(current.consecutiveFailures).toBe(0);
      expect(emailsTo(worker.mailbox, owner.email, 'webhook-disabled')).toHaveLength(0);
    }, 30_000);
  });
});
