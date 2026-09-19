import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExpirySweepService } from '../src/maintenance/expiry-sweep.service';
import { EMAIL_QUEUE, MAINTENANCE_QUEUE, SEAL_QUEUE } from '../src/queue/queue.module';
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
} from './helpers/signing';

let counter = 0;
function person(name: string): PersonSpec {
  counter += 1;
  return { name, email: `${name.toLowerCase().replaceAll(' ', '.')}.${counter}@example.com` };
}

const HOUR = 3600 * 1000;

/** The expiry sweep pauses overdue envelopes (docs/16 step 6, ADR 0013). */
describe('expiry sweep (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;
  let sweep: ExpirySweepService;

  /**
   * Times as epoch milliseconds: the columns have no zone and hold UTC, which
   * the pg driver would read as local time.
   */
  async function envelopeRow(id: string) {
    const { rows } = await ownerQuery<{
      status: string;
      expiredAt: number | null;
      expiresAt: number;
    }>(
      `SELECT status,
              (extract(epoch FROM "expiredAt" AT TIME ZONE 'UTC') * 1000)::float8 AS "expiredAt",
              (extract(epoch FROM "expiresAt" AT TIME ZONE 'UTC') * 1000)::float8 AS "expiresAt"
         FROM "Envelope" WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) throw new Error(`no envelope ${id}`);
    return row;
  }

  async function expiredEvents(id: string) {
    const { rows } = await ownerQuery<{ metadata: Record<string, unknown>; ipAddress: string }>(
      `SELECT metadata, "ipAddress" FROM "AuditTrail"
        WHERE "envelopeId" = $1 AND action = 'ENVELOPE_EXPIRED'`,
      [id],
    );
    return rows;
  }

  /** A sent envelope; returns it and a time just past its deadline. */
  async function sentTo(people: PersonSpec[]) {
    const envelope = await prepareEnvelope(t.http, owner, people);
    await sendEnvelope(t.http, owner, envelope.id, { expiresInDays: 1 }).expect(200);
    const { expiresAt } = await envelopeRow(envelope.id);
    return { envelope, pastDeadline: new Date(expiresAt + 1000) };
  }

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    for (const name of [EMAIL_QUEUE, SEAL_QUEUE, MAINTENANCE_QUEUE]) {
      await t.app.get<Queue>(getQueueToken(name)).obliterate({ force: true });
    }
    worker = await createTestWorker();
    sweep = worker.module.get(ExpirySweepService);
    owner = await registerUser(t.http, { fullName: 'Expiry Owner' });
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
  });

  it('pauses an overdue envelope once, and tells the sender once', async () => {
    const signer = person('Late Signer');
    const { envelope, pastDeadline } = await sentTo([signer]);
    const token = await linkFor(worker.mailbox, signer.email);

    // Not yet due: nothing happens.
    const early = await sweep.run(new Date(pastDeadline.getTime() - 2 * HOUR));
    expect(early.changed).toBe(0);
    expect((await envelopeRow(envelope.id)).status).toBe('SENT');

    // Two overlapping runs expire it once.
    const runs = await Promise.all([sweep.run(pastDeadline), sweep.run(pastDeadline)]);
    expect(runs.reduce((sum, run) => sum + run.changed, 0)).toBe(1);
    const row = await envelopeRow(envelope.id);
    expect(row.status).toBe('EXPIRED');
    expect(row.expiredAt).toBe(pastDeadline.getTime());
    expect(await expiredEvents(envelope.id)).toEqual([
      { metadata: { unsigned: 1, fromStatus: 'SENT' }, ipAddress: 'system' },
    ]);

    const notice = await waitFor(() => emailsTo(worker.mailbox, owner.email, 'expired').at(0));
    expect(notice.subject).toBe('Agreement under test expired before everyone signed');
    expect(notice.text).toContain('Late Signer still had to sign');
    expect(notice.text).toContain(`/dashboard/envelopes/${envelope.id}`);

    // A later run leaves it alone and sends nothing more.
    expect((await sweep.run(new Date(pastDeadline.getTime() + HOUR))).changed).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(emailsTo(worker.mailbox, owner.email, 'expired')).toHaveLength(1);

    // The signer's link reads as expired.
    const open = await request(t.http).get(`/api/v1/sign/${token}`).expect(401);
    expect(open.body.code).toBe('TOKEN_EXPIRED');
  });

  it('leaves an envelope everyone signed in time for the seal to finish', async () => {
    const { envelope, pastDeadline } = await sentTo([person('Quick Signer')]);
    // As if they signed before the deadline and the seal has not run yet.
    await ownerQuery(
      `UPDATE "Recipient" SET status = 'SIGNED', "signedAt" = now(), "tokenUsedAt" = now()
        WHERE "envelopeId" = $1`,
      [envelope.id],
    );
    expect((await sweep.run(pastDeadline)).changed).toBe(0);
    expect((await envelopeRow(envelope.id)).status).toBe('SENT');
  });

  it('refuses a reminder once the deadline has passed, swept or not', async () => {
    const { envelope } = await sentTo([person('Remind Late')]);
    const remind = () =>
      request(t.http)
        .post(`/api/v1/envelopes/${envelope.id}/remind`)
        .set('Authorization', bearer(owner))
        .send({});

    await ownerQuery(
      `UPDATE "Envelope" SET "expiresAt" = now() - interval '1 minute' WHERE id = $1`,
      [envelope.id],
    );
    expect((await remind().expect(409)).body.code).toBe('ENVELOPE_EXPIRED');

    await sweep.run();
    expect((await envelopeRow(envelope.id)).status).toBe('EXPIRED');
    expect((await remind().expect(409)).body.code).toBe('ENVELOPE_EXPIRED');

    const { rows } = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM "AuditTrail"
        WHERE "envelopeId" = $1 AND action = 'REMINDER_REQUESTED'`,
      [envelope.id],
    );
    expect(rows[0]?.n).toBe(0);
  });

  it('cancels an expired envelope with a reason', async () => {
    const { envelope, pastDeadline } = await sentTo([person('Never Signed')]);
    await sweep.run(pastDeadline);
    const res = await request(t.http)
      .post(`/api/v1/envelopes/${envelope.id}/void`)
      .set('Authorization', bearer(owner))
      .send({ reason: 'No longer needed.' })
      .expect(200);
    expect(res.body.status).toBe('VOIDED');
    expect((await envelopeRow(envelope.id)).expiredAt).not.toBeNull();
  });
});
