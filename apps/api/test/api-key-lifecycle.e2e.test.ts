import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CreateApiKeyResponse, RemindResponse } from '@envelope/shared';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMAIL_QUEUE, WEBHOOK_DELIVERY_QUEUE } from '../src/queue/queue.module';
import {
  createTestApp,
  createTestWorker,
  type TestApp,
  type TestWorker,
  waitFor,
} from './helpers/app';
import { registerUser, type SignedInUser } from './helpers/auth';
import { ownerQuery, truncateAll } from './helpers/db';
import { emailsTo, linkFor, prepareEnvelope, sendEnvelope } from './helpers/signing';

/**
 * A full API key can cancel an envelope and send a reminder (docs/18,
 * workstream 11). Extending stays session-only, and a read-only key is refused
 * on both. The acting user is the tenant's hidden service account.
 */
describe('API-key lifecycle routes (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;
  let fullKey: string;
  let readOnlyKey: string;
  let receiver: http.Server;

  const asKey = (key: string) => `Bearer ${key}`;

  async function createKey(label: string, readOnly = false): Promise<string> {
    const res = await request(t.http)
      .post('/api/v1/api-keys')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ label, readOnly })
      .expect(201);
    return (res.body as CreateApiKeyResponse).rawKey;
  }

  async function sentEnvelope(email: string): Promise<string> {
    const envelope = await prepareEnvelope(t.http, owner, [{ name: 'Key Signer', email }]);
    await sendEnvelope(t.http, owner, envelope.id).expect(200);
    // The invitation's audit write must finish before another action on the
    // same envelope (docs/18, "A Pre-Existing Race").
    await linkFor(worker.mailbox, email);
    return envelope.id;
  }

  beforeAll(async () => {
    process.env.WEBHOOK_ALLOW_INSECURE_LOCAL_URLS = 'true';
    await truncateAll();
    t = await createTestApp();
    for (const name of [EMAIL_QUEUE, WEBHOOK_DELIVERY_QUEUE]) {
      await t.app.get<Queue>(getQueueToken(name)).obliterate({ force: true });
    }
    worker = await createTestWorker();
    owner = await registerUser(t.http, { fullName: 'Key Owner', organization: 'Lifecycle Clinic' });
    fullKey = await createKey('full');
    readOnlyKey = await createKey('read only', true);

    receiver = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => res.writeHead(200).end('{}'));
    });
    await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', () => resolve()));
    const port = (receiver.address() as AddressInfo).port;
    await request(t.http)
      .post('/api/v1/webhooks')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ url: `http://127.0.0.1:${port}/hook`, subscribedEvents: ['envelope.voided'] })
      .expect(201);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => receiver.close(() => resolve()));
    delete process.env.WEBHOOK_ALLOW_INSECURE_LOCAL_URLS;
    await worker.close();
    await t.close();
  });

  it('cancels a sent envelope as the service account and fires envelope.voided', async () => {
    const id = await sentEnvelope('void-by-key@example.test');

    await request(t.http)
      .post(`/api/v1/envelopes/${id}/void`)
      .set('Authorization', asKey(fullKey))
      .send({ reason: 'Wrong patient' })
      .expect(200);

    const { rows } = await ownerQuery<{ status: string; isServiceAccount: boolean }>(
      `SELECT e.status, u."isServiceAccount"
         FROM "Envelope" e
         JOIN "AuditTrail" a ON a."envelopeId" = e.id AND a.action = 'ENVELOPE_VOIDED'
         JOIN "User" u ON u.id = a."actorUserId"
        WHERE e.id = $1`,
      [id],
    );
    expect(rows).toEqual([{ status: 'VOIDED', isServiceAccount: true }]);

    await waitFor(async () => {
      const found = await ownerQuery<{ eventType: string }>(
        `SELECT "eventType" FROM "WebhookDelivery"
          WHERE "eventType" = 'envelope.voided' AND payload->'data'->>'envelopeId' = $1`,
        [id],
      );
      return found.rows.length > 0 ? true : undefined;
    });
  });

  it('sends a reminder with a full key, and a new link reaches the signer', async () => {
    const email = 'remind-by-key@example.test';
    const id = await sentEnvelope(email);

    const res = await request(t.http)
      .post(`/api/v1/envelopes/${id}/remind`)
      .set('Authorization', asKey(fullKey))
      .send({})
      .expect(200);
    expect((res.body as RemindResponse).reminded).toHaveLength(1);

    await waitFor(() =>
      emailsTo(worker.mailbox, email, 'reminder').length > 0 ? true : undefined,
    );
  });

  it('refuses a read-only key on void and remind, and changes nothing', async () => {
    const id = await sentEnvelope('read-only@example.test');

    for (const [path, body] of [
      ['void', { reason: 'nope' }],
      ['remind', {}],
    ] as const) {
      const res = await request(t.http)
        .post(`/api/v1/envelopes/${id}/${path}`)
        .set('Authorization', asKey(readOnlyKey))
        .send(body);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('API_KEY_READ_ONLY');
    }
    const { rows } = await ownerQuery<{ status: string }>(
      `SELECT status FROM "Envelope" WHERE id = $1`,
      [id],
    );
    expect(rows[0]?.status).toBe('SENT');
  });

  it('keeps extend and the reminder settings session-only', async () => {
    const id = await sentEnvelope('session-only@example.test');

    for (const [method, path, body] of [
      ['post', 'extend', { expiresInDays: 10 }],
      ['patch', 'reminders', { reminderIntervalDays: 2 }],
    ] as const) {
      const res = await request(t.http)
        [method](`/api/v1/envelopes/${id}/${path}`)
        .set('Authorization', asKey(fullKey))
        .set('Idempotency-Key', 'k-session-only-0001')
        .send(body);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('API_KEY_NOT_ALLOWED');
    }
  });

  it('refuses a key from another tenant with not found', async () => {
    const id = await sentEnvelope('cross-tenant-key@example.test');
    const other = await registerUser(t.http, { fullName: 'Other Owner', organization: 'Other Co' });
    const created = await request(t.http)
      .post('/api/v1/api-keys')
      .set('Authorization', `Bearer ${other.accessToken}`)
      .send({ label: 'other' })
      .expect(201);
    const otherKey = (created.body as CreateApiKeyResponse).rawKey;

    for (const [path, body] of [
      ['void', { reason: 'hijack' }],
      ['remind', {}],
    ] as const) {
      await request(t.http)
        .post(`/api/v1/envelopes/${id}/${path}`)
        .set('Authorization', asKey(otherKey))
        .send(body)
        .expect(404);
    }
  });
});
