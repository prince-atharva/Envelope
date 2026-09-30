import type { AuthResponse, MfaChallengeResponse, TwoFactorStatus } from '@envelope/shared';
import { getQueueToken } from '@nestjs/bullmq';
import { JwtService } from '@nestjs/jwt';
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
import { codeFor, type Enrolled, enrol, forgetLastStep } from './helpers/two-factor';

/** Signing in when a second factor is on (docs/19, ADR 0024). */
describe('two-factor: sign in (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  const logs = captureLogs();

  const login = (email: string, password: string) =>
    request(t.http)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', nextClientIp())
      .send({ email, password });
  const challenge = (challengeToken: string, code: string, ip = nextClientIp()) =>
    request(t.http)
      .post('/api/v1/auth/2fa/challenge')
      .set('X-Forwarded-For', ip)
      .send({ challengeToken, code });

  /** A registered, enrolled user, and the challenge a password sign-in now returns. */
  async function enrolledUser(): Promise<{
    user: SignedInUser;
    enrolled: Enrolled;
    token: () => Promise<string>;
  }> {
    const user = await registerUser(t.http);
    const enrolled = await enrol(t.http, user);
    await forgetLastStep(user.body.user.id);
    const token = async () =>
      ((await login(user.email, user.password).expect(200)).body as MfaChallengeResponse)
        .challengeToken;
    return { user, enrolled, token };
  }

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

  it('gives no session and no cookie for a right password, only a challenge', async () => {
    const { user } = await enrolledUser();
    const before = await ownerQuery<{ count: string }>(
      `SELECT count(*)::text AS count FROM "Session" WHERE "userId" = $1`,
      [user.body.user.id],
    );
    const res = await login(user.email, user.password).expect(200);

    expect(res.body).toEqual({ mfaRequired: true, challengeToken: expect.any(String) });
    expect(res.headers['set-cookie']).toBeUndefined();
    const after = await ownerQuery<{ count: string }>(
      `SELECT count(*)::text AS count FROM "Session" WHERE "userId" = $1`,
      [user.body.user.id],
    );
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
    // A wrong password still answers as before, and never reaches the second step.
    expect((await login(user.email, 'wrong password!').expect(401)).body.code).toBe(
      'INVALID_CREDENTIALS',
    );
    expect(logs.find('Login needs a second factor', 'info')).toHaveLength(1);
  });

  it('signs in with the right code, then the same code cannot be used again', async () => {
    const { user, enrolled, token } = await enrolledUser();
    const code = codeFor(enrolled.secret);
    logs.clear();

    const ok = await challenge(await token(), code).expect(200);
    const body = ok.body as AuthResponse;
    expect(body.user.email).toBe(user.email);
    expect(refreshCookieFrom(ok)).toMatch(/^ds_refresh=.+/);
    await request(t.http)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(200);
    expect(logs.find('Login succeeded', 'info')[0]?.fields).toMatchObject({
      userId: user.body.user.id,
      secondFactor: 'totp',
    });

    // Replay: a fresh challenge and the very same code.
    const replay = await challenge(await token(), code).expect(422);
    expect(replay.body.code).toBe('TWO_FACTOR_CODE_INVALID');
    expect(replay.headers['set-cookie']).toBeUndefined();
    expect(logs.text()).not.toContain(enrolled.secret);
  });

  it('refuses a wrong code and gives no session', async () => {
    const { enrolled, token } = await enrolledUser();
    const wrong = codeFor(enrolled.secret) === '000000' ? '000001' : '000000';
    const res = await challenge(await token(), wrong).expect(422);
    expect(res.body.code).toBe('TWO_FACTOR_CODE_INVALID');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('accepts a recovery code once, tells the person, and counts it down', async () => {
    const { user, enrolled, token } = await enrolledUser();
    const [recovery] = enrolled.recoveryCodes;
    if (!recovery) throw new Error('no recovery code');

    const ok = await challenge(await token(), recovery.toUpperCase()).expect(200);
    const access = (ok.body as AuthResponse).accessToken;
    expect(logs.find('Login succeeded', 'info').at(-1)?.fields).toMatchObject({
      secondFactor: 'recovery',
    });

    const again = await challenge(await token(), recovery).expect(422);
    expect(again.body.code).toBe('TWO_FACTOR_CODE_INVALID');

    const notice = await waitFor(() =>
      emailsTo(worker.mailbox, user.email, 'two-factor-notice').find((m) =>
        m.subject.includes('recovery code'),
      ),
    );
    expect(notice.text).toContain('You have 9 unused recovery codes left.');
    const status = await request(t.http)
      .get('/api/v1/auth/2fa')
      .set('Authorization', `Bearer ${access}`)
      .expect(200);
    expect((status.body as TwoFactorStatus).recoveryCodesRemaining).toBe(9);
    expect(logs.text()).not.toContain(recovery);
  });

  it('rejects an expired, tampered or wrong-kind challenge token', async () => {
    const { user, enrolled, token } = await enrolledUser();
    const jwt = t.app.get(JwtService);
    const code = codeFor(enrolled.secret);

    const expired = await jwt.signAsync(
      { sub: user.body.user.id, purpose: 'mfa' },
      { expiresIn: '1ms' },
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    const good = await token();
    const tampered = `${good.slice(0, -3)}${good.endsWith('AAA') ? 'BBB' : 'AAA'}`;
    // An access token is not a challenge, and an enrolment token is not a sign-in one.
    const enrolKind = await jwt.signAsync({ sub: user.body.user.id, purpose: 'mfa-enrol' });

    for (const bad of [expired, tampered, user.accessToken, enrolKind, 'not-a-jwt']) {
      const res = await challenge(bad, code).expect(401);
      expect(res.body.code).toBe('TWO_FACTOR_CHALLENGE_INVALID');
    }
  });

  it('is not an access token: a challenge token as a Bearer token is refused', async () => {
    const { token } = await enrolledUser();
    const res = await request(t.http)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${await token()}`)
      .expect(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('allows 5 attempts per challenge, then answers 429 even to the right code', async () => {
    const { enrolled, token } = await enrolledUser();
    const challengeToken = await token();
    const wrong = codeFor(enrolled.secret) === '000000' ? '000001' : '000000';
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      statuses.push((await challenge(challengeToken, wrong)).status);
    }
    statuses.push((await challenge(challengeToken, codeFor(enrolled.secret))).status);
    expect(statuses).toEqual([422, 422, 422, 422, 422, 429]);
    expect(logs.find('Rate limit exceeded', 'warn').at(-1)?.fields).toMatchObject({
      bucket: 'mfa-challenge',
      limit: 5,
    });
    expect(logs.text()).not.toContain(challengeToken);
  });

  it('starts again if the account was removed or switched off after the password step', async () => {
    const removed = await enrolledUser();
    const removedToken = await removed.token();
    await ownerQuery(`UPDATE "User" SET "disabledAt" = now() WHERE id = $1`, [
      removed.user.body.user.id,
    ]);
    expect(
      (await challenge(removedToken, codeFor(removed.enrolled.secret)).expect(401)).body.code,
    ).toBe('TWO_FACTOR_CHALLENGE_INVALID');

    const switchedOff = await enrolledUser();
    const switchedOffToken = await switchedOff.token();
    await ownerQuery(
      `UPDATE "User" SET "totpEnabledAt" = NULL, "totpSecretCiphertext" = NULL WHERE id = $1`,
      [switchedOff.user.body.user.id],
    );
    expect((await challenge(switchedOffToken, '123456').expect(401)).body.code).toBe(
      'TWO_FACTOR_CHALLENGE_INVALID',
    );
  });

  it('is not bypassed by a password reset: signing in afterwards still asks for the code', async () => {
    const { user } = await enrolledUser();
    await request(t.http)
      .post('/api/v1/auth/password/forgot')
      .set('X-Forwarded-For', nextClientIp())
      .send({ email: user.email })
      .expect(202);
    const mail = await waitFor(() => emailsTo(worker.mailbox, user.email, 'password-reset')[0]);
    const resetToken = /\/reset-password\/([0-9a-f]{64})/.exec(mail.text)?.[1];
    await request(t.http)
      .post(`/api/v1/auth/password/reset/${resetToken}`)
      .set('X-Forwarded-For', nextClientIp())
      .send({ password: 'a brand new password' })
      .expect(204);

    const res = await login(user.email, 'a brand new password').expect(200);
    expect(res.body).toMatchObject({ mfaRequired: true });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('leaves an existing session working when the person later turns two-factor on', async () => {
    const user = await registerUser(t.http);
    const secondDevice = await login(user.email, user.password).expect(200);
    const secondCookie = refreshCookieFrom(secondDevice);
    const secondAccess = (secondDevice.body as AuthResponse).accessToken;

    await enrol(t.http, user);

    // Both sessions from before carry on: enrolling ends nothing. The access
    // tokens work as issued, and refreshing (which rotates a session, as it always
    // has) still succeeds without a code.
    await request(t.http)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${secondAccess}`)
      .expect(200);
    await request(t.http).get('/api/v1/auth/me').set('Authorization', bearer(user)).expect(200);
    await request(t.http).post('/api/v1/auth/refresh').set('Cookie', secondCookie).expect(200);
    await request(t.http).post('/api/v1/auth/refresh').set('Cookie', user.cookie).expect(200);
  });

  it('locks a person out of further codes after 5 wrong ones, even with fresh challenges', async () => {
    const { enrolled, token } = await enrolledUser();
    const wrong = codeFor(enrolled.secret) === '000000' ? '000001' : '000000';
    // Five wrong codes on one challenge (its own limit allows exactly five).
    const first = await token();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await challenge(first, wrong)).status).toBe(422);
    }

    // A fresh challenge, so the per-challenge limit has nothing to say: the person
    // is locked, and even the right code is refused until the window passes.
    const locked = await challenge(await token(), codeFor(enrolled.secret)).expect(429);
    expect(locked.body.code).toBe('RATE_LIMITED');
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
    expect(logs.find('Two-factor attempts refused: too many wrong codes', 'warn')).toHaveLength(1);
  });

  it('forgets earlier wrong codes once a right one is given', async () => {
    const { user, enrolled, token } = await enrolledUser();
    const wrong = codeFor(enrolled.secret) === '000000' ? '000001' : '000000';
    // (Each sign-in is limited to 5 a minute per account, so few challenges are used.)
    const first = await token();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await challenge(first, wrong).expect(422);
    }
    await challenge(await token(), codeFor(enrolled.secret)).expect(200);
    await forgetLastStep(user.body.user.id);
    // The count started again: four more wrong codes are still allowed.
    const later = await token();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await challenge(later, wrong).expect(422);
    }
  });
});
