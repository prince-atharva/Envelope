import { createHmac, randomUUID } from 'node:crypto';
import type { SendEnvelopeResponse } from '@envelope/shared';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../src/audit/audit.service';
import type { EmailJobData } from '../src/mail/mail.types';
import { EMAIL_QUEUE } from '../src/queue/queue.module';
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
import { TEST_ENV } from './test-env';

const hmac = (token: string) =>
  createHmac('sha256', TEST_ENV.SIGNING_TOKEN_SECRET ?? '')
    .update(token)
    .digest('hex');

let counter = 0;
/** People with addresses unique to this run, so mailbox lookups never collide. */
function people(...specs: Omit<PersonSpec, 'email'>[]): PersonSpec[] {
  return specs.map((spec) => {
    counter += 1;
    const local = spec.name.toLowerCase().replaceAll(' ', '.');
    return { ...spec, email: `${local}.${counter}@example.com` };
  });
}

describe('sending and signing (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;
  let outsider: SignedInUser;
  let queue: Queue<EmailJobData>;
  const logs = captureLogs();

  async function recipientRows(envelopeId: string) {
    const { rows } = await ownerQuery<{
      id: string;
      email: string;
      status: string;
      tokenHash: string | null;
      tokenExpiresAt: Date | null;
      invitedAt: Date | null;
      notifiedAt: Date | null;
    }>(
      `SELECT id, email, status, "tokenHash", "tokenExpiresAt", "invitedAt", "notifiedAt"
         FROM "Recipient" WHERE "envelopeId" = $1 ORDER BY "routingOrder", "createdAt"`,
      [envelopeId],
    );
    return rows;
  }

  async function auditActions(envelopeId: string): Promise<string[]> {
    const { rows } = await ownerQuery<{ action: string }>(
      `SELECT action FROM "AuditTrail" WHERE "envelopeId" = $1 ORDER BY sequence`,
      [envelopeId],
    );
    return rows.map((row) => row.action);
  }

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    queue = t.app.get<Queue<EmailJobData>>(getQueueToken(EMAIL_QUEUE));
    await queue.obliterate({ force: true });
    worker = await createTestWorker();
    owner = await registerUser(t.http, { fullName: 'Raj Kumar', organization: 'Signing Clinic' });
    outsider = await registerUser(t.http, { organization: 'Other Clinic' });
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
    logs.restore();
  });

  beforeEach(() => logs.clear());

  describe('sending', () => {
    it('needs an Idempotency-Key', async () => {
      const envelope = await prepareEnvelope(t.http, owner, people({ name: 'Priya Sharma' }));
      const res = await request(t.http)
        .post(`/api/v1/envelopes/${envelope.id}/send`)
        .set('Authorization', bearer(owner))
        .send({})
        .expect(400);
      expect(res.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    });

    it('refuses a draft that is not ready, and changes nothing', async () => {
      const envelope = await prepareEnvelope(t.http, owner, people({ name: 'Priya Sharma' }));
      await request(t.http)
        .put(`/api/v1/envelopes/${envelope.id}/fields`)
        .set('Authorization', bearer(owner))
        .send({ fields: [] })
        .expect(200);

      const res = await sendEnvelope(t.http, owner, envelope.id).expect(422);
      expect(res.body.code).toBe('RECIPIENT_HAS_NO_FIELDS');
      expect(res.body.errors).toEqual([
        { path: `recipients.${envelope.recipients[0]?.id}`, message: expect.any(String) },
      ]);

      const copyOnly = await prepareEnvelope(
        t.http,
        owner,
        people({ name: 'Copy Only', role: 'CC' }),
      );
      const refused = await sendEnvelope(t.http, owner, copyOnly.id).expect(422);
      expect(refused.body.code).toBe('NOT_READY_TO_SEND');

      const { rows } = await ownerQuery<{ status: string; sentAt: Date | null }>(
        `SELECT status, "sentAt" FROM "Envelope" WHERE id = ANY($1)`,
        [[envelope.id, copyOnly.id]],
      );
      expect(rows).toEqual([
        { status: 'DRAFT', sentAt: null },
        { status: 'DRAFT', sentAt: null },
      ]);
      expect(await auditActions(envelope.id)).not.toContain('ENVELOPE_SENT');
    });

    it('sends to every signer at once, and each gets a link of their own', async () => {
      const team = people(
        { name: 'Priya Sharma' },
        { name: 'Anil Mehta', role: 'APPROVER' },
        { name: 'Copy Person', role: 'CC' },
      );
      const envelope = await prepareEnvelope(t.http, owner, team, {
        message: 'Please sign by Friday.',
      });

      const before = Date.now();
      const res = await sendEnvelope(t.http, owner, envelope.id, { expiresInDays: 3 }).expect(200);
      const body = res.body as SendEnvelopeResponse;
      expect(body).toMatchObject({ id: envelope.id, status: 'SENT' });
      expect(body.invited.map((r) => r.id).sort()).toEqual(
        envelope.recipients
          .filter((r) => r.role !== 'CC')
          .map((r) => r.id)
          .sort(),
      );
      const expiresAt = new Date(body.expiresAt).getTime();
      expect(expiresAt - before).toBeGreaterThan(3 * 86_400_000 - 5_000);
      expect(expiresAt - before).toBeLessThan(3 * 86_400_000 + 5_000);

      const [priya, anil, copy] = team;
      if (!priya || !anil || !copy) throw new Error('missing people');
      const priyaToken = await linkFor(worker.mailbox, priya.email);
      const anilToken = await linkFor(worker.mailbox, anil.email);
      expect(priyaToken).not.toBe(anilToken);

      const invitation = emailsTo(worker.mailbox, priya.email, 'invitation')[0];
      expect(invitation?.subject).toBe('Raj Kumar has sent you a document to sign');
      expect(invitation?.text).toContain('Please sign by Friday.');
      expect(emailsTo(worker.mailbox, anil.email)[0]?.subject).toBe(
        'Raj Kumar has sent you a document to approve',
      );
      // Copies go out with the finished document (Phase 4), not now.
      expect(emailsTo(worker.mailbox, copy.email)).toEqual([]);

      const rows = await waitFor(async () => {
        const current = await recipientRows(envelope.id);
        return current.filter((row) => row.notifiedAt).length === 2 ? current : undefined;
      });
      const byEmail = new Map(rows.map((row) => [row.email, row]));
      expect(byEmail.get(priya.email)).toMatchObject({
        status: 'SENT',
        tokenHash: hmac(priyaToken),
      });
      // Compared in SQL: the columns have no time zone, so the pg driver would
      // read them in the machine's local zone.
      const { rows: expiry } = await ownerQuery<{ same: boolean }>(
        `SELECT bool_and(r."tokenExpiresAt" = e."expiresAt") AS same
           FROM "Recipient" r JOIN "Envelope" e ON e.id = r."envelopeId"
          WHERE e.id = $1 AND r."tokenHash" IS NOT NULL`,
        [envelope.id],
      );
      expect(expiry[0]?.same).toBe(true);
      expect(byEmail.get(anil.email)?.tokenHash).toBe(hmac(anilToken));
      expect(byEmail.get(copy.email)).toMatchObject({
        status: 'PENDING',
        tokenHash: null,
        invitedAt: null,
      });

      const actions = await auditActions(envelope.id);
      expect(actions.filter((action) => action === 'ENVELOPE_SENT')).toHaveLength(1);
      expect(actions.filter((action) => action === 'EMAIL_SENT')).toHaveLength(2);
      const { rows: emailEvents } = await ownerQuery<{ recipientId: string | null }>(
        `SELECT "recipientId" FROM "AuditTrail" WHERE "envelopeId" = $1 AND action = 'EMAIL_SENT'`,
        [envelope.id],
      );
      expect(emailEvents.every((event) => event.recipientId !== null)).toBe(true);
      expect((await t.app.get(AuditService).verify(envelope.id)).valid).toBe(true);
    });

    it('emails only the first person when signing one after another', async () => {
      const team = people({ name: 'First Signer' }, { name: 'Second Signer' });
      const envelope = await prepareEnvelope(t.http, owner, team, { sequential: true });

      const res = await sendEnvelope(t.http, owner, envelope.id).expect(200);
      expect((res.body as SendEnvelopeResponse).invited).toEqual([
        { id: envelope.recipients[0]?.id, status: 'SENT' },
      ]);

      const [first, second] = team;
      if (!first || !second) throw new Error('missing people');
      await linkFor(worker.mailbox, first.email);
      const rows = await recipientRows(envelope.id);
      expect(rows.map((row) => row.status)).toEqual(['SENT', 'PENDING']);
      expect(emailsTo(worker.mailbox, second.email)).toEqual([]);
    });

    it('replays a repeated request instead of sending twice', async () => {
      const team = people({ name: 'Replay Signer' });
      const envelope = await prepareEnvelope(t.http, owner, team);
      const key = randomUUID();

      const first = await sendEnvelope(t.http, owner, envelope.id, {}, key).expect(200);
      const again = await sendEnvelope(t.http, owner, envelope.id, {}, key).expect(200);
      expect(again.headers['idempotency-replayed']).toBe('true');
      expect(again.body).toEqual(first.body);

      const mismatch = await sendEnvelope(t.http, owner, envelope.id, { expiresInDays: 5 }, key);
      expect(mismatch.status).toBe(422);
      expect(mismatch.body.code).toBe('IDEMPOTENCY_KEY_MISMATCH');

      const fresh = await sendEnvelope(t.http, owner, envelope.id).expect(409);
      expect(fresh.body.code).toBe('ENVELOPE_NOT_DRAFT');

      await linkFor(worker.mailbox, team[0]?.email ?? '');
      expect(emailsTo(worker.mailbox, team[0]?.email ?? '', 'invitation')).toHaveLength(1);
      expect(
        (await auditActions(envelope.id)).filter((action) => action === 'ENVELOPE_SENT'),
      ).toHaveLength(1);
    });

    it("answers another tenant's envelope exactly like a missing one", async () => {
      const envelope = await prepareEnvelope(t.http, owner, people({ name: 'Tenant Signer' }));
      const theirs = await sendEnvelope(t.http, outsider, envelope.id).expect(404);
      const missing = await sendEnvelope(t.http, outsider, randomUUID()).expect(404);
      expect(theirs.body.code).toBe(missing.body.code);
    });

    it('never puts a raw token on the queue or in the logs', async () => {
      const team = people({ name: 'Leak Check' });
      const envelope = await prepareEnvelope(t.http, owner, team);
      await sendEnvelope(t.http, owner, envelope.id).expect(200);
      const token = await linkFor(worker.mailbox, team[0]?.email ?? '');

      const jobs = await queue.getJobs(['completed', 'waiting', 'active', 'delayed', 'failed']);
      expect(JSON.stringify(jobs.map((job) => job.data))).not.toContain(token);
      expect(logs.text()).not.toContain(token);
    });
  });

  describe('database rules', () => {
    it('refuses a sent envelope without a send time', async () => {
      const envelope = await prepareEnvelope(t.http, owner, people({ name: 'Rule Check' }));
      await expect(
        ownerQuery(`UPDATE "Envelope" SET status = 'SENT' WHERE id = $1`, [envelope.id]),
      ).rejects.toThrow(/Envelope_sent_has_time/);
    });

    it('refuses signed, declined or consented recipients without their evidence', async () => {
      const envelope = await prepareEnvelope(t.http, owner, people({ name: 'Evidence Check' }));
      const id = envelope.recipients[0]?.id;
      await expect(
        ownerQuery(`UPDATE "Recipient" SET status = 'SIGNED', "signedAt" = now() WHERE id = $1`, [
          id,
        ]),
      ).rejects.toThrow(/Recipient_signed_has_evidence/);
      await expect(
        ownerQuery(
          `UPDATE "Recipient" SET status = 'DECLINED', "declinedAt" = now() WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/Recipient_declined_has_reason/);
      await expect(
        ownerQuery(`UPDATE "Recipient" SET "consentGivenAt" = now() WHERE id = $1`, [id]),
      ).rejects.toThrow(/Recipient_consent_has_text/);
      await expect(
        ownerQuery(`UPDATE "Recipient" SET "signatureImageKey" = 'k' WHERE id = $1`, [id]),
      ).rejects.toThrow(/Recipient_signature_has_method/);
    });
  });
});
