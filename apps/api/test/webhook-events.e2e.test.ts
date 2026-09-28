import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  type CreateWebhookEndpointResponse,
  type WebhookDeliverySummary,
  type WebhookEventType,
  webhookEventDataSchemas,
} from '@envelope/shared';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExpirySweepService } from '../src/maintenance/expiry-sweep.service';
import { WEBHOOK_DELIVERY_QUEUE } from '../src/queue/queue.module';
import { makePng, pngDataUrl } from './fixtures/png';
import {
  createTestApp,
  createTestWorker,
  type TestApp,
  type TestWorker,
  waitFor,
} from './helpers/app';
import { registerUser, type SignedInUser } from './helpers/auth';
import { ownerQuery, truncateAll } from './helpers/db';
import { bearer, linkFor, prepareEnvelope, sendEnvelope, signAs } from './helpers/signing';

/**
 * The 9 real webhook hook points (docs/08, "Webhooks"; docs/18): each
 * envelope-lifecycle action enqueues the documented event with a matching
 * payload. Delivery mechanics themselves (signing, retries, exhaustion,
 * redrive) are covered by webhook-delivery.e2e.test.ts; this file only
 * checks that the right event fires, with the right data, at the right
 * moment — read straight from the deliveries API, without waiting for an
 * actual HTTP delivery to succeed.
 */
describe('webhook events wired into the envelope lifecycle (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;
  let endpointId: string;
  let receiver: http.Server;

  beforeAll(async () => {
    process.env.WEBHOOK_ALLOW_INSECURE_LOCAL_URLS = 'true';
    await truncateAll();
    t = await createTestApp();
    // See webhook-delivery.e2e.test.ts: a leftover job from a previous file
    // can otherwise be picked up by this file's fresh worker.
    await t.app.get<Queue>(getQueueToken(WEBHOOK_DELIVERY_QUEUE)).obliterate({ force: true });
    worker = await createTestWorker();
    owner = await registerUser(t.http, { fullName: 'Events Owner', organization: 'Events Clinic' });

    // Answers every attempt with 200 immediately: this file only checks that
    // the right event fires with the right payload, not delivery/retry
    // behaviour (webhook-delivery.e2e.test.ts covers that) — an endpoint
    // that always fails would otherwise leave six retries per event backed
    // up in the worker for no reason this file cares about, adding
    // unrelated background database load while later tests run.
    receiver = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => res.writeHead(200).end('{}'));
    });
    await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', () => resolve()));
    const port = (receiver.address() as AddressInfo).port;

    // Subscribed to every event, so any of the 9 hook points landing here is visible.
    const created = await request(t.http)
      .post('/api/v1/webhooks')
      .set('Authorization', bearer(owner))
      .send({ url: `http://127.0.0.1:${port}/hook` })
      .expect(201);
    endpointId = (created.body as CreateWebhookEndpointResponse).endpoint.id;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => receiver.close(() => resolve()));
    delete process.env.WEBHOOK_ALLOW_INSECURE_LOCAL_URLS;
    await worker.close();
    await t.close();
  });

  async function latest(
    eventType: WebhookEventType,
    envelopeId?: string,
    recipientId?: string,
  ): Promise<WebhookDeliverySummary> {
    const delivery = await waitFor(async () => {
      const res = await request(t.http)
        .get(`/api/v1/webhooks/${endpointId}/deliveries`)
        .set('Authorization', bearer(owner))
        .expect(200);
      const deliveries = res.body as WebhookDeliverySummary[];
      return deliveries.find(
        (d) =>
          d.eventType === eventType &&
          (!envelopeId || d.data.envelopeId === envelopeId) &&
          (!recipientId || d.data.recipientId === recipientId),
      );
    });
    const stored = await ownerQuery<{ payload: { apiVersion: string } }>(
      'SELECT payload FROM "WebhookDelivery" WHERE id = $1',
      [delivery.id],
    );
    expect(stored.rows[0]?.payload.apiVersion).toBe('v1');
    expect(webhookEventDataSchemas[eventType].parse(delivery.data)).toMatchObject(delivery.data);
    expect(delivery.data.envelopeTitle).toBe('Agreement under test');
    return delivery;
  }

  /**
   * `sendEnvelope()` returns once ENVELOPE_SENT is recorded, but the actual
   * invitation email — and the EMAIL_SENT audit event that goes with it — is
   * sent asynchronously by the mail worker afterwards. Both that write and
   * this envelope's *next* action (voiding it, expiring it, ...) go through
   * `AuditService.record()`'s advisory-lock-then-insert path for the same
   * envelope; two independent transactions racing there can genuinely
   * deadlock at the database level (a real, pre-existing hazard, not a
   * webhook-specific one). `linkFor` already waits for the email to land in
   * the mailbox, which happens after the worker's audit write completes, so
   * calling it before any second action on the same envelope avoids the race
   * instead of tolerating it.
   */
  async function awaitInvitation(email: string): Promise<string> {
    return linkFor(worker.mailbox, email);
  }

  it('fires envelope.sent, envelope.viewed, recipient.consented, recipient.signed and envelope.completed for a single-signer envelope', async () => {
    const envelope = await prepareEnvelope(t.http, owner, [
      { name: 'Sam Signer', email: 'sam-events@example.test' },
    ]);
    await sendEnvelope(t.http, owner, envelope.id).expect(200);

    const sent = await latest('envelope.sent');
    expect(sent.data.envelopeId).toBe(envelope.id);
    expect(sent.data.envelopeStatus).toBe('SENT');

    const token = await linkFor(worker.mailbox, 'sam-events@example.test');
    await request(t.http).get(`/api/v1/sign/${token}`).expect(200);
    const viewed = await latest('envelope.viewed');
    expect(viewed.data.envelopeId).toBe(envelope.id);
    expect(viewed.data.recipientId).toBe(envelope.recipients[0]?.id);
    expect(viewed.data.recipientEmail).toBe('sam-events@example.test');
    expect(viewed.data.envelopeStatus).toBe('SENT');

    await signAs(t.http, token, envelope, envelope.recipients[0]?.id ?? '');

    const consented = await latest('recipient.consented');
    expect(consented.data.envelopeId).toBe(envelope.id);
    expect(consented.data.recipientEmail).toBe('sam-events@example.test');
    expect(consented.data.envelopeStatus).toBe('SENT');

    const signed = await latest('recipient.signed');
    expect(signed.data.envelopeId).toBe(envelope.id);
    expect(signed.data.recipientEmail).toBe('sam-events@example.test');
    expect(signed.data.envelopeStatus).toBe('PARTIALLY_SIGNED');
    expect(signed.data.allSigned).toBe(true);
    expect(signed.data.remainingSigners).toBe(0);

    const completed = await latest('envelope.completed');
    expect(completed.data.envelopeId).toBe(envelope.id);
    expect(completed.data.envelopeStatus).toBe('COMPLETED');
  });

  it('fires recipient.declined when a signer declines', async () => {
    const envelope = await prepareEnvelope(t.http, owner, [
      { name: 'Dana Decliner', email: 'dana-events@example.test' },
    ]);
    await sendEnvelope(t.http, owner, envelope.id).expect(200);
    const token = await linkFor(worker.mailbox, 'dana-events@example.test');
    await request(t.http)
      .post(`/api/v1/sign/${token}/decline`)
      .send({ reason: 'Not my document' })
      .expect(200);

    const declined = await latest('recipient.declined');
    expect(declined.data.envelopeId).toBe(envelope.id);
    expect(declined.data.recipientEmail).toBe('dana-events@example.test');
    expect(declined.data).not.toHaveProperty('reason');
    expect(declined.data).not.toHaveProperty('declinedReason');
  });

  it('fires envelope.voided when the sender cancels', async () => {
    const envelope = await prepareEnvelope(t.http, owner, [
      { name: 'Vic Voided', email: 'vic-events@example.test' },
    ]);
    await sendEnvelope(t.http, owner, envelope.id).expect(200);
    await awaitInvitation('vic-events@example.test');
    await request(t.http)
      .post(`/api/v1/envelopes/${envelope.id}/void`)
      .set('Authorization', bearer(owner))
      .send({ reason: 'Sent by mistake' })
      .expect(200);

    const voided = await latest('envelope.voided');
    expect(voided.data.envelopeId).toBe(envelope.id);
    expect(voided.data.fromStatus).toBe('SENT');
    expect(voided.data.reason).toBe('Sent by mistake');
  });

  it('fires envelope.expired when the expiry sweep pauses an overdue envelope', async () => {
    const envelope = await prepareEnvelope(t.http, owner, [
      { name: 'Ellie Expired', email: 'ellie-events@example.test' },
    ]);
    await sendEnvelope(t.http, owner, envelope.id).expect(200);
    await awaitInvitation('ellie-events@example.test');
    await ownerQuery(
      `UPDATE "Envelope" SET "expiresAt" = now() AT TIME ZONE 'UTC' - interval '1 minute' WHERE id = $1`,
      [envelope.id],
    );
    await worker.module.get(ExpirySweepService).run();

    const expired = await latest('envelope.expired');
    expect(expired.data.envelopeId).toBe(envelope.id);
    expect(expired.data.envelopeStatus).toBe('EXPIRED');
  });

  it('reports the remaining signer and the updated status to the next recipient', async () => {
    const envelope = await prepareEnvelope(
      t.http,
      owner,
      [
        { name: 'First', email: 'first-events@example.test' },
        { name: 'Second', email: 'second-events@example.test' },
      ],
      { sequential: false },
    );
    await sendEnvelope(t.http, owner, envelope.id).expect(200);
    const firstToken = await linkFor(worker.mailbox, 'first-events@example.test');
    const secondToken = await linkFor(worker.mailbox, 'second-events@example.test');
    await signAs(t.http, firstToken, envelope, envelope.recipients[0]?.id ?? '');
    const first = await latest('recipient.signed', envelope.id, envelope.recipients[0]?.id);
    expect(first.data).toMatchObject({
      allSigned: false,
      remainingSigners: 1,
      envelopeStatus: 'PARTIALLY_SIGNED',
    });

    const session = await request(t.http).get(`/api/v1/sign/${secondToken}`).expect(200);
    const viewed = await latest('envelope.viewed', envelope.id, envelope.recipients[1]?.id);
    expect(viewed.data.envelopeStatus).toBe('PARTIALLY_SIGNED');
    const consent = { agreed: true, consentTextHash: session.body.consentTextHash };
    await request(t.http).post(`/api/v1/sign/${secondToken}/consent`).send(consent).expect(200);
    await request(t.http).post(`/api/v1/sign/${secondToken}/consent`).send(consent).expect(200);
    await request(t.http).get(`/api/v1/sign/${secondToken}`).expect(200);
    const consented = await latest('recipient.consented', envelope.id, envelope.recipients[1]?.id);
    expect(consented.data.envelopeStatus).toBe('PARTIALLY_SIGNED');
    const rows = await ownerQuery<{ eventType: string; count: string }>(
      `SELECT "eventType", count(*)::text AS count FROM "WebhookDelivery"
       WHERE "envelopeId" = $1 AND payload->'data'->>'recipientId' = $2
       GROUP BY "eventType"`,
      [envelope.id, envelope.recipients[1]?.id],
    );
    expect(rows.rows).toEqual(
      expect.arrayContaining([
        { eventType: 'envelope.viewed', count: '1' },
        { eventType: 'recipient.consented', count: '1' },
      ]),
    );
    await request(t.http).get(`/api/v1/sign/${secondToken}/document`).expect(200);
    await request(t.http)
      .post(`/api/v1/sign/${secondToken}/adopt`)
      .send({ kind: 'SIGNATURE', method: 'DRAWN', image: pngDataUrl() })
      .expect(200);
    await request(t.http)
      .post(`/api/v1/sign/${secondToken}/adopt`)
      .send({ kind: 'INITIALS', method: 'TYPED', image: pngDataUrl(makePng(120, 60)) })
      .expect(200);
    const checkbox = envelope.fields.find(
      (field) => field.type === 'CHECKBOX' && field.recipientId === envelope.recipients[1]?.id,
    );
    await request(t.http)
      .post(`/api/v1/sign/${secondToken}/submit`)
      .send({ fields: [{ id: checkbox?.id, value: 'true' }] })
      .expect(202);
    const last = await latest('recipient.signed', envelope.id, envelope.recipients[1]?.id);
    expect(last.data).toMatchObject({
      allSigned: true,
      remainingSigners: 0,
      envelopeStatus: 'PARTIALLY_SIGNED',
    });
    await latest('envelope.completed', envelope.id);
  });

  it.each([false, true])(
    'fires envelope.extended once, including on replay (reopened=%s)',
    async (reopened) => {
      const email = `extend-${reopened}@example.test`;
      const envelope = await prepareEnvelope(t.http, owner, [{ name: 'Extend', email }]);
      await sendEnvelope(t.http, owner, envelope.id).expect(200);
      await awaitInvitation(email);
      if (reopened) {
        await ownerQuery(
          `UPDATE "Envelope" SET "expiresAt" = now() AT TIME ZONE 'UTC' - interval '1 minute' WHERE id = $1`,
          [envelope.id],
        );
        await worker.module.get(ExpirySweepService).run();
        await latest('envelope.expired', envelope.id);
      }
      const key = randomUUID();
      const extend = () =>
        request(t.http)
          .post(`/api/v1/envelopes/${envelope.id}/extend`)
          .set('Authorization', bearer(owner))
          .set('Idempotency-Key', key)
          .send({ expiresInDays: 7 });
      const response = await extend().expect(200);
      await extend().expect(200);
      const event = await latest('envelope.extended', envelope.id);
      expect(event.data).toMatchObject({
        envelopeStatus: 'SENT',
        reopened,
        reinvitedCount: 1,
        expiresAt: response.body.expiresAt,
        previousExpiresAt: response.body.previousExpiresAt,
      });
      const rows = await ownerQuery<{ count: string }>(
        `SELECT count(*)::text AS count FROM "WebhookDelivery" WHERE "envelopeId" = $1 AND "eventType" = 'envelope.extended'`,
        [envelope.id],
      );
      expect(rows.rows[0]?.count).toBe('1');
    },
  );

  it('never fires envelope.delivered (docs/18: reserved, not implemented)', async () => {
    const res = await request(t.http)
      .get(`/api/v1/webhooks/${endpointId}/deliveries`)
      .set('Authorization', bearer(owner))
      .expect(200);
    const deliveries = res.body as WebhookDeliverySummary[];
    expect(deliveries.some((d) => d.eventType === 'envelope.delivered')).toBe(false);
  });
});
