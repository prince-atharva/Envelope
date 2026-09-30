import type { EnvelopeDetail } from '@envelope/shared';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMAIL_QUEUE } from '../src/queue/queue.module';
import {
  captureLogs,
  createTestApp,
  createTestWorker,
  type TestApp,
  type TestWorker,
  waitFor,
} from './helpers/app';
import { registerUser, type SignedInUser, uniqueEmail } from './helpers/auth';
import { ownerQuery, truncateAll } from './helpers/db';
import { bearer, linkFor, prepareEnvelope, sendEnvelope } from './helpers/signing';
import { TEST_ENV } from './test-env';

const SECRET = TEST_ENV.MAIL_EVENTS_SECRET as string;

interface Delivery {
  id: string;
  messageId: string;
  recipientId: string;
  status: string;
  template: string;
}

/** What a mail provider tells us about a message we sent (docs/20 step 7, ADR 0029). */
describe('mail delivery events (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;
  const logs = captureLogs();

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    await t.app.get<Queue>(getQueueToken(EMAIL_QUEUE)).obliterate({ force: true });
    worker = await createTestWorker();
    owner = await registerUser(t.http, {
      fullName: 'Delivery Owner',
      organization: 'Delivery Clinic',
    });
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
    logs.restore();
  });

  const post = (
    adapter: string,
    body: unknown,
    authorization: string | null = `Bearer ${SECRET}`,
  ) => {
    const req = request(t.http).post(`/api/v1/mail-events/${adapter}`);
    return (authorization ? req.set('Authorization', authorization) : req).send(body as object);
  };

  /** A sent envelope with two people, once both invitations have gone out and been remembered. */
  async function sentToTwo() {
    const first = { name: 'Priya Sharma', email: uniqueEmail('priya') };
    const second = { name: 'Raj Patel', email: uniqueEmail('raj') };
    const envelope = await prepareEnvelope(t.http, owner, [first, second]);
    await sendEnvelope(t.http, owner, envelope.id).expect(200);
    await linkFor(worker.mailbox, first.email);
    await linkFor(worker.mailbox, second.email);
    const { rows } = await ownerQuery<Delivery>(
      `SELECT id, "messageId", "recipientId", status, template FROM "MailDelivery"
        WHERE "envelopeId" = $1 ORDER BY "createdAt"`,
      [envelope.id],
    );
    return { envelope, first, second, deliveries: rows };
  }
  const auditRows = async (envelopeId: string, action?: string) =>
    (
      await ownerQuery<{ action: string; recipientId: string | null; metadata: unknown }>(
        `SELECT action, "recipientId", metadata FROM "AuditTrail" WHERE "envelopeId" = $1
          ${action ? 'AND action = $2' : ''} ORDER BY sequence`,
        action ? [envelopeId, action] : [envelopeId],
      )
    ).rows;
  const noticesTo = (email: string, template = 'delivery-failed') =>
    worker.mailbox.messages.filter((m) => m.to === email && m.template === template);

  it('remembers every mail to someone on an envelope, under the Message-ID it was sent with', async () => {
    const { first, second, deliveries } = await sentToTwo();
    expect(deliveries).toHaveLength(2);
    expect(deliveries.every((d) => d.status === 'SENT' && d.template === 'invitation')).toBe(true);
    for (const person of [first, second]) {
      const sent = worker.mailbox.messages.find((m) => m.to === person.email);
      const delivery = deliveries.find((d) => `<${d.messageId}>` === sent?.messageId);
      expect(delivery, person.email).toBeDefined();
    }
  });

  it('records a bounce: the delivery, the audit trail, the sender’s notice and the envelope detail', async () => {
    const { envelope, first, second, deliveries } = await sentToTwo();
    const [bounced, other] = deliveries as [Delivery, Delivery];
    logs.clear();
    const before = (await auditRows(envelope.id)).length;

    const res = await post('generic', {
      messageId: `<${bounced.messageId}>`,
      type: 'BOUNCED',
    }).expect(202);
    expect(res.body).toEqual({ events: 1, recorded: 1 });

    const after = await auditRows(envelope.id);
    expect(after).toHaveLength(before + 1);
    expect(after.at(-1)).toMatchObject({
      action: 'EMAIL_BOUNCED',
      recipientId: bounced.recipientId,
      metadata: { kind: 'invitation' },
    });
    const status = await ownerQuery<{ status: string }>(
      'SELECT status FROM "MailDelivery" WHERE id = $1',
      [bounced.id],
    );
    expect(status.rows[0]?.status).toBe('BOUNCED');

    // The sender is told, once, in words.
    const notice = await waitFor(() => noticesTo(owner.email).at(-1));
    expect(notice.subject).toMatch(/did not arrive/);
    expect(notice.text).toContain('could not be delivered');

    // The envelope shows which person it was, and only that person.
    const detail = (
      await request(t.http)
        .get(`/api/v1/envelopes/${envelope.id}`)
        .set('Authorization', bearer(owner))
        .expect(200)
    ).body as EnvelopeDetail;
    const byId = new Map(detail.recipients.map((r) => [r.id, r.emailProblem]));
    expect(byId.get(bounced.recipientId)).toBe('BOUNCED');
    expect(byId.get(other.recipientId)).toBeNull();
    expect(detail.auditTrail.map((e) => e.action)).toContain('EMAIL_BOUNCED');
    expect([first.email, second.email]).toContain(
      detail.recipients.find((r) => r.id === bounced.recipientId)?.email,
    );

    const log = logs.find('Mail delivery bounced', 'warn')[0];
    expect(log?.fields).toMatchObject({
      envelopeId: envelope.id,
      recipientId: bounced.recipientId,
    });
    // Neither the secret nor an address goes into the logs.
    expect(logs.text()).not.toContain(SECRET);
    expect(logs.text()).not.toContain(first.email);
    expect(logs.text()).not.toContain(second.email);
  });

  it('records a repeated event once, and tells the sender once', async () => {
    const { envelope, deliveries } = await sentToTwo();
    const [bounced] = deliveries as [Delivery];
    const notices = noticesTo(owner.email).length;
    await post('generic', { messageId: bounced.messageId, type: 'BOUNCED' }).expect(202);
    const recorded = await auditRows(envelope.id, 'EMAIL_BOUNCED');
    expect(recorded).toHaveLength(1);
    await waitFor(() => (noticesTo(owner.email).length === notices + 1 ? true : undefined));

    const repeated = await post('generic', {
      messageId: bounced.messageId,
      type: 'BOUNCED',
    }).expect(202);
    expect(repeated.body).toEqual({ events: 1, recorded: 0 });
    expect(await auditRows(envelope.id, 'EMAIL_BOUNCED')).toHaveLength(1);
    // Give a second notice time to arrive if one were wrongly queued.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(noticesTo(owner.email)).toHaveLength(notices + 1);
  });

  it('reads a Postmark spam complaint through the message’s own metadata', async () => {
    const { envelope, deliveries } = await sentToTwo();
    const [, complained] = deliveries as [Delivery, Delivery];
    const before = noticesTo(owner.email).length;
    const res = await post('postmark', {
      RecordType: 'SpamComplaint',
      Email: 'whoever@example.test',
      Metadata: { 'envelope-ref': complained.messageId },
    }).expect(202);
    expect(res.body).toEqual({ events: 1, recorded: 1 });
    expect(await auditRows(envelope.id, 'EMAIL_COMPLAINED')).toHaveLength(1);
    await waitFor(() => (noticesTo(owner.email).length > before ? true : undefined));
    expect(noticesTo(owner.email).at(-1)?.subject).toMatch(/reported your email/);

    // A Postmark record that is not a failure changes nothing.
    const { deliveries: fresh, envelope: other } = await sentToTwo();
    const delivered = await post('postmark', {
      RecordType: 'Delivery',
      Metadata: { 'envelope-ref': fresh[0]?.messageId },
    }).expect(202);
    expect(delivered.body).toEqual({ events: 0, recorded: 0 });
    expect(await auditRows(other.id, 'EMAIL_BOUNCED')).toHaveLength(0);
  });

  it('refuses a wrong or missing secret and writes nothing', async () => {
    const { envelope, deliveries } = await sentToTwo();
    const [bounced] = deliveries as [Delivery];
    const before = (await auditRows(envelope.id)).length;
    const body = { messageId: bounced.messageId, type: 'BOUNCED' };
    for (const header of [
      null,
      'Bearer nope-nope-nope',
      `Bearer ${SECRET}x`,
      `Basic ${Buffer.from('a:b').toString('base64')}`,
      SECRET,
    ]) {
      const res = await post('generic', body, header).expect(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
    }
    expect(await auditRows(envelope.id)).toHaveLength(before);
    const status = await ownerQuery<{ status: string }>(
      'SELECT status FROM "MailDelivery" WHERE id = $1',
      [bounced.id],
    );
    expect(status.rows[0]?.status).toBe('SENT');
    // The same secret as the password of basic auth works too (a provider that only takes a login).
    await post(
      'generic',
      body,
      `Basic ${Buffer.from(`provider:${SECRET}`).toString('base64')}`,
    ).expect(202);
  });

  it('ignores a message it never sent, and says nothing that tells it apart', async () => {
    const known = await sentToTwo();
    const ghost = await post('generic', {
      messageId: 'no-such-message@mail.example.com',
      type: 'BOUNCED',
    }).expect(202);
    expect(ghost.body).toEqual({ events: 1, recorded: 0 });
    expect(await auditRows(known.envelope.id, 'EMAIL_BOUNCED')).toHaveLength(0);
  });

  it('refuses a body it cannot read, and an adapter that does not exist', async () => {
    const res = await post('generic', { messageId: 'x', type: 'OPENED' }).expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    await post('generic', {}).expect(400);
    const missing = await post('ses', {}).expect(404);
    expect(missing.body.code).toBe('NOT_FOUND');
  });

  it('keeps the notice to the sender out of the bounce tracking', async () => {
    const { envelope } = await sentToTwo();
    // Only mail to someone on the envelope is remembered; the sender's own notices are not.
    const { rows } = await ownerQuery<{ template: string }>(
      `SELECT DISTINCT template FROM "MailDelivery" WHERE "envelopeId" = $1`,
      [envelope.id],
    );
    expect(rows.map((r) => r.template)).toEqual(['invitation']);
  });
});
