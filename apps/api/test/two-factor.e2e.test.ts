import type {
  AuthResponse,
  CreateApiKeyResponse,
  RecoveryCodesResponse,
  TwoFactorSetup,
  TwoFactorStatus,
} from '@envelope/shared';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import { nextClientIp, refreshCookieFrom, registerUser, type SignedInUser } from './helpers/auth';
import { ownerQuery, truncateAll } from './helpers/db';
import { bearer, emailsTo } from './helpers/signing';
import { codeFor, enrol, forgetLastStep } from './helpers/two-factor';

/**
 * Enrolling in, managing and turning off two-factor (docs/19, ADR 0024).
 * Sign-in with a second factor is in two-factor-signin.e2e.test.ts.
 */
describe('two-factor: enrol and manage (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  const logs = captureLogs();

  const as = (user: SignedInUser) => ({
    get: (path: string) =>
      request(t.http)
        .get(`/api/v1/auth/2fa${path}`)
        .set('Authorization', bearer(user))
        .set('X-Forwarded-For', nextClientIp()),
    post: (path: string, body?: object) =>
      request(t.http)
        .post(`/api/v1/auth/2fa${path}`)
        .set('Authorization', bearer(user))
        .set('X-Forwarded-For', nextClientIp())
        .send(body ?? {}),
  });

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    await t.app.get<Queue<EmailJobData>>(getQueueToken(EMAIL_QUEUE)).obliterate({ force: true });
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

  it('is off for an existing user, and says so', async () => {
    const user = await registerUser(t.http);
    const status = (await as(user).get('').expect(200)).body as TwoFactorStatus;
    expect(status).toEqual({ enabled: false, recoveryCodesRemaining: 0, required: false });
    // Nothing about signing in changed for them.
    await request(t.http)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', nextClientIp())
      .send({ email: user.email, password: user.password })
      .expect(200)
      .expect((res) => expect((res.body as AuthResponse).accessToken).toBeTruthy());
  });

  it('sets up a pending secret, stores it only as ciphertext, and never returns it again', async () => {
    const user = await registerUser(t.http);
    const res = await as(user).post('/setup').expect(200);
    const { secret, otpauthUri } = res.body as TwoFactorSetup;
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    const uri = new URL(otpauthUri);
    expect(uri.searchParams.get('secret')).toBe(secret);
    expect(decodeURIComponent(uri.pathname)).toBe(`/Envelope:${user.email}`);

    const row = await ownerQuery<{
      totpSecretCiphertext: string | null;
      totpEnabledAt: Date | null;
    }>(`SELECT "totpSecretCiphertext", "totpEnabledAt" FROM "User" WHERE id = $1`, [
      user.body.user.id,
    ]);
    expect(row.rows[0]?.totpEnabledAt).toBeNull();
    expect(row.rows[0]?.totpSecretCiphertext).toBeTruthy();
    expect(row.rows[0]?.totpSecretCiphertext).not.toContain(secret);

    const status = await as(user).get('').expect(200);
    expect(JSON.stringify(status.body)).not.toContain(secret);
    expect((status.body as TwoFactorStatus).enabled).toBe(false);
    expect(logs.text()).not.toContain(secret);
    expect(logs.text()).not.toContain(otpauthUri);
  });

  it('enables with a valid code, issues ten recovery codes once, and emails a notice', async () => {
    const user = await registerUser(t.http);
    // Nothing to confirm before setup.
    expect((await as(user).post('/enable', { code: '123456' }).expect(400)).body.code).toBe(
      'BAD_REQUEST',
    );
    const { secret } = (await as(user).post('/setup').expect(200)).body as TwoFactorSetup;

    const wrong = codeFor(secret) === '000000' ? '000001' : '000000';
    expect((await as(user).post('/enable', { code: wrong }).expect(422)).body.code).toBe(
      'TWO_FACTOR_CODE_INVALID',
    );

    const code = codeFor(secret);
    const enabled = await as(user).post('/enable', { code }).expect(200);
    const { recoveryCodes } = enabled.body as RecoveryCodesResponse;
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    for (const recovery of recoveryCodes) expect(recovery).toMatch(/^[0-9a-z]{5}-[0-9a-z]{5}$/);

    // Only HMACs are stored, and never the codes themselves.
    const rows = await ownerQuery<{ codeHash: string }>(
      `SELECT "codeHash" FROM "RecoveryCode" WHERE "userId" = $1`,
      [user.body.user.id],
    );
    expect(rows.rows).toHaveLength(10);
    for (const { codeHash } of rows.rows) {
      expect(codeHash).toMatch(/^[0-9a-f]{64}$/);
      for (const recovery of recoveryCodes) {
        expect(codeHash).not.toContain(recovery.replace('-', ''));
      }
    }

    const status = (await as(user).get('').expect(200)).body as TwoFactorStatus;
    expect(status).toEqual({ enabled: true, recoveryCodesRemaining: 10, required: false });

    const notice = await waitFor(
      () => emailsTo(worker.mailbox, user.email, 'two-factor-notice')[0],
    );
    expect(notice.subject).toBe('Two-factor authentication was turned on');
    expect(notice.text).toContain('/forgot-password');

    // Once on, setup and enable are refused, and nothing secret was logged.
    expect((await as(user).post('/setup').expect(409)).body.code).toBe(
      'TWO_FACTOR_ALREADY_ENABLED',
    );
    expect((await as(user).post('/enable', { code }).expect(409)).body.code).toBe(
      'TWO_FACTOR_ALREADY_ENABLED',
    );
    expect(logs.text()).not.toContain(secret);
    for (const recovery of recoveryCodes) expect(logs.text()).not.toContain(recovery);
    expect(logs.find('Two-factor enabled', 'info')).toHaveLength(1);
  });

  it('refuses a code that was already used, even inside its window (no replay)', async () => {
    const user = await registerUser(t.http);
    const { secret } = await enrol(t.http, user);
    const confirm = { password: user.password, code: codeFor(secret) };
    // The code that enabled it is the last step used: it cannot be used again.
    expect((await as(user).post('/recovery-codes', confirm).expect(422)).body.code).toBe(
      'TWO_FACTOR_CODE_INVALID',
    );
    expect(logs.find('Two-factor code rejected', 'warn').at(-1)?.fields).toMatchObject({
      reason: 'wrong-or-used-code',
    });
  });

  it('replaces the recovery codes with the password and a current code, and ends the old ones', async () => {
    const user = await registerUser(t.http);
    const { secret, recoveryCodes } = await enrol(t.http, user);
    await forgetLastStep(user.body.user.id);

    expect(
      (
        await as(user)
          .post('/recovery-codes', { password: 'not the password', code: codeFor(secret) })
          .expect(422)
      ).body.code,
    ).toBe('CURRENT_PASSWORD_INCORRECT');

    const res = await as(user)
      .post('/recovery-codes', { password: user.password, code: codeFor(secret) })
      .expect(200);
    const fresh = (res.body as RecoveryCodesResponse).recoveryCodes;
    expect(fresh).toHaveLength(10);
    expect(fresh.filter((code) => recoveryCodes.includes(code))).toHaveLength(0);
    const rows = await ownerQuery<{ count: string }>(
      `SELECT count(*)::text AS count FROM "RecoveryCode" WHERE "userId" = $1`,
      [user.body.user.id],
    );
    expect(rows.rows[0]?.count).toBe('10');
  });

  it('turns off only with the password and a current code, signs other sessions out and mails a notice', async () => {
    const user = await registerUser(t.http);
    const other = await request(t.http)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', nextClientIp())
      .send({ email: user.email, password: user.password })
      .expect(200);
    const otherCookie = refreshCookieFrom(other);
    const { secret } = await enrol(t.http, user);
    await forgetLastStep(user.body.user.id);
    worker.mailbox.clear();

    // Not with a session alone, not with a wrong password, not with a wrong code.
    await as(user).post('/disable', {}).expect(400);
    expect(
      (
        await as(user)
          .post('/disable', { password: 'nope', code: codeFor(secret) })
          .expect(422)
      ).body.code,
    ).toBe('CURRENT_PASSWORD_INCORRECT');
    expect(
      (await as(user).post('/disable', { password: user.password, code: '000000' }).expect(422))
        .body.code,
    ).toBe('TWO_FACTOR_CODE_INVALID');
    expect(((await as(user).get('').expect(200)).body as TwoFactorStatus).enabled).toBe(true);

    await as(user)
      .post('/disable', { password: user.password, code: codeFor(secret) })
      .expect(204);

    const row = await ownerQuery<{
      totpSecretCiphertext: string | null;
      totpEnabledAt: Date | null;
    }>(`SELECT "totpSecretCiphertext", "totpEnabledAt" FROM "User" WHERE id = $1`, [
      user.body.user.id,
    ]);
    expect(row.rows[0]).toEqual({ totpSecretCiphertext: null, totpEnabledAt: null });
    const codes = await ownerQuery(`SELECT 1 FROM "RecoveryCode" WHERE "userId" = $1`, [
      user.body.user.id,
    ]);
    expect(codes.rowCount).toBe(0);

    // This session stays; the other one was ended.
    await as(user).get('').expect(200);
    await request(t.http).post('/api/v1/auth/refresh').set('Cookie', otherCookie).expect(401);

    const notice = await waitFor(
      () => emailsTo(worker.mailbox, user.email, 'two-factor-notice')[0],
    );
    expect(notice.subject).toBe('Two-factor authentication was turned off');
    expect(
      (await as(user).post('/disable', { password: user.password, code: '123456' }).expect(409))
        .body.code,
    ).toBe('TWO_FACTOR_NOT_ENABLED');
  });

  it('is closed to anonymous callers and to API keys', async () => {
    await request(t.http).get('/api/v1/auth/2fa').expect(401);
    const owner = await registerUser(t.http);
    const created = await request(t.http)
      .post('/api/v1/api-keys')
      .set('Authorization', bearer(owner))
      .send({ label: 'two-factor closed' })
      .expect(201);
    const { rawKey } = created.body as CreateApiKeyResponse;
    for (const path of ['', '/setup']) {
      const res = await request(t.http)
        [path ? 'post' : 'get'](`/api/v1/auth/2fa${path}`)
        .set('Authorization', `Bearer ${rawKey}`)
        .send({});
      expect([401, 403]).toContain(res.status);
    }
  });

  it('limits attempts to 10 in 15 minutes per person', async () => {
    const user = await registerUser(t.http);
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      statuses.push((await as(user).post('/setup')).status);
    }
    expect(statuses).toEqual([...Array(10).fill(200), 429]);
    expect(logs.find('Rate limit exceeded', 'warn').at(-1)?.fields).toMatchObject({
      bucket: 'two-factor-user',
      limit: 10,
    });
  });
});
