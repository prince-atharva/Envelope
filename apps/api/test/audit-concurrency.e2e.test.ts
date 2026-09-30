import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MailTransportService } from '../src/mail/mail-transport.service';
import { EMAIL_QUEUE } from '../src/queue/queue.module';
import {
  createTestApp,
  createTestWorker,
  type TestApp,
  type TestWorker,
  waitFor,
} from './helpers/app';
import { registerUser, type SignedInUser } from './helpers/auth';
import { ownerQuery, truncateAll } from './helpers/db';
import { linkFor, prepareEnvelope, sendEnvelope } from './helpers/signing';

/**
 * Plays the cancel's second half. A cancel locks the envelope row `FOR UPDATE`
 * and then asks for the audit trail's per-envelope advisory lock. This waits
 * until another connection holds an advisory lock (or a short deadline passes,
 * for a transaction that is queued behind the envelope row instead), then asks
 * for it and commits. Before the lock-order fix, the first case is a deadlock.
 */
async function takeAuditLockWhenAnotherHoldsIt(rival: Client, envelopeId: string): Promise<void> {
  const deadline = Date.now() + 1500;
  for (;;) {
    const { rows } = await rival.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_locks
        WHERE locktype = 'advisory' AND granted AND pid <> pg_backend_pid()`,
    );
    if ((rows[0]?.n ?? 0) > 0 || Date.now() > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await rival.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [envelopeId]);
  await rival.query('COMMIT');
}

/**
 * A pre-existing race (docs/18, "A Pre-Existing Race", fixed in workstream 11):
 * the mail worker records EMAIL_SENT after the send call has returned, so
 * another action on the same envelope can land in between. Cancel locks the
 * envelope row `FOR UPDATE`, then waits for the audit trail's per-envelope
 * advisory lock. The mail transaction used to take that advisory lock first,
 * and then needed a key-share lock on the envelope row (the audit row's
 * foreign key) that the cancel already held: each waited on the other, and
 * Postgres aborted one with 40P01.
 *
 * The first test plays the cancel's part on a plain connection, at the one
 * moment that made the race certain instead of rare: after the invitation is
 * handed to the mail transport, before the mail worker records it.
 */
describe('audit writes on one envelope from two transactions (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    await t.app.get<Queue>(getQueueToken(EMAIL_QUEUE)).obliterate({ force: true });
    worker = await createTestWorker();
    owner = await registerUser(t.http, { fullName: 'Race Owner', organization: 'Race Clinic' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
  });

  it('lets the mail worker record EMAIL_SENT while a cancel holds the envelope', async () => {
    const envelope = await prepareEnvelope(t.http, owner, [
      { name: 'Race Signer', email: 'race.signer@example.com' },
    ]);

    const rival = new Client({ connectionString: process.env.DIRECT_DATABASE_URL });
    await rival.connect();
    let rivalDone: Promise<void> = Promise.resolve();

    const transport = worker.module.get(MailTransportService);
    const original = transport.send.bind(transport);
    const send = vi.spyOn(transport, 'send').mockImplementation(async (email, template) => {
      if (send.mock.calls.length === 1) {
        await rival.query('BEGIN');
        await rival.query(`SELECT id FROM "Envelope" WHERE id = $1 FOR UPDATE`, [envelope.id]);
        // Reaches for the audit lock only once the mail transaction holds it
        // (or is queued behind the envelope), as a cancel does after its status change.
        rivalDone = takeAuditLockWhenAnotherHoldsIt(rival, envelope.id);
      }
      return original(email, template);
    });

    try {
      await sendEnvelope(t.http, owner, envelope.id).expect(200);
      await waitFor(async () => {
        const { rows } = await ownerQuery<{ n: number }>(
          `SELECT count(*)::int AS n FROM "AuditTrail" WHERE "envelopeId" = $1 AND action = 'EMAIL_SENT'`,
          [envelope.id],
        );
        return rows[0]?.n === 1 ? true : undefined;
      }, 15_000);
      await expect(rivalDone).resolves.toBeUndefined();
    } finally {
      await rival.end();
    }

    // A deadlock victim would have been retried, and the invitation sent twice.
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('lets a signer open their link while a cancel holds the envelope', async () => {
    const email = 'race.viewer@example.com';
    const envelope = await prepareEnvelope(t.http, owner, [{ name: 'Race Viewer', email }]);
    await sendEnvelope(t.http, owner, envelope.id).expect(200);
    // Resolves only after the worker's own EMAIL_SENT write, so the two
    // transactions below are the only ones left on this envelope.
    const token = await linkFor(worker.mailbox, email);

    const rival = new Client({ connectionString: process.env.DIRECT_DATABASE_URL });
    await rival.connect();
    try {
      await rival.query('BEGIN');
      await rival.query(`SELECT id FROM "Envelope" WHERE id = $1 FOR UPDATE`, [envelope.id]);
      const opened = request(t.http)
        .get(`/api/v1/sign/${token}`)
        .then((res) => res);
      await takeAuditLockWhenAnotherHoldsIt(rival, envelope.id);
      expect((await opened).status).toBe(200);
    } finally {
      await rival.end();
    }
    const { rows } = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM "AuditTrail" WHERE "envelopeId" = $1 AND action = 'ENVELOPE_VIEWED'`,
      [envelope.id],
    );
    expect(rows[0]?.n).toBe(1);
  });
});
