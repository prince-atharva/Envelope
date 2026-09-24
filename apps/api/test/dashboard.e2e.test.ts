import type { EnvelopeListResponse, EnvelopeSummary } from '@envelope/shared';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMAIL_QUEUE, SEAL_QUEUE } from '../src/queue/queue.module';
import { createTestApp, createTestWorker, type TestApp, type TestWorker } from './helpers/app';
import { registerUser, type SignedInUser } from './helpers/auth';
import { ownerQuery, truncateAll } from './helpers/db';
import {
  bearer,
  linkFor,
  type PersonSpec,
  type PreparedEnvelope,
  prepareEnvelope,
  sendEnvelope,
} from './helpers/signing';

let counter = 0;
function person(name: string): PersonSpec {
  counter += 1;
  return { name, email: `${name.toLowerCase().replaceAll(' ', '.')}.${counter}@example.com` };
}

/** Dashboard views and Needs attention (docs/16 step 14). */
describe('dashboard views (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;
  let stranger: SignedInUser;
  const ids: Record<string, string> = {};

  const list = async (as: SignedInUser, query: string): Promise<EnvelopeListResponse> =>
    (
      await request(t.http)
        .get(`/api/v1/envelopes?${query}`)
        .set('Authorization', bearer(as))
        .expect(200)
    ).body as EnvelopeListResponse;

  /** Every page of a view, following the cursor. */
  async function all(as: SignedInUser, query: string): Promise<EnvelopeSummary[]> {
    const items: EnvelopeSummary[] = [];
    let cursor: string | null = null;
    do {
      const page = await list(
        as,
        `${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    return items;
  }

  /** Sent to one signer, whose invitation has been emailed. */
  async function sent(as: SignedInUser, name: string): Promise<PreparedEnvelope> {
    const signer = person(name);
    const envelope = await prepareEnvelope(t.http, as, [signer]);
    await sendEnvelope(t.http, as, envelope.id).expect(200);
    await linkFor(worker.mailbox, signer.email);
    // The worker records notifiedAt just after sending; let it land first.
    for (let i = 0; i < 40; i += 1) {
      const { rows } = await ownerQuery<{ n: number }>(
        `SELECT count(*)::int AS n FROM "Recipient" WHERE "envelopeId" = $1 AND "notifiedAt" IS NOT NULL`,
        [envelope.id],
      );
      if (rows[0]?.n === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return envelope;
  }

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    for (const name of [EMAIL_QUEUE, SEAL_QUEUE]) {
      await t.app.get<Queue>(getQueueToken(name)).obliterate({ force: true });
    }
    worker = await createTestWorker();
    owner = await registerUser(t.http, { fullName: 'Dashboard Owner' });
    stranger = await registerUser(t.http, { fullName: 'Other Workspace' });

    // 1. Expired three days ago.
    const expired = await sent(owner, 'Expired Signer');
    await ownerQuery(
      `UPDATE "Envelope" SET status = 'EXPIRED',
              "expiresAt" = now() AT TIME ZONE 'UTC' - interval '3 days',
              "expiredAt" = now() AT TIME ZONE 'UTC' - interval '3 days' WHERE id = $1`,
      [expired.id],
    );
    ids.expired = expired.id;

    // 1 too: past its deadline a minute ago, before the sweep has paused it.
    const overdue = await sent(owner, 'Overdue Signer');
    await ownerQuery(
      `UPDATE "Envelope" SET "expiresAt" = now() AT TIME ZONE 'UTC' - interval '1 minute'
        WHERE id = $1`,
      [overdue.id],
    );
    ids.overdue = overdue.id;

    // 2. Emailed three days ago and never opened.
    const unopened = await sent(owner, 'Unopened Signer');
    await ownerQuery(
      `UPDATE "Recipient" SET "invitedAt" = "invitedAt" - interval '3 days',
              "notifiedAt" = "notifiedAt" - interval '3 days' WHERE "envelopeId" = $1`,
      [unopened.id],
    );
    ids.unopened = unopened.id;

    // 3. Invited two hours ago; no mail server ever accepted the email.
    const undelivered = await sent(owner, 'Undelivered Signer');
    await ownerQuery(
      `UPDATE "Recipient" SET "invitedAt" = "invitedAt" - interval '2 hours', "notifiedAt" = NULL
        WHERE "envelopeId" = $1`,
      [undelivered.id],
    );
    ids.undelivered = undelivered.id;

    // 4. Expires tomorrow.
    const expiring = await sent(owner, 'Expiring Signer');
    await ownerQuery(
      `UPDATE "Envelope" SET "expiresAt" = now() AT TIME ZONE 'UTC' + interval '1 day' WHERE id = $1`,
      [expiring.id],
    );
    ids.expiring = expiring.id;

    // 5. Declined yesterday.
    const declined = await prepareEnvelope(t.http, owner, [person('Declining Signer')]);
    await sendEnvelope(t.http, owner, declined.id).expect(200);
    const token = await linkFor(worker.mailbox, declined.recipients[0]?.email ?? '');
    await request(t.http)
      .post(`/api/v1/sign/${token}/decline`)
      .send({ reason: 'Wrong terms.' })
      .expect(200);
    await ownerQuery(
      `UPDATE "Recipient" SET "declinedAt" = "declinedAt" - interval '1 day' WHERE "envelopeId" = $1`,
      [declined.id],
    );
    ids.declined = declined.id;

    // Fine: sent just now, nothing to chase.
    ids.fresh = (await sent(owner, 'Fresh Signer')).id;
    // A draft, a cancelled document and a discarded draft.
    ids.draft = (await prepareEnvelope(t.http, owner, [person('Draft Signer')])).id;
    const cancelled = await sent(owner, 'Cancelled Signer');
    await request(t.http)
      .post(`/api/v1/envelopes/${cancelled.id}/void`)
      .set('Authorization', bearer(owner))
      .send({ reason: 'Replaced.' })
      .expect(200);
    ids.cancelled = cancelled.id;
    const discarded = await prepareEnvelope(t.http, owner, [person('Discarded Signer')]);
    await request(t.http)
      .post(`/api/v1/envelopes/${discarded.id}/void`)
      .set('Authorization', bearer(owner))
      .expect(200);
    ids.discarded = discarded.id;

    // Another workspace's expired envelope must never show up.
    const theirs = await sent(stranger, 'Stranger Signer');
    await ownerQuery(
      `UPDATE "Envelope" SET status = 'EXPIRED', "expiredAt" = now() AT TIME ZONE 'UTC'
        WHERE id = $1`,
      [theirs.id],
    );
    ids.theirs = theirs.id;
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
  });

  it('lists what to chase in rank order, with the reason and since when', async () => {
    const items = await all(owner, 'view=attention&limit=2');
    expect(items.map((item) => item.id)).toEqual([
      ids.expired,
      ids.overdue,
      ids.unopened,
      ids.undelivered,
      ids.expiring,
      ids.declined,
    ]);
    expect(items.map((item) => item.attention?.reason)).toEqual([
      'EXPIRED',
      'EXPIRED',
      'NOT_OPENED',
      'EMAIL_NOT_DELIVERED',
      'EXPIRING_SOON',
      'DECLINED',
    ]);
    const unopened = items[2];
    expect(unopened?.progress).toMatchObject({
      signed: 0,
      total: 1,
      waitingOn: ['Unopened Signer'],
    });
    expect(unopened?.progress?.oldestUnviewedSince).toBe(unopened?.attention?.since);
  });

  it('counts every tab in one call, and keeps workspaces apart', async () => {
    const counts = (
      await request(t.http)
        .get('/api/v1/envelopes/counts')
        .set('Authorization', bearer(owner))
        .expect(200)
    ).body;
    expect(counts).toEqual({
      attention: 6,
      // Expired, overdue, not opened, not delivered, expiring and fresh.
      waiting: 6,
      completed: 0,
      // The cancelled one, the declined one, and the discarded draft.
      cancelled: 3,
      drafts: 1,
      all: 10,
    });

    const theirs = await all(stranger, 'view=attention');
    expect(theirs.map((item) => item.id)).toEqual([ids.theirs]);
  });

  it('filters the other views, newest first, and by status', async () => {
    const cancelled = await all(owner, 'view=cancelled');
    expect(cancelled.map((item) => item.id)).toEqual([ids.discarded, ids.cancelled, ids.declined]);
    expect(cancelled.every((item) => item.attention === undefined)).toBe(true);

    const drafts = await all(owner, 'view=drafts');
    expect(drafts.map((item) => item.id)).toEqual([ids.draft]);
    expect(drafts[0]?.progress).toBeNull();

    const expiredOnly = await all(owner, 'view=attention&status=EXPIRED');
    expect(expiredOnly.map((item) => item.id)).toEqual([ids.expired]);
    const doc08Filter = await all(owner, 'status=DRAFT');
    expect(doc08Filter.map((item) => item.id)).toEqual([ids.draft]);
  });

  it('refuses a bad view or cursor', async () => {
    await request(t.http)
      .get('/api/v1/envelopes?view=everything')
      .set('Authorization', bearer(owner))
      .expect(400);
    await request(t.http)
      .get('/api/v1/envelopes?view=attention&cursor=bm90LWEtY3Vyc29y')
      .set('Authorization', bearer(owner))
      .expect(400);
  });
});
