import type { AuthResponse } from '@envelope/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

const NEW_PASSWORD = 'a brand new password';

/**
 * Changing one's own password from the Account page (docs/19 slice 2): the
 * current password is checked again, every other session ends, this one stays.
 */
describe('password change (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  const logs = captureLogs();

  const change = (user: SignedInUser, body: object) =>
    request(t.http)
      .post('/api/v1/auth/password/change')
      .set('Authorization', bearer(user))
      .set('X-Forwarded-For', nextClientIp())
      .send(body);
  const login = (email: string, password: string) =>
    request(t.http)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', nextClientIp())
      .send({ email, password });

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
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

  it('changes the password, keeps this session, ends the others and mails a notice', async () => {
    const user = await registerUser(t.http);
    const other = await login(user.email, user.password).expect(200);
    const otherCookie = refreshCookieFrom(other);
    const otherAccess = (other.body as AuthResponse).accessToken;
    logs.clear();

    await change(user, { currentPassword: user.password, newPassword: NEW_PASSWORD }).expect(204);

    // This session carries on: same access token, same refresh cookie.
    await request(t.http).get('/api/v1/auth/me').set('Authorization', bearer(user)).expect(200);
    await request(t.http).post('/api/v1/auth/refresh').set('Cookie', user.cookie).expect(200);
    // The other one is gone, at once.
    const me = await request(t.http)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${otherAccess}`)
      .expect(401);
    expect(me.body.code).toBe('SESSION_EXPIRED');
    await request(t.http).post('/api/v1/auth/refresh').set('Cookie', otherCookie).expect(401);

    const revoked = await ownerQuery<{ revokedReason: string }>(
      `SELECT "revokedReason" FROM "Session" WHERE "userId" = $1 AND "revokedReason" = 'password-change'`,
      [user.body.user.id],
    );
    expect(revoked.rows).toHaveLength(1);

    expect((await login(user.email, user.password).expect(401)).body.code).toBe(
      'INVALID_CREDENTIALS',
    );
    await login(user.email, NEW_PASSWORD).expect(200);

    const notice = await waitFor(() => emailsTo(worker.mailbox, user.email, 'password-changed')[0]);
    expect(notice.subject).toBe('Your Envelope password was changed');
    expect(notice.text).toContain('from its Account page');
    expect(notice.text).toContain('/forgot-password');

    expect(logs.find('Password changed', 'info')[0]?.fields).toMatchObject({
      userId: user.body.user.id,
      revokedSessions: 1,
    });
    expect(logs.text()).not.toContain(NEW_PASSWORD);
    expect(logs.text()).not.toContain(user.password);
  });

  it('refuses a wrong current password and changes nothing', async () => {
    const user = await registerUser(t.http);
    const res = await change(user, {
      currentPassword: 'not my password',
      newPassword: NEW_PASSWORD,
    }).expect(422);
    expect(res.body.code).toBe('CURRENT_PASSWORD_INCORRECT');

    // Still signed in, and the old password still works.
    await request(t.http).get('/api/v1/auth/me').set('Authorization', bearer(user)).expect(200);
    await login(user.email, user.password).expect(200);
    expect(logs.find('Password change rejected', 'warn')[0]?.fields).toMatchObject({
      reason: 'wrong-current-password',
    });
    expect(emailsTo(worker.mailbox, user.email, 'password-changed')).toHaveLength(0);
  });

  it('applies the password policy, and refuses reusing the current one', async () => {
    const user = await registerUser(t.http);
    const short = await change(user, {
      currentPassword: user.password,
      newPassword: 'short',
    }).expect(400);
    expect(short.body.code).toBe('VALIDATION_FAILED');
    const same = await change(user, {
      currentPassword: user.password,
      newPassword: user.password,
    }).expect(400);
    expect(same.body.code).toBe('VALIDATION_FAILED');
    await change(user, { currentPassword: user.password }).expect(400);
  });

  it('needs a signed-in person', async () => {
    await request(t.http)
      .post('/api/v1/auth/password/change')
      .set('X-Forwarded-For', nextClientIp())
      .send({ currentPassword: 'x'.repeat(12), newPassword: NEW_PASSWORD })
      .expect(401);
  });

  it('is limited to 5 an hour per person, however many addresses they use', async () => {
    const user = await registerUser(t.http);
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      statuses.push(
        (await change(user, { currentPassword: 'wrong password!', newPassword: NEW_PASSWORD }))
          .status,
      );
    }
    expect(statuses).toEqual([...Array(5).fill(422), 429]);
    expect(logs.find('Rate limit exceeded', 'warn').at(-1)?.fields).toMatchObject({
      bucket: 'password-change-user',
      limit: 5,
    });
  });
});
