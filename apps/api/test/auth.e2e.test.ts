import type { AuthResponse, ProblemDetails, UserProfile } from '@digitalsign/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { REFRESH_REUSE_GRACE_MS } from '../src/auth/session.service';
import { captureLogs, createTestApp, type TestApp } from './helpers/app';
import {
  nextClientIp,
  refreshCookieFrom,
  registerUser,
  TEST_PASSWORD,
  uniqueEmail,
} from './helpers/auth';
import { ownerQuery, truncateAll } from './helpers/db';

describe('auth (e2e)', () => {
  let t: TestApp;
  const logs = captureLogs();

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
    logs.restore();
  });

  beforeEach(() => logs.clear());

  describe('register', () => {
    it('creates a workspace and owner, signs them in, and sets a locked-down refresh cookie', async () => {
      const email = uniqueEmail('Owner').toUpperCase();
      const res = await request(t.http)
        .post('/api/v1/auth/register')
        .set('X-Forwarded-For', nextClientIp())
        .send({
          fullName: 'Priya Shah',
          email: `  ${email} `,
          password: TEST_PASSWORD,
          organization: 'Sunrise Clinic',
        })
        .expect(201);

      const body = res.body as AuthResponse;
      expect(body.tokenType).toBe('Bearer');
      expect(body.expiresIn).toBe(900);
      expect(body.accessToken.split('.')).toHaveLength(3);
      expect(body.user).toMatchObject({
        email: email.toLowerCase(),
        fullName: 'Priya Shah',
        organization: 'Sunrise Clinic',
        role: 'OWNER',
        tenant: { name: 'Sunrise Clinic' },
      });
      expect(body.user.tenant.slug).toMatch(/^sunrise-clinic-[0-9a-f]{8}$/);
      expect(JSON.stringify(body)).not.toContain('passwordHash');

      const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
        c.startsWith('ds_refresh='),
      );
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Strict/);
      expect(cookie).toMatch(/Path=\/api\/v1\/auth/);

      const stored = await ownerQuery<{ passwordHash: string }>(
        'SELECT "passwordHash" FROM "User" WHERE email = $1',
        [email.toLowerCase()],
      );
      const [, algorithm, version, params] = (stored.rows[0]?.passwordHash ?? '').split('$');
      expect({ algorithm, version }).toEqual({ algorithm: 'argon2id', version: 'v=19' });
      expect(params?.split(',').sort()).toEqual(['m=19456', 'p=1', 't=2']);

      expect(logs.find('User registered', 'info')).toHaveLength(1);
      expect(logs.find('User registered')[0]?.fields.email).toMatch(/^o\*\*\*@example\.test$/);
    });

    it('rejects a second account with the same email', async () => {
      const { email } = await registerUser(t.http);
      const res = await request(t.http)
        .post('/api/v1/auth/register')
        .set('X-Forwarded-For', nextClientIp())
        .send({ fullName: 'Someone Else', email, password: TEST_PASSWORD })
        .expect(409);
      expect(res.body).toMatchObject({ code: 'EMAIL_ALREADY_REGISTERED' });
      expect(logs.find('Registration rejected: email already registered')).toHaveLength(1);
    });

    it('explains validation failures per field', async () => {
      const res = await request(t.http)
        .post('/api/v1/auth/register')
        .send({ fullName: 'X', email: 'not-an-email', password: 'short' })
        .expect(400);
      const problem = res.body as ProblemDetails;
      expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
      expect(problem.code).toBe('VALIDATION_FAILED');
      expect(problem.requestId).toBe(res.headers['x-request-id']);
      expect(problem.errors?.map((e) => e.path).sort()).toEqual(['email', 'fullName', 'password']);
    });
  });

  describe('login', () => {
    it('signs in with the right password', async () => {
      const user = await registerUser(t.http);
      logs.clear();
      const res = await request(t.http)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);
      expect((res.body as AuthResponse).user.email).toBe(user.email);
      expect(refreshCookieFrom(res)).toMatch(/^ds_refresh=.+/);
      expect(logs.find('Login succeeded', 'info')).toHaveLength(1);
    });

    it('gives the same answer for a wrong password and an unknown email, and logs why', async () => {
      const user = await registerUser(t.http);
      logs.clear();

      const wrongPassword = await request(t.http)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'definitely not it' })
        .expect(401);
      const unknownEmail = await request(t.http)
        .post('/api/v1/auth/login')
        .send({ email: uniqueEmail('nobody'), password: 'definitely not it' })
        .expect(401);

      for (const res of [wrongPassword, unknownEmail]) {
        expect(res.body).toMatchObject({
          code: 'INVALID_CREDENTIALS',
          title: 'Invalid email or password',
        });
      }
      const reasons = logs.find('Login failed', 'warn').map((call) => call.fields.reason);
      expect(reasons).toEqual(['wrong-password', 'unknown-email']);
      expect(logs.text()).not.toContain('definitely not it');
    });

    it('rate-limits repeated attempts', async () => {
      const email = uniqueEmail('limited');
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 11; attempt += 1) {
        const res = await request(t.http)
          .post('/api/v1/auth/login')
          .set('X-Forwarded-For', '203.0.113.7')
          .send({ email, password: 'wrong password' });
        statuses.push(res.status);
      }
      // Login allows 10 attempts per minute per client IP.
      expect(statuses).toEqual([...Array(10).fill(401), 429]);
      expect(logs.find('Rate limit exceeded', 'warn')).toHaveLength(1);
      expect(logs.find('Rate limit exceeded')[0]?.fields).toMatchObject({
        ip: '203.0.113.7',
        limit: 10,
      });
    });
  });

  describe('sessions', () => {
    it('protects routes and returns the profile for a valid token', async () => {
      const user = await registerUser(t.http);

      const anonymous = await request(t.http).get('/api/v1/auth/me').expect(401);
      expect(anonymous.body).toMatchObject({ code: 'UNAUTHENTICATED' });

      await request(t.http)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer not.a.jwt')
        .expect(401);
      expect(logs.find('Invalid access token', 'warn')).toHaveLength(1);

      const me = await request(t.http)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
      expect((me.body as UserProfile).email).toBe(user.email);
    });

    it('rotates the refresh token on every refresh', async () => {
      const user = await registerUser(t.http);
      const res = await request(t.http)
        .post('/api/v1/auth/refresh')
        .set('Cookie', user.cookie)
        .expect(200);
      const rotated = refreshCookieFrom(res);
      expect(rotated).not.toBe(user.cookie);
      expect((res.body as AuthResponse).accessToken).not.toBe(user.accessToken);
      expect(logs.find('Session refreshed', 'info')).toHaveLength(1);

      // A second refresh with the new cookie works too.
      await request(t.http).post('/api/v1/auth/refresh').set('Cookie', rotated).expect(200);
    });

    it('tolerates a just-rotated token (two tabs) without ending the session', async () => {
      const user = await registerUser(t.http);
      const first = await request(t.http)
        .post('/api/v1/auth/refresh')
        .set('Cookie', user.cookie)
        .expect(200);

      const replay = await request(t.http)
        .post('/api/v1/auth/refresh')
        .set('Cookie', user.cookie)
        .expect(401);
      expect(replay.body).toMatchObject({ code: 'SESSION_EXPIRED' });
      expect(
        logs.find('Refresh token reuse detected; every session from this login was revoked'),
      ).toHaveLength(0);

      // The newer cookie is still good.
      await request(t.http)
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshCookieFrom(first))
        .expect(200);
    });

    it('revokes the whole login when an old refresh token is reused later', async () => {
      const user = await registerUser(t.http);
      const first = await request(t.http)
        .post('/api/v1/auth/refresh')
        .set('Cookie', user.cookie)
        .expect(200);
      const current = first.body as AuthResponse;

      // Pretend the rotation happened longer ago than the grace window.
      await ownerQuery(
        `UPDATE "Session" SET "revokedAt" = now() - make_interval(secs => $1)
          WHERE "revokedReason" = 'rotated' AND "userId" = $2`,
        [REFRESH_REUSE_GRACE_MS / 1000 + 5, current.user.id],
      );

      await request(t.http).post('/api/v1/auth/refresh').set('Cookie', user.cookie).expect(401);

      const reuse = logs.find(
        'Refresh token reuse detected; every session from this login was revoked',
        'warn',
      );
      expect(reuse).toHaveLength(1);
      expect(reuse[0]?.fields).toMatchObject({ userId: current.user.id, revokedSessions: 1 });

      // The attacker's replay also ended the legitimate session.
      await request(t.http)
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshCookieFrom(first))
        .expect(401);
      const me = await request(t.http)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${current.accessToken}`)
        .expect(401);
      expect(me.body).toMatchObject({ code: 'SESSION_EXPIRED' });
    });

    it('logs out: clears the cookie and ends the session immediately', async () => {
      const user = await registerUser(t.http);
      const res = await request(t.http)
        .post('/api/v1/auth/logout')
        .set('Cookie', user.cookie)
        .expect(204);
      const cleared = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
        c.startsWith('ds_refresh='),
      );
      expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
      expect(logs.find('Logged out', 'info')).toHaveLength(1);

      await request(t.http).post('/api/v1/auth/refresh').set('Cookie', user.cookie).expect(401);
      await request(t.http)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(401);
    });

    it('never stores or logs raw refresh tokens or passwords', async () => {
      const user = await registerUser(t.http);
      await request(t.http).post('/api/v1/auth/refresh').set('Cookie', user.cookie).expect(200);
      const rawToken = user.cookie.replace('ds_refresh=', '');

      const stored = await ownerQuery<{ tokenHash: string }>('SELECT "tokenHash" FROM "Session"');
      expect(stored.rows.length).toBeGreaterThan(0);
      for (const row of stored.rows) {
        expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
        expect(row.tokenHash).not.toBe(rawToken);
      }

      const everything = logs.text();
      expect(everything).not.toContain(rawToken);
      expect(everything).not.toContain(TEST_PASSWORD);
      expect(everything).not.toContain(user.accessToken);
    });
  });
});
