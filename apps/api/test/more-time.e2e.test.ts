import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExpirySweepService } from '../src/maintenance/expiry-sweep.service';
import { EMAIL_QUEUE, MAINTENANCE_QUEUE, SEAL_QUEUE } from '../src/queue/queue.module';
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
function person(name: string): PersonSpec {
  counter += 1;
  return { name, email: `${name.toLowerCase().replaceAll(' ', '.')}.${counter}@example.com` };
}

/** A signer with an expired link asks the sender for more time (docs/16 step 8). */
describe('ask for more time (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;

  const ask = (token: string) =>
    request(t.http).post(`/api/v1/sign/${token}/request-more-time`).send({});

  async function requests(envelopeId: string) {
    const { rows } = await ownerQuery<{ recipientId: string }>(
      `SELECT "recipientId" FROM "AuditTrail"
        WHERE "envelopeId" = $1 AND action = 'EXTENSION_REQUESTED'`,
      [envelopeId],
    );
    return rows;
  }

  /** A sent envelope for one signer, and their link. */
  async function sentTo(signer: PersonSpec) {
    const envelope = await prepareEnvelope(t.http, owner, [signer]);
    await sendEnvelope(t.http, owner, envelope.id).expect(200);
    return { envelope, token: await linkFor(worker.mailbox, signer.email) };
  }

  async function pastDeadline(envelopeId: string) {
    await ownerQuery(
      `UPDATE "Envelope" SET "expiresAt" = now() AT TIME ZONE 'UTC' - interval '1 minute'
        WHERE id = $1`,
      [envelopeId],
    );
  }

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    for (const name of [EMAIL_QUEUE, SEAL_QUEUE, MAINTENANCE_QUEUE]) {
      await t.app.get<Queue>(getQueueToken(name)).obliterate({ force: true });
    }
    worker = await createTestWorker();
    owner = await registerUser(t.http, { fullName: 'More Time Owner' });
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
  });

  it('tells the sender once a day, and a repeat is not an error', async () => {
    const logs = captureLogs();
    const signer = person('Late Priya');
    const { envelope, token } = await sentTo(signer);

    // A link that still works has nothing to ask for.
    expect((await ask(token).expect(409)).body.code).toBe('CONFLICT');

    await pastDeadline(envelope.id);
    await worker.module.get(ExpirySweepService).run();
    // Everything else about the link stays refused.
    expect((await request(t.http).get(`/api/v1/sign/${token}`).expect(401)).body.code).toBe(
      'TOKEN_EXPIRED',
    );

    expect((await ask(token).expect(200)).body).toEqual({
      requested: true,
      alreadyRequested: false,
    });
    expect((await ask(token).expect(200)).body).toEqual({
      requested: true,
      alreadyRequested: true,
    });
    expect(await requests(envelope.id)).toEqual([{ recipientId: envelope.recipients[0]?.id }]);

    const notice = await waitFor(() =>
      emailsTo(worker.mailbox, owner.email, 'more-time-requested').at(0),
    );
    expect(notice.subject).toBe('Late Priya asked for more time to sign Agreement under test');
    expect(notice.text).toContain(signer.email);
    expect(notice.text).toContain(`/dashboard/envelopes/${envelope.id}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(emailsTo(worker.mailbox, owner.email, 'more-time-requested')).toHaveLength(1);

    // A day later they may ask again.
    await ownerQuery(
      `UPDATE "Recipient" SET "moreTimeRequestedAt" = "moreTimeRequestedAt" - interval '25 hours'
        WHERE "envelopeId" = $1`,
      [envelope.id],
    );
    expect((await ask(token).expect(200)).body.alreadyRequested).toBe(false);
    expect(await requests(envelope.id)).toHaveLength(2);

    expect(logs.text()).not.toContain(token);
  });

  it('works past the deadline before the sweep has paused the envelope', async () => {
    const { envelope, token } = await sentTo(person('Before Sweep'));
    await pastDeadline(envelope.id);
    expect((await ask(token).expect(200)).body.alreadyRequested).toBe(false);
  });

  it('refuses a cancelled envelope, a signer who finished, and an unknown link', async () => {
    const { envelope, token } = await sentTo(person('Cancelled Too'));
    await pastDeadline(envelope.id);
    await request(t.http)
      .post(`/api/v1/envelopes/${envelope.id}/void`)
      .set('Authorization', bearer(owner))
      .send({ reason: 'No longer needed.' })
      .expect(200);
    const cancelled = await ask(token).expect(409);
    expect(cancelled.body).toMatchObject({ code: 'ENVELOPE_TERMINAL', reason: 'VOIDED' });

    const done = await sentTo(person('Already Done'));
    await ownerQuery(
      `UPDATE "Recipient" SET status = 'SIGNED', "signedAt" = now(), "tokenUsedAt" = now()
        WHERE "envelopeId" = $1`,
      [done.envelope.id],
    );
    await pastDeadline(done.envelope.id);
    expect((await ask(done.token).expect(410)).body.code).toBe('TOKEN_ALREADY_USED');

    expect((await ask('0'.repeat(64)).expect(401)).body.code).toBe('TOKEN_INVALID');
    expect(await requests(envelope.id)).toEqual([]);
  });
});
