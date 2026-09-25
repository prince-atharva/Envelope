import { randomUUID } from 'node:crypto';
import type { CreateWebhookEndpointResponse } from '@envelope/shared';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebhookDeliveryPurgeService } from '../src/maintenance/webhook-delivery-purge.service';
import { WEBHOOK_DELIVERY_QUEUE } from '../src/queue/queue.module';
import { createTestApp, createTestWorker, type TestApp, type TestWorker } from './helpers/app';
import { registerUser, type SignedInUser } from './helpers/auth';
import { ownerQuery, truncateAll } from './helpers/db';
import { bearer } from './helpers/signing';

/** The webhook-delivery purge (docs/08: "retained 7 days"; docs/18). */
describe('webhook delivery purge (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;
  let purge: WebhookDeliveryPurgeService;
  let endpointId: string;
  let tenantId: string;

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    // See webhook-delivery.e2e.test.ts: a leftover job from a previous file
    // can otherwise be picked up by this file's fresh worker.
    await t.app.get<Queue>(getQueueToken(WEBHOOK_DELIVERY_QUEUE)).obliterate({ force: true });
    worker = await createTestWorker();
    owner = await registerUser(t.http, { fullName: 'Purge Owner', organization: 'Purge Clinic' });
    purge = worker.module.get(WebhookDeliveryPurgeService);
    tenantId = owner.body.user.tenant.id;

    const created = await request(t.http)
      .post('/api/v1/webhooks')
      .set('Authorization', bearer(owner))
      .send({ url: 'https://93.184.216.34/purge' })
      .expect(201);
    endpointId = (created.body as CreateWebhookEndpointResponse).endpoint.id;
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
  });

  async function insertDelivery(daysOld: number, status: string): Promise<string> {
    const id = randomUUID();
    await ownerQuery(
      `INSERT INTO "WebhookDelivery"
         (id, "tenantId", "webhookEndpointId", "eventId", "eventType", payload, status, "createdAt")
       VALUES ($1, $2, $3, $4, 'envelope.sent', '{}'::jsonb, $5, now() - ($6 || ' days')::interval)`,
      [id, tenantId, endpointId, `evt_${id}`, status, String(daysOld)],
    );
    return id;
  }

  async function exists(id: string): Promise<boolean> {
    const { rows } = await ownerQuery(`SELECT 1 FROM "WebhookDelivery" WHERE id = $1`, [id]);
    return rows.length > 0;
  }

  it('purges deliveries past 7 days, whatever their status, and keeps recent ones', async () => {
    const oldSucceeded = await insertDelivery(8, 'SUCCEEDED');
    const oldExhausted = await insertDelivery(10, 'EXHAUSTED');
    const recentFailed = await insertDelivery(2, 'FAILED');
    const justUnderCutoff = await insertDelivery(6, 'SUCCEEDED');

    const result = await purge.run();
    expect(result.changed).toBe(2);

    expect(await exists(oldSucceeded)).toBe(false);
    expect(await exists(oldExhausted)).toBe(false);
    expect(await exists(recentFailed)).toBe(true);
    expect(await exists(justUnderCutoff)).toBe(true);
  });
});
