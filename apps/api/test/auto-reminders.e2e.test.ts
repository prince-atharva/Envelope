import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AutoReminderService } from '../src/maintenance/auto-reminder.service';
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
  tokenIn,
} from './helpers/signing';

let counter = 0;
function person(name: string): PersonSpec {
  counter += 1;
  return { name, email: `${name.toLowerCase().replaceAll(' ', '.')}.${counter}@example.com` };
}

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const later = (ms: number) => new Date(Date.now() + ms);

/** Automatic reminders and the "expires soon" email (docs/16 step 10). */
describe('automatic reminders (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;
  let reminders: AutoReminderService;

  async function scheduled(envelopeId: string) {
    const { rows } = await ownerQuery<{ metadata: { kind: string } }>(
      `SELECT metadata FROM "AuditTrail"
        WHERE "envelopeId" = $1 AND action = 'REMINDER_SCHEDULED' ORDER BY sequence`,
      [envelopeId],
    );
    return rows.map((row) => row.metadata.kind);
  }

  async function interval(envelopeId: string) {
    const { rows } = await ownerQuery<{ days: number | null }>(
      `SELECT "reminderIntervalDays" AS days FROM "Envelope" WHERE id = $1`,
      [envelopeId],
    );
    return rows[0]?.days;
  }

  /** Sent to one signer; returns the envelope and the invitation's link. */
  async function sentTo(signer: PersonSpec, body: Record<string, unknown> = {}) {
    const envelope = await prepareEnvelope(t.http, owner, [signer]);
    await sendEnvelope(t.http, owner, envelope.id, body).expect(200);
    return { envelope, token: await linkFor(worker.mailbox, signer.email) };
  }

  const settings = (id: string, intervalDays: number | null) =>
    request(t.http)
      .patch(`/api/v1/envelopes/${id}/reminders`)
      .set('Authorization', bearer(owner))
      .send({ intervalDays });

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    for (const name of [EMAIL_QUEUE, SEAL_QUEUE, MAINTENANCE_QUEUE]) {
      await t.app.get<Queue>(getQueueToken(name)).obliterate({ force: true });
    }
    worker = await createTestWorker();
    reminders = worker.module.get(AutoReminderService);
    owner = await registerUser(t.http, { fullName: 'Reminder Owner' });
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
  });

  it('reminds every few days by default, once per interval, with a new link', async () => {
    const signer = person('Slow Signer');
    const { envelope, token } = await sentTo(signer);
    expect(await interval(envelope.id)).toBe(3);

    await reminders.run(later(2 * DAY));
    expect(await scheduled(envelope.id)).toEqual([]);

    // Two overlapping runs remind them once.
    const due = later(3 * DAY + HOUR);
    await Promise.all([reminders.run(due), reminders.run(due)]);
    expect(await scheduled(envelope.id)).toEqual(['interval']);

    const email = await waitFor(() => emailsTo(worker.mailbox, signer.email, 'reminder').at(0));
    expect((await request(t.http).get(`/api/v1/sign/${token}`).expect(401)).body.code).toBe(
      'TOKEN_INVALID',
    );
    await request(t.http)
      .get(`/api/v1/sign/${tokenIn(email)}`)
      .expect(200);

    // Not again until another interval has passed.
    await reminders.run(later(5 * DAY));
    expect(await scheduled(envelope.id)).toEqual(['interval']);
  });

  it('warns once before the deadline instead of reminding', async () => {
    const signer = person('Deadline Near');
    const { envelope } = await sentTo(signer, { expiresInDays: 3 });

    await reminders.run(later(30 * HOUR));
    expect(await scheduled(envelope.id)).toEqual(['expiry-warning']);
    const warning = await waitFor(() =>
      emailsTo(worker.mailbox, signer.email, 'expiry-warning').at(0),
    );
    expect(warning.subject).toMatch(/^Agreement under test expires in \d days?$/);

    // Once per deadline.
    await reminders.run(later(60 * HOUR));
    expect(await scheduled(envelope.id)).toEqual(['expiry-warning']);
  });

  it('waits while the signer has the document open', async () => {
    const signer = person('Reading Now');
    const { envelope, token } = await sentTo(signer);
    await ownerQuery(
      `UPDATE "Recipient"
          SET "invitedAt" = "invitedAt" - interval '4 days',
              "notifiedAt" = "notifiedAt" - interval '4 days'
        WHERE "envelopeId" = $1`,
      [envelope.id],
    );
    await request(t.http).get(`/api/v1/sign/${token}`).expect(200);

    await reminders.run(later(10 * 60 * 1000));
    expect(await scheduled(envelope.id)).toEqual([]);
    await reminders.run(later(2 * HOUR));
    expect(await scheduled(envelope.id)).toEqual(['interval']);
  });

  it('sends nothing when the sender turned reminders off, and lets them change it', async () => {
    const signer = person('No Nagging');
    const { envelope } = await sentTo(signer, { reminderIntervalDays: null });
    expect(await interval(envelope.id)).toBeNull();
    await reminders.run(later(10 * DAY));
    expect(await scheduled(envelope.id)).toEqual([]);

    expect((await settings(envelope.id, 2).expect(200)).body).toEqual({
      id: envelope.id,
      reminderIntervalDays: 2,
    });
    await reminders.run(later(3 * DAY));
    expect(await scheduled(envelope.id)).toEqual(['interval']);

    await settings(envelope.id, 31).expect(400);
    const { rows } = await ownerQuery<{ metadata: unknown }>(
      `SELECT metadata FROM "AuditTrail" WHERE "envelopeId" = $1 AND action = 'REMINDERS_CHANGED'`,
      [envelope.id],
    );
    expect(rows).toEqual([{ metadata: { from: null, to: 2 } }]);

    const draft = await prepareEnvelope(t.http, owner, [person('Draft Settings')]);
    expect((await settings(draft.id, 3).expect(409)).body.code).toBe('CONFLICT');
  });
});
