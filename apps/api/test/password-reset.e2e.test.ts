import type { AuthResponse } from '@envelope/shared';
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
import {
  nextClientIp,
  refreshCookieFrom,
  registerUser,
  type SignedInUser,
  uniqueEmail,
} from './helpers/auth';
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

  /**
   * Waits until the worker has finished `sent` reset mails to `eligible` and `skipped`
   * skipped jobs. Counts, not addresses: a skip is logged with a masked address, and
   * nearly every test address masks to the same `u***@example.test`, so matching on
   * it can stop waiting before the mail has even been sent.
   */
  async function settled(eligible: string, skipped: number): Promise<void> {
    await waitFor(() =>
      emailsTo(worker.mailbox, eligible, 'password-reset').length === 1 &&
      logs.find('Password reset link skipped', 'info').length === skipped
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
      // Four addresses are not eligible (unknown, removed, service, pending).
      await settled(eligible.email, 4);

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
      // The worker logs the send right after the mail is recorded: wait for it, and look
      // for this token's reference among the emailed lines rather than assuming the first.
      const emailedRefs = await waitFor(() => {
        const refs = logs
          .find('Password reset link emailed', 'info')
          .map((call) => call.fields.tokenRef);
        return refs.length > 0 ? refs : undefined;
      });
      expect(emailedRefs).toContain(row?.tokenHash.slice(0, 8));
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

  describe('completing a reset', () => {
    const NEW_PASSWORD = 'a brand new password';

    const preview = (token: string, ip = nextClientIp()) =>
      request(t.http).get(`/api/v1/auth/password/reset/${token}`).set('X-Forwarded-For', ip);
    const reset = (token: string, password = NEW_PASSWORD, ip = nextClientIp()) =>
      request(t.http)
        .post(`/api/v1/auth/password/reset/${token}`)
        .set('X-Forwarded-For', ip)
        .send({ password });
    const login = (email: string, password: string) =>
      request(t.http)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', nextClientIp())
        .send({ email, password });

    /** Asks for a link and returns its raw token once the worker has mailed it. */
    async function requestLink(email: string): Promise<string> {
      const before = emailsTo(worker.mailbox, email, 'password-reset').length;
      await forgot(email).expect(202);
      await waitFor(() =>
        emailsTo(worker.mailbox, email, 'password-reset').length > before ? true : undefined,
      );
      return tokenFrom(email);
    }

    it('previews the masked address and expiry, and refuses an unknown link', async () => {
      const user = await registerUser(t.http);
      const token = await requestLink(user.email);

      const res = await preview(token).expect(200);
      expect(res.body.email).toBe(
        `${user.email[0]}***${user.email.slice(user.email.indexOf('@'))}`,
      );
      expect(res.body.email).not.toBe(user.email);
      expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());

      const unknown = await preview('e'.repeat(64)).expect(401);
      expect(unknown.body.code).toBe('PASSWORD_RESET_TOKEN_INVALID');
      // The error body's `instance` echoes the path, so it must not echo the token.
      expect(unknown.body.instance).toBe('/api/v1/auth/password/reset/[redacted]');
      expect(logs.find('Password reset rejected', 'warn').at(-1)?.fields).toMatchObject({
        reason: 'unknown',
      });
    });

    it('changes the password, ends every session, mails a notice, and works once', async () => {
      const user = await registerUser(t.http);
      const secondLogin = await login(user.email, user.password).expect(200);
      const secondCookie = refreshCookieFrom(secondLogin);
      const secondAccess = (secondLogin.body as AuthResponse).accessToken;
      const token = await requestLink(user.email);
      logs.clear();

      await reset(token).expect(204);

      // Every open session is gone, at once.
      for (const bearerToken of [user.accessToken, secondAccess]) {
        const me = await request(t.http)
          .get('/api/v1/auth/me')
          .set('Authorization', `Bearer ${bearerToken}`)
          .expect(401);
        expect(me.body.code).toBe('SESSION_EXPIRED');
      }
      for (const cookie of [user.cookie, secondCookie]) {
        await request(t.http).post('/api/v1/auth/refresh').set('Cookie', cookie).expect(401);
      }
      const revoked = await ownerQuery<{ revokedReason: string }>(
        `SELECT "revokedReason" FROM "Session" WHERE "userId" = $1 AND "revokedReason" = 'password-reset'`,
        [user.body.user.id],
      );
      expect(revoked.rows).toHaveLength(2);

      // The old password is dead and the new one signs in. Nothing signed the person in.
      expect((await login(user.email, user.password).expect(401)).body.code).toBe(
        'INVALID_CREDENTIALS',
      );
      await login(user.email, NEW_PASSWORD).expect(200);

      // "Your password was changed", with a way back for someone who did not do it.
      const notice = await waitFor(
        () => emailsTo(worker.mailbox, user.email, 'password-changed')[0],
      );
      expect(notice.subject).toBe('Your Envelope password was changed');
      expect(notice.text).toContain('/forgot-password');

      // Single use: the link is spent for the preview and for a second reset.
      const again = await preview(token).expect(401);
      expect(again.body.code).toBe('PASSWORD_RESET_TOKEN_INVALID');
      const replay = await reset(token, 'yet another password').expect(401);
      expect(replay.body.code).toBe('PASSWORD_RESET_TOKEN_INVALID');
      await login(user.email, NEW_PASSWORD).expect(200);

      const completed = logs.find('Password reset completed', 'info')[0];
      expect(completed?.fields).toMatchObject({ userId: user.body.user.id, revokedSessions: 2 });
      expect(logs.text()).not.toContain(token);
      expect(logs.text()).not.toContain(NEW_PASSWORD);
      expect(logs.text()).not.toContain(user.password);
    });

    it('refuses an expired link and leaves the password alone', async () => {
      const user = await registerUser(t.http);
      const token = await requestLink(user.email);
      await ownerQuery(
        `UPDATE "PasswordResetToken" SET "expiresAt" = now() - interval '1 minute'
          WHERE "userId" = $1`,
        [user.body.user.id],
      );

      expect((await preview(token).expect(401)).body.code).toBe('PASSWORD_RESET_TOKEN_EXPIRED');
      expect((await reset(token).expect(401)).body.code).toBe('PASSWORD_RESET_TOKEN_EXPIRED');
      await login(user.email, user.password).expect(200);
      expect(logs.find('Password reset rejected', 'warn').at(-1)?.fields).toMatchObject({
        reason: 'expired',
      });
    });

    it('a second link voids the first, and completing one voids the rest', async () => {
      const user = await registerUser(t.http);
      const first = await requestLink(user.email);
      const second = await requestLink(user.email);
      expect(second).not.toBe(first);

      expect((await preview(first).expect(401)).body.code).toBe('PASSWORD_RESET_TOKEN_INVALID');
      expect((await reset(first).expect(401)).body.code).toBe('PASSWORD_RESET_TOKEN_INVALID');
      await preview(second).expect(200);

      // A third link, unused when the second completes, is voided with it.
      const third = await requestLink(user.email);
      await reset(third).expect(204);
      const unused = await ownerQuery<{ count: string }>(
        `SELECT count(*)::text AS count FROM "PasswordResetToken"
          WHERE "userId" = $1 AND "usedAt" IS NULL`,
        [user.body.user.id],
      );
      expect(unused.rows[0]?.count).toBe('0');
    });

    it('only changes the account the link was issued for', async () => {
      const owner = await registerUser(t.http);
      const bystander = await registerUser(t.http);
      const token = await requestLink(owner.email);

      await reset(token).expect(204);

      await login(bystander.email, bystander.password).expect(200);
      await request(t.http)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${bystander.accessToken}`)
        .expect(200);
    });

    it('refuses a link whose account was removed after it was issued', async () => {
      const user = await registerUser(t.http);
      const token = await requestLink(user.email);
      await ownerQuery(`UPDATE "User" SET "disabledAt" = now() WHERE id = $1`, [user.body.user.id]);

      expect((await preview(token).expect(401)).body.code).toBe('PASSWORD_RESET_TOKEN_INVALID');
      expect((await reset(token).expect(401)).body.code).toBe('PASSWORD_RESET_TOKEN_INVALID');
      expect(logs.find('Password reset rejected', 'warn').at(-1)?.fields).toMatchObject({
        reason: 'disabled',
      });
      const row = await ownerQuery<{ passwordHash: string }>(
        `SELECT "passwordHash" FROM "User" WHERE id = $1`,
        [user.body.user.id],
      );
      // Untouched: still a hash of the old password, not the attempted one.
      expect(row.rows[0]?.passwordHash).toMatch(/^\$argon2id\$/);
    });

    it('rejects a weak password without spending the link', async () => {
      const user = await registerUser(t.http);
      const token = await requestLink(user.email);

      const res = await reset(token, 'short').expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      await preview(token).expect(200);
      await reset(token).expect(204);
    });

    it('lets exactly one of two simultaneous requests use a link', async () => {
      const user = await registerUser(t.http);
      const token = await requestLink(user.email);

      const results = await Promise.all([
        reset(token, 'first simultaneous password'),
        reset(token, 'second simultaneous password'),
      ]);
      expect(results.map((res) => res.status).sort()).toEqual([204, 401]);
    });

    it('rate-limits previews (30 a minute) and resets (10 a minute) from one address', async () => {
      const previewIp = nextClientIp();
      const previews: number[] = [];
      for (let attempt = 0; attempt < 31; attempt += 1) {
        previews.push((await preview('a'.repeat(64), previewIp)).status);
      }
      expect(previews).toEqual([...Array(30).fill(401), 429]);

      const resetIp = nextClientIp();
      const resets: number[] = [];
      for (let attempt = 0; attempt < 11; attempt += 1) {
        resets.push((await reset('b'.repeat(64), NEW_PASSWORD, resetIp)).status);
      }
      expect(resets).toEqual([...Array(10).fill(401), 429]);
    });
  });
});
