import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { EMAIL_QUEUE, SEAL_QUEUE } from '../src/queue/queue.module';
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
import {
  bearer,
  emailsTo,
  linkFor,
  type PersonSpec,
  prepareEnvelope,
  sendEnvelope,
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

/** Cancelling a sent envelope and discarding a draft (docs/16 step 4). */
describe('cancel and discard (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;

  const cancel = (id: string, body?: object, as: SignedInUser = owner) => {
    const req = request(t.http)
      .post(`/api/v1/envelopes/${id}/void`)
      .set('Authorization', bearer(as));
    return body ? req.send(body) : req;
  };

  async function row(id: string) {
    const { rows } = await ownerQuery<{
      status: string;
      voidedAt: Date | null;
      voidReason: string | null;
      voidedByUserId: string | null;
    }>(`SELECT status, "voidedAt", "voidReason", "voidedByUserId" FROM "Envelope" WHERE id = $1`, [
      id,
    ]);
    return rows[0];
  }

  async function voidedEvents(id: string) {
    const { rows } = await ownerQuery<{ actorUserId: string; metadata: Record<string, unknown> }>(
      `SELECT "actorUserId", metadata FROM "AuditTrail"
        WHERE "envelopeId" = $1 AND action = 'ENVELOPE_VOIDED'`,
      [id],
    );
    return rows;
  }

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    for (const name of [EMAIL_QUEUE, SEAL_QUEUE]) {
      await t.app.get<Queue>(getQueueToken(name)).obliterate({ force: true });
    }
    worker = await createTestWorker();
    owner = await registerUser(t.http, { fullName: 'Cancel Owner', organization: 'Cancel Clinic' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
  });

  it('discards a draft without a reason and emails nobody', async () => {
    const signer = person('Draft Person');
    const envelope = await prepareEnvelope(t.http, owner, [signer]);

    const res = await cancel(envelope.id).expect(200);
    expect(res.body).toMatchObject({ id: envelope.id, status: 'VOIDED', discarded: true });
    expect(await row(envelope.id)).toMatchObject({
      status: 'VOIDED',
      voidReason: null,
      voidedByUserId: owner.body.user.id,
    });
    expect((await voidedEvents(envelope.id)).map((e) => e.metadata)).toEqual([
      { fromStatus: 'DRAFT', discarded: true },
    ]);

    // A discarded draft cannot be edited or sent.
    await sendEnvelope(t.http, owner, envelope.id).expect(409);
    expect(emailsTo(worker.mailbox, signer.email)).toEqual([]);
  });

  it('needs a reason to cancel a sent envelope', async () => {
    const envelope = await prepareEnvelope(t.http, owner, [person('Needs Reason')]);
    await sendEnvelope(t.http, owner, envelope.id).expect(200);

    const missing = await cancel(envelope.id).expect(400);
    expect(missing.body.code).toBe('VALIDATION_FAILED');
    expect(missing.body.errors).toEqual([{ path: 'reason', message: expect.any(String) }]);
    await cancel(envelope.id, { reason: '   ' }).expect(400);
    await cancel(envelope.id, { reason: 'x'.repeat(1001) }).expect(400);
    expect((await row(envelope.id))?.status).toBe('SENT');
  });

  it('kills every link at once and tells each person who was emailed, with the reason', async () => {
    const logs = captureLogs();
    const first = person('First Signer', 1);
    const second = person('Second Signer', 2);
    const envelope = await prepareEnvelope(t.http, owner, [first, second], { sequential: true });
    await sendEnvelope(t.http, owner, envelope.id).expect(200);
    const token = await linkFor(worker.mailbox, first.email);
    await request(t.http).get(`/api/v1/sign/${token}`).expect(200);

    const reason = 'The fee schedule changed; a new version is on its way.';
    const res = await cancel(envelope.id, { reason }).expect(200);
    expect(res.body).toMatchObject({ status: 'VOIDED', discarded: false });
    expect(await row(envelope.id)).toMatchObject({ status: 'VOIDED', voidReason: reason });

    // The link in the invitation now says the sender cancelled.
    const refused = await request(t.http).get(`/api/v1/sign/${token}`).expect(409);
    expect(refused.body).toMatchObject({ code: 'ENVELOPE_TERMINAL', reason: 'VOIDED' });

    const notice = await waitFor(() => emailsTo(worker.mailbox, first.email, 'voided').at(0));
    expect(notice.subject).toBe('Cancel Owner cancelled Agreement under test');
    expect(notice.text).toContain(reason);
    expect(notice.text).not.toMatch(/\/sign\//);

    // The audit trail has the change and the email, but not the reason itself.
    const [event] = await voidedEvents(envelope.id);
    expect(event).toEqual({
      actorUserId: owner.body.user.id,
      metadata: { fromStatus: 'SENT', reasonLength: reason.length },
    });
    const { rows } = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM "AuditTrail"
        WHERE "envelopeId" = $1 AND action = 'EMAIL_SENT' AND metadata->>'kind' = 'voided'`,
      [envelope.id],
    );
    expect(rows[0]?.n).toBe(1);

    // The second signer's turn never came: they were never emailed, so they are not now.
    await waitFor(() =>
      logs.find('Cancellation notice not sent').find((c) => c.fields.reason === 'never emailed'),
    );
    expect(emailsTo(worker.mailbox, second.email)).toEqual([]);
    expect(logs.find('Envelope cancelled')[0]?.fields).toMatchObject({
      envelopeId: envelope.id,
      fromStatus: 'SENT',
      notices: 2,
    });
    expect(logs.text()).not.toContain(reason);
  });

  it('refuses to cancel twice, or an envelope someone declined', async () => {
    const signer = person('Decliner');
    const envelope = await prepareEnvelope(t.http, owner, [signer]);
    await sendEnvelope(t.http, owner, envelope.id).expect(200);
    const token = await linkFor(worker.mailbox, signer.email);
    await request(t.http)
      .post(`/api/v1/sign/${token}/decline`)
      .send({ reason: 'Not mine to sign.' })
      .expect(200);

    const declined = await cancel(envelope.id, { reason: 'Too late' }).expect(409);
    expect(declined.body).toMatchObject({ code: 'ENVELOPE_TERMINAL', reason: 'DECLINED' });

    const draft = await prepareEnvelope(t.http, owner, [person('Twice')]);
    await cancel(draft.id).expect(200);
    const again = await cancel(draft.id).expect(409);
    expect(again.body).toMatchObject({ code: 'ENVELOPE_TERMINAL', reason: 'VOIDED' });
    expect(await voidedEvents(draft.id)).toHaveLength(1);
  });

  it("cannot cancel another workspace's envelope", async () => {
    const envelope = await prepareEnvelope(t.http, owner, [person('Other Tenant')]);
    const stranger = await registerUser(t.http, { fullName: 'Stranger' });
    await cancel(envelope.id, { reason: 'Mine now' }, stranger).expect(404);
    expect((await row(envelope.id))?.status).toBe('DRAFT');
  });
});
