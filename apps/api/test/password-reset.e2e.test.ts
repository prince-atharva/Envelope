import { FORGOT_PASSWORD_MESSAGE, PASSWORD_RESET_TOKEN_EXPIRY_MINUTES } from '@envelope/shared';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailJobData } from '../src/mail/mail.types';
import { MailQueueService } from '../src/mail/mail-queue.service';
import { EMAIL_QUEUE } from '../src/queue/queue.module';
import {
  captureLogs,
  createTestApp,
  createTestWorker,
  type TestApp,
  type TestWorker,
  waitFor,
} from './helpers/app';
import { nextClientIp, registerUser, type SignedInUser, uniqueEmail } from './helpers/auth';
import { ownerQuery, truncateAll } from './helpers/db';
import { bearer, emailsTo } from './helpers/signing';

const RESET_LINK = /\/reset-password\/([0-9a-f]{64})/;

/**
 * Password reset (docs/19, ADR 0022, ADR 0023): asking for a link, and the
 * uniform answer that keeps the route from revealing which addresses have an
 * account.
 */
describe('password reset (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let queue: Queue<EmailJobData>;
  const logs = captureLogs();

  const forgot = (email: string, ip = nextClientIp()) =>
    request(t.http).post('/api/v1/auth/password/forgot').set('X-Forwarded-For', ip).send({ email });

  /** Waits for the worker to finish one reset job for `email`: a mail, or a logged skip. */
  async function settled(email: string): Promise<void> {
    await waitFor(() =>
      emailsTo(worker.mailbox, email, 'password-reset').length > 0 ||
      logs
        .find('Password reset link skipped', 'info')
        .some(
          (call) => call.fields.email === `${email[0]}***${email.slice(email.lastIndexOf('@'))}`,
        )
        ? true
        : undefined,
    );
  }

  function tokenFrom(email: string): string {
    const message = emailsTo(worker.mailbox, email, 'password-reset').at(-1);
    const token = message ? RESET_LINK.exec(message.text)?.[1] : undefined;
    if (!token) throw new Error(`no reset link in the email to ${email}`);
    return token;
  }

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    queue = t.app.get<Queue<EmailJobData>>(getQueueToken(EMAIL_QUEUE));
    await queue.obliterate({ force: true });
    worker = await createTestWorker();
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
    logs.restore();
  });

  beforeEach(() => {
    worker.mailbox.clear();
    logs.clear();
  });

  describe('asking for a link', () => {
    it('answers every kind of address with the same 202 and body, and emails only an eligible account', async () => {
      const eligible = await registerUser(t.http, { fullName: 'Eligible Sender' });
      const unknown = uniqueEmail('nobody');
      const owner = await registerUser(t.http, { organization: 'Uniform Clinic' });
      const removed = await registerUser(t.http);
      const service = await registerUser(t.http);
      await ownerQuery(`UPDATE "User" SET "disabledAt" = now() WHERE email = $1`, [removed.email]);
      await ownerQuery(`UPDATE "User" SET "isServiceAccount" = true WHERE email = $1`, [
        service.email,
      ]);
      const pending = uniqueEmail('pending');
      await request(t.http)
        .post('/api/v1/users')
        .set('Authorization', bearer(owner))
        .send({ fullName: 'Pending Person', email: pending, role: 'MEMBER' })
        .expect(201);
      // The invitation email itself is not a reset link.
      await waitFor(() => emailsTo(worker.mailbox, pending, 'user-invited')[0]);
      worker.mailbox.clear();
      logs.clear();

      const addresses = [eligible.email, unknown, removed.email, service.email, pending];
      const responses = [];
      for (const email of addresses) responses.push(await forgot(email));

      for (const res of responses) {
        expect(res.status).toBe(202);
        expect(res.body).toEqual({ message: FORGOT_PASSWORD_MESSAGE });
      }
      for (const email of addresses) await settled(email);

      expect(emailsTo(worker.mailbox, eligible.email, 'password-reset')).toHaveLength(1);
      for (const email of [unknown, removed.email, service.email, pending]) {
        expect(emailsTo(worker.mailbox, email)).toHaveLength(0);
      }
      const reasons = logs
        .find('Password reset link skipped', 'info')
        .map((call) => call.fields.reason)
        .sort();
      expect(reasons).toEqual([
        'account disabled',
        'invitation pending',
        'service account',
        'user not found',
      ]);
      expect(logs.find('Password reset requested', 'info')).toHaveLength(addresses.length);
    });

    it('emails a link to the reset page, stores only its HMAC, and keeps the raw token out of Redis and the logs', async () => {
      const user = await registerUser(t.http);
      await forgot(user.email).expect(202);
      const message = await waitFor(
        () => emailsTo(worker.mailbox, user.email, 'password-reset')[0],
      );

      expect(message.subject).toBe('Reset your Envelope password');
      const token = tokenFrom(user.email);
      expect(message.html).toContain(`/reset-password/${token}`);

      // Timestamps are stored as UTC without a zone, so the lifetime is measured in SQL.
      const rows = await ownerQuery<{
        tokenHash: string;
        secondsLeft: number;
        usedAt: Date | null;
      }>(
        `SELECT t."tokenHash", t."usedAt",
                EXTRACT(EPOCH FROM (t."expiresAt" - (now() AT TIME ZONE 'UTC')))::float AS "secondsLeft"
           FROM "PasswordResetToken" t
           JOIN "User" u ON u.id = t."userId" WHERE u.email = $1`,
        [user.email],
      );
      expect(rows.rows).toHaveLength(1);
      const [row] = rows.rows;
      expect(row?.usedAt).toBeNull();
      expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row?.tokenHash).not.toBe(token);
      expect(row?.secondsLeft).toBeGreaterThan((PASSWORD_RESET_TOKEN_EXPIRY_MINUTES - 2) * 60);
      expect(row?.secondsLeft).toBeLessThanOrEqual(PASSWORD_RESET_TOKEN_EXPIRY_MINUTES * 60);

      // Nowhere a database, a queue or a log line could leak it.
      const everything = await ownerQuery<{ found: boolean }>(
        `SELECT bool_or(to_jsonb(t)::text LIKE '%' || $1 || '%') AS found FROM "PasswordResetToken" t`,
        [token],
      );
      expect(everything.rows[0]?.found).toBe(false);
      const jobs = await queue.getJobs(['waiting', 'active', 'delayed', 'completed', 'failed']);
      const resetJobs = jobs.filter((job) => job.data.template === 'password-reset');
      expect(resetJobs.length).toBeGreaterThan(0);
      expect(JSON.stringify(resetJobs.map((job) => job.data))).not.toContain(token);
      expect(logs.text()).not.toContain(token);
      expect(logs.text()).not.toContain(user.email);
      const emailed = logs.find('Password reset link emailed', 'info')[0];
      expect(emailed?.fields.tokenRef).toBe(row?.tokenHash.slice(0, 8));
      expect(logs.text()).not.toContain(row?.tokenHash);
    });

    it('a newer link cancels the older ones', async () => {
      const user = await registerUser(t.http);
      await forgot(user.email).expect(202);
      await waitFor(() => emailsTo(worker.mailbox, user.email, 'password-reset')[0]);
      await forgot(user.email).expect(202);
      await waitFor(() =>
        emailsTo(worker.mailbox, user.email, 'password-reset').length === 2 ? true : undefined,
      );

      const rows = await ownerQuery<{ usedAt: Date | null }>(
        `SELECT t."usedAt" FROM "PasswordResetToken" t JOIN "User" u ON u.id = t."userId"
          WHERE u.email = $1 ORDER BY t."createdAt"`,
        [user.email],
      );
      expect(rows.rows).toHaveLength(2);
      expect(rows.rows[0]?.usedAt).toBeInstanceOf(Date);
      expect(rows.rows[1]?.usedAt).toBeNull();
      const [first, second] = emailsTo(worker.mailbox, user.email, 'password-reset').map(
        (m) => RESET_LINK.exec(m.text)?.[1],
      );
      expect(first).not.toBe(second);
    });

    it('rejects a malformed address without queuing anything', async () => {
      const before = await queue.getJobCounts('waiting', 'active', 'delayed');
      const res = await forgot('not-an-email').expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      await request(t.http)
        .post('/api/v1/auth/password/forgot')
        .set('X-Forwarded-For', nextClientIp())
        .send({ email: 'a@b.co', role: 'OWNER' })
        .expect(400);
      expect(await queue.getJobCounts('waiting', 'active', 'delayed')).toEqual(before);
    });

    it('still answers 202 when the queue is down, and logs it', async () => {
      const user = await registerUser(t.http);
      const spy = vi
        .spyOn(t.app.get(MailQueueService), 'enqueuePasswordReset')
        .mockRejectedValueOnce(new Error('redis is down'));
      const res = await forgot(user.email).expect(202);
      spy.mockRestore();
      expect(res.body).toEqual({ message: FORGOT_PASSWORD_MESSAGE });
      expect(logs.find('Password reset email could not be queued', 'error')).toHaveLength(1);
    });
  });

  describe('rate limits', () => {
    it('allows 10 requests an hour from one address, whichever addresses they name', async () => {
      const ip = nextClientIp();
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 11; attempt += 1) {
        statuses.push((await forgot(uniqueEmail('flood'), ip)).status);
      }
      expect(statuses).toEqual([...Array(10).fill(202), 429]);
    });

    it('allows 3 an hour for one mailbox, from any address, and queues nothing for the fourth', async () => {
      const user: SignedInUser = await registerUser(t.http);
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 4; attempt += 1) {
        statuses.push((await forgot(user.email)).status);
      }
      expect(statuses).toEqual([202, 202, 202, 429]);
      const refused = logs.find('Rate limit exceeded', 'warn').at(-1);
      expect(refused?.fields).toMatchObject({ bucket: 'password-reset-account', limit: 3 });
      expect(JSON.stringify(refused)).not.toContain(user.email);
      expect(logs.find('Password reset requested', 'info')).toHaveLength(3);
    });
  });
});
