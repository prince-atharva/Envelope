import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExpirySweepService } from '../src/maintenance/expiry-sweep.service';
import { EMAIL_QUEUE, MAINTENANCE_QUEUE, SEAL_QUEUE } from '../src/queue/queue.module';
import { SealProcessor } from '../src/sealing/seal.processor';
import {
  createTestApp,
  createTestWorker,
  type TestApp,
  type TestWorker,
  waitFor,
} from './helpers/app';
import { registerUser, type SignedInUser } from './helpers/auth';
import { ownerQuery, truncateAll } from './helpers/db';
import {
  bearer,
  emailsTo,
  linkFor,
  type PersonSpec,
  prepareEnvelope,
  sendEnvelope,
  signAs,
  tokenIn,
} from './helpers/signing';

let counter = 0;
function person(name: string, routingOrder?: number): PersonSpec {
  counter += 1;
  return {
    name,
    email: `${name.toLowerCase().replaceAll(' ', '.')}.${counter}@example.com`,
    ...(routingOrder === undefined ? {} : { routingOrder }),
  };
}

const DAY = 24 * 3600 * 1000;

/** Giving more time, before the deadline and after it (docs/16 step 7, ADR 0013). */
describe('extend and resume (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;

  const extend = (id: string, body: object, key: string | null = randomUUID()) => {
    const req = request(t.http)
      .post(`/api/v1/envelopes/${id}/extend`)
      .set('Authorization', bearer(owner));
    return (key ? req.set('Idempotency-Key', key) : req).send(body);
  };

  /** Epoch milliseconds: the columns hold UTC without a zone. */
  async function times(id: string) {
    const { rows } = await ownerQuery<{ status: string; expiresAt: number }>(
      `SELECT status,
              (extract(epoch FROM "expiresAt" AT TIME ZONE 'UTC') * 1000)::float8 AS "expiresAt"
         FROM "Envelope" WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) throw new Error(`no envelope ${id}`);
    return row;
  }

  async function events(id: string, action: string) {
    const { rows } = await ownerQuery<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM "AuditTrail" WHERE "envelopeId" = $1 AND action = $2 ORDER BY sequence`,
      [id, action],
    );
    return rows.map((row) => row.metadata);
  }

  /** Moves the deadline into the past and lets the sweep pause the envelope. */
  async function expireNow(id: string) {
    await ownerQuery(
      `UPDATE "Envelope" SET "expiresAt" = now() AT TIME ZONE 'UTC' - interval '1 minute'
        WHERE id = $1`,
      [id],
    );
    await worker.module.get(ExpirySweepService).run();
    expect((await times(id)).status).toBe('EXPIRED');
  }

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    for (const name of [EMAIL_QUEUE, SEAL_QUEUE, MAINTENANCE_QUEUE]) {
      await t.app.get<Queue>(getQueueToken(name)).obliterate({ force: true });
    }
    worker = await createTestWorker();
    owner = await registerUser(t.http, { fullName: 'Extend Owner' });
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
  });

  it('moves the deadline before it passes and sends a fresh link, once per click', async () => {
    const signer = person('Needs Time');
    const envelope = await prepareEnvelope(t.http, owner, [signer]);
    await sendEnvelope(t.http, owner, envelope.id, { expiresInDays: 3 }).expect(200);
    const oldToken = await linkFor(worker.mailbox, signer.email);
    const before = await times(envelope.id);

    await extend(envelope.id, { expiresInDays: 30 }, null).expect(400);
    const key = randomUUID();
    const res = await extend(envelope.id, { expiresInDays: 30 }, key).expect(200);
    expect(res.body).toMatchObject({
      status: 'SENT',
      resumed: false,
      notified: [envelope.recipients[0]?.id],
    });
    const after = await times(envelope.id);
    expect(after.expiresAt - before.expiresAt).toBeGreaterThan(26 * DAY);

    // The same click again: the first answer, and no second email.
    const replay = await extend(envelope.id, { expiresInDays: 30 }, key).expect(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body).toEqual(res.body);

    const email = await waitFor(() => emailsTo(worker.mailbox, signer.email, 'extended').at(0));
    expect(email.subject).toBe('More time to sign Agreement under test');
    const newToken = tokenIn(email);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(emailsTo(worker.mailbox, signer.email, 'extended')).toHaveLength(1);

    // Only the newest link works (ADR 0009), and it lasts to the new deadline.
    expect((await request(t.http).get(`/api/v1/sign/${oldToken}`).expect(401)).body.code).toBe(
      'TOKEN_INVALID',
    );
    await request(t.http).get(`/api/v1/sign/${newToken}`).expect(200);
    const { rows } = await ownerQuery<{ ms: number }>(
      `SELECT (extract(epoch FROM "tokenExpiresAt" AT TIME ZONE 'UTC') * 1000)::float8 AS ms
         FROM "Recipient" WHERE "envelopeId" = $1`,
      [envelope.id],
    );
    expect(rows[0]?.ms).toBe(after.expiresAt);

    expect(await events(envelope.id, 'ENVELOPE_EXTENDED')).toEqual([
      expect.objectContaining({ fromStatus: 'SENT', toStatus: 'SENT', expiresInDays: 30 }),
    ]);
  });

  it('reopens an expired envelope, stamps the signature made in time and invites the next person', async () => {
    const first = person('On Time', 1);
    const second = person('Too Late', 2);
    const envelope = await prepareEnvelope(t.http, owner, [first, second], { sequential: true });
    await sendEnvelope(t.http, owner, envelope.id).expect(200);

    // The first signature is made before the deadline, but the seal worker is
    // held back, so the envelope expires before it is stamped.
    const sealWorker = worker.module.get(SealProcessor).worker;
    await sealWorker.pause(true);
    try {
      const token = await linkFor(worker.mailbox, first.email);
      await signAs(t.http, token, envelope, envelope.recipients[0]?.id ?? '');
      await expireNow(envelope.id);
    } finally {
      sealWorker.resume();
    }
    // The queued seal job finds the envelope paused and stamps nothing (ADR 0013).
    await new Promise((resolve) => setTimeout(resolve, 500));
    const versions = async () =>
      (
        await ownerQuery<{ n: number }>(
          `SELECT count(*)::int AS n FROM "DocumentVersion" WHERE "envelopeId" = $1`,
          [envelope.id],
        )
      ).rows[0]?.n;
    expect(await versions()).toBe(1);
    expect(emailsTo(worker.mailbox, second.email)).toEqual([]);

    const res = await extend(envelope.id, { expiresInDays: 7 }).expect(200);
    // Someone signed, so it reopens as partly signed. Nobody holds a live turn:
    // the next person is invited once the first signature is stamped.
    expect(res.body).toMatchObject({ status: 'PARTIALLY_SIGNED', resumed: true, notified: [] });

    const invitation = await waitFor(
      () => emailsTo(worker.mailbox, second.email, 'invitation').at(0),
      20_000,
    );
    expect(await versions()).toBe(2);
    await request(t.http)
      .get(`/api/v1/sign/${tokenIn(invitation)}`)
      .expect(200);
    expect(await events(envelope.id, 'ENVELOPE_EXTENDED')).toEqual([
      expect.objectContaining({ fromStatus: 'EXPIRED', toStatus: 'PARTIALLY_SIGNED' }),
    ]);
  });

  it('emails a fresh link to whoever holds the turn when an expired envelope reopens', async () => {
    const signer = person('Came Back');
    const envelope = await prepareEnvelope(t.http, owner, [signer]);
    await sendEnvelope(t.http, owner, envelope.id).expect(200);
    await linkFor(worker.mailbox, signer.email);
    await expireNow(envelope.id);

    const res = await extend(envelope.id, { expiresInDays: 7 }).expect(200);
    expect(res.body).toMatchObject({ status: 'SENT', resumed: true });
    const email = await waitFor(() => emailsTo(worker.mailbox, signer.email, 'extended').at(0));
    await request(t.http)
      .get(`/api/v1/sign/${tokenIn(email)}`)
      .expect(200);
  });

  it('refuses drafts, closed envelopes, bad lengths and other workspaces', async () => {
    const draft = await prepareEnvelope(t.http, owner, [person('Draft Only')]);
    expect((await extend(draft.id, { expiresInDays: 7 }).expect(409)).body.code).toBe('CONFLICT');

    for (const expiresInDays of [0, 91]) await extend(draft.id, { expiresInDays }).expect(400);

    await request(t.http)
      .post(`/api/v1/envelopes/${draft.id}/void`)
      .set('Authorization', bearer(owner))
      .expect(200);
    const closed = await extend(draft.id, { expiresInDays: 7 }).expect(409);
    expect(closed.body).toMatchObject({ code: 'ENVELOPE_TERMINAL', reason: 'VOIDED' });

    const mine = await prepareEnvelope(t.http, owner, [person('Not Yours')]);
    const stranger = await registerUser(t.http, { fullName: 'Stranger' });
    await request(t.http)
      .post(`/api/v1/envelopes/${mine.id}/extend`)
      .set('Authorization', bearer(stranger))
      .set('Idempotency-Key', randomUUID())
      .send({ expiresInDays: 7 })
      .expect(404);
  });
});
