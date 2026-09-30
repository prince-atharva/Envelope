import type {
  AuthResponse,
  CreateApiKeyResponse,
  EnrolFinishResponse,
  MfaEnrolmentRequiredResponse,
  TenantUser,
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
import {
  nextClientIp,
  refreshCookieFrom,
  registerUser,
  type SignedInUser,
  uniqueEmail,
} from './helpers/auth';
import { ownerQuery, truncateAll } from './helpers/db';
import { bearer, emailsTo } from './helpers/signing';
import { codeFor, enrol, forgetLastStep } from './helpers/two-factor';

const INVITE_LINK = /\/accept-invite\/([0-9a-f]{64})/;
const MEMBER_PASSWORD = 'a fresh chosen password';

/**
 * A workspace requiring two-factor, and an Owner resetting someone's factor
 * (docs/19, ADR 0025). Each test uses its own workspace, so a rule turned on in
 * one never reaches another.
 */
describe('two-factor: workspace policy and owner reset (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  const logs = captureLogs();

  const put = (owner: SignedInUser, required: boolean) =>
    request(t.http)
      .put('/api/v1/tenant/two-factor')
      .set('Authorization', bearer(owner))
      .set('X-Forwarded-For', nextClientIp())
      .send({ required });
  const login = (email: string, password: string) =>
    request(t.http)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', nextClientIp())
      .send({ email, password });
  const post = (path: string, body: object) =>
    request(t.http)
      .post(`/api/v1/auth/2fa${path}`)
      .set('X-Forwarded-For', nextClientIp())
      .send(body);

  /** Invites someone and returns their invitation token, without accepting it. */
  async function inviteToken(owner: SignedInUser, email: string, role = 'MEMBER'): Promise<string> {
    await request(t.http)
      .post('/api/v1/users')
      .set('Authorization', bearer(owner))
      .send({ fullName: 'Policy Person', email, role })
      .expect(201);
    const message = await waitFor(() => emailsTo(worker.mailbox, email, 'user-invited').at(-1));
    const token = INVITE_LINK.exec(message.text)?.[1];
    if (!token) throw new Error('no invite link');
    return token;
  }

  const accept = (token: string) =>
    request(t.http)
      .post(`/api/v1/auth/invitations/${token}/accept`)
      .set('X-Forwarded-For', nextClientIp())
      .send({ password: MEMBER_PASSWORD });

  /** A member who has accepted an invitation and is signed in. */
  async function member(owner: SignedInUser, role = 'MEMBER'): Promise<SignedInUser> {
    const email = uniqueEmail(role.toLowerCase());
    const res = await accept(await inviteToken(owner, email, role)).expect(200);
    const body = res.body as AuthResponse;
    return {
      email,
      password: MEMBER_PASSWORD,
      accessToken: body.accessToken,
      cookie: refreshCookieFrom(res),
      body,
    };
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

  describe('the rule', () => {
    it('cannot be required before the owner has a factor, and only an owner can set it', async () => {
      const owner = await registerUser(t.http);
      const refused = await put(owner, true).expect(403);
      expect(refused.body.code).toBe('TWO_FACTOR_REQUIRED');

      const admin = await member(owner, 'ADMIN');
      expect((await put(admin, true).expect(403)).body.code).toBe('FORBIDDEN_ROLE');
      await request(t.http).put('/api/v1/tenant/two-factor').send({ required: true }).expect(401);

      await enrol(t.http, owner);
      expect((await put(owner, true).expect(200)).body).toEqual({ required: true });
      const status = await request(t.http)
        .get('/api/v1/auth/2fa')
        .set('Authorization', bearer(owner))
        .expect(200);
      expect((status.body as TwoFactorStatus).required).toBe(true);
      expect(logs.find('Two-factor policy changed', 'info')[0]?.fields).toMatchObject({
        changedBy: owner.body.user.id,
        required: true,
      });
      // Turning it off never needs a factor.
      expect((await put(owner, false).expect(200)).body).toEqual({ required: false });
    });
  });

  describe('once required', () => {
    it('sends an unenrolled member to enrolment at sign-in, then signs them in', async () => {
      const owner = await registerUser(t.http);
      const person = await member(owner);
      await enrol(t.http, owner);
      await put(owner, true).expect(200);

      const res = await login(person.email, person.password).expect(200);
      const challenge = res.body as MfaEnrolmentRequiredResponse;
      expect(challenge).toEqual({ mfaEnrolmentRequired: true, challengeToken: expect.any(String) });
      expect(res.headers['set-cookie']).toBeUndefined();

      // The token is for enrolment only: it is no access token and no sign-in challenge.
      await request(t.http)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${challenge.challengeToken}`)
        .expect(401);
      expect(
        (
          await post('/challenge', {
            challengeToken: challenge.challengeToken,
            code: '123456',
          }).expect(401)
        ).body.code,
      ).toBe('TWO_FACTOR_CHALLENGE_INVALID');

      const { secret } = (
        await post('/enrol/start', { challengeToken: challenge.challengeToken }).expect(200)
      ).body as TwoFactorSetup;
      const wrong = codeFor(secret) === '000000' ? '000001' : '000000';
      expect(
        (
          await post('/enrol/finish', {
            challengeToken: challenge.challengeToken,
            code: wrong,
          }).expect(422)
        ).body.code,
      ).toBe('TWO_FACTOR_CODE_INVALID');

      const done = await post('/enrol/finish', {
        challengeToken: challenge.challengeToken,
        code: codeFor(secret),
      }).expect(200);
      const body = done.body as EnrolFinishResponse;
      expect(body.recoveryCodes).toHaveLength(10);
      expect(body.user.email).toBe(person.email);
      expect(refreshCookieFrom(done)).toMatch(/^ds_refresh=.+/);
      await request(t.http)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .expect(200);
      await waitFor(() => emailsTo(worker.mailbox, person.email, 'two-factor-notice')[0]);
      expect(logs.text()).not.toContain(secret);

      // From now on the second step applies to them too.
      expect((await login(person.email, person.password).expect(200)).body).toMatchObject({
        mfaRequired: true,
      });
    });

    it('refuses enrolment tokens for someone already enrolled or in a workspace without the rule', async () => {
      const owner = await registerUser(t.http);
      const person = await member(owner);
      await enrol(t.http, owner);
      await put(owner, true).expect(200);
      const token = (
        (await login(person.email, person.password).expect(200))
          .body as MfaEnrolmentRequiredResponse
      ).challengeToken;

      // The rule is switched off before the person finishes: the token no longer applies.
      await put(owner, false).expect(200);
      expect((await post('/enrol/start', { challengeToken: token }).expect(401)).body.code).toBe(
        'TWO_FACTOR_CHALLENGE_INVALID',
      );
    });

    it('ends an already-signed-in unenrolled member at their next refresh', async () => {
      const owner = await registerUser(t.http);
      const person = await member(owner);
      await enrol(t.http, owner);
      // Signed in and working before the rule exists: nothing about them changed.
      await request(t.http).get('/api/v1/auth/me').set('Authorization', bearer(person)).expect(200);

      await put(owner, true).expect(200);
      logs.clear();
      const res = await request(t.http)
        .post('/api/v1/auth/refresh')
        .set('Cookie', person.cookie)
        .expect(401);
      expect(res.body.code).toBe('SESSION_EXPIRED');
      const left = await ownerQuery<{ count: string }>(
        `SELECT count(*)::text AS count FROM "Session" WHERE "userId" = $1 AND "revokedAt" IS NULL`,
        [person.body.user.id],
      );
      expect(left.rows[0]?.count).toBe('0');
      const reasons = await ownerQuery<{ revokedReason: string }>(
        `SELECT "revokedReason" FROM "Session" WHERE "userId" = $1 AND "revokedReason" = 'two-factor-required'`,
        [person.body.user.id],
      );
      expect(reasons.rows.length).toBeGreaterThan(0);
      expect(logs.find('Refresh refused: the workspace requires two-factor', 'info')).toHaveLength(
        1,
      );

      // Their next sign-in leads to enrolment; an enrolled owner refreshes as usual.
      expect((await login(person.email, person.password).expect(200)).body).toMatchObject({
        mfaEnrolmentRequired: true,
      });
      await request(t.http).post('/api/v1/auth/refresh').set('Cookie', owner.cookie).expect(200);
    });

    it('does not let a member turn their factor off while it is required', async () => {
      const owner = await registerUser(t.http);
      const person = await member(owner);
      const { secret, recoveryCodes } = await enrol(t.http, person);
      await enrol(t.http, owner);
      await put(owner, true).expect(200);
      await forgetLastStep(person.body.user.id);
      worker.mailbox.clear();

      // A recovery code is offered too: the refusal must not spend it or announce it.
      await request(t.http)
        .post('/api/v1/auth/2fa/disable')
        .set('Authorization', bearer(person))
        .set('X-Forwarded-For', nextClientIp())
        .send({ password: person.password, code: recoveryCodes[0] })
        .expect(403);
      const status = await request(t.http)
        .get('/api/v1/auth/2fa')
        .set('Authorization', bearer(person))
        .expect(200);
      expect((status.body as TwoFactorStatus).recoveryCodesRemaining).toBe(10);
      expect(emailsTo(worker.mailbox, person.email, 'two-factor-notice')).toHaveLength(0);

      const res = await request(t.http)
        .post('/api/v1/auth/2fa/disable')
        .set('Authorization', bearer(person))
        .set('X-Forwarded-For', nextClientIp())
        .send({ password: person.password, code: codeFor(secret) })
        .expect(403);
      expect(res.body.code).toBe('TWO_FACTOR_REQUIRED');
      expect(logs.find('Two-factor disable refused', 'warn')[0]?.fields).toMatchObject({
        reason: 'workspace-requires',
      });

      // Once the rule is lifted they may.
      await put(owner, false).expect(200);
      await forgetLastStep(person.body.user.id);
      await request(t.http)
        .post('/api/v1/auth/2fa/disable')
        .set('Authorization', bearer(person))
        .set('X-Forwarded-For', nextClientIp())
        .send({ password: person.password, code: codeFor(secret) })
        .expect(204);
    });

    it('asks a pending invitee to enrol before they get a session', async () => {
      const owner = await registerUser(t.http);
      // Invited before the rule existed, accepted after it (an existing invitation).
      const email = uniqueEmail('pending');
      const token = await inviteToken(owner, email);
      await enrol(t.http, owner);
      await put(owner, true).expect(200);

      const res = await accept(token).expect(200);
      const challenge = res.body as MfaEnrolmentRequiredResponse;
      expect(challenge.mfaEnrolmentRequired).toBe(true);
      expect(res.headers['set-cookie']).toBeUndefined();
      const sessions = await ownerQuery(
        `SELECT 1 FROM "Session" s JOIN "User" u ON u.id = s."userId" WHERE u.email = $1`,
        [email],
      );
      expect(sessions.rowCount).toBe(0);

      const { secret } = (
        await post('/enrol/start', { challengeToken: challenge.challengeToken }).expect(200)
      ).body as TwoFactorSetup;
      const done = await post('/enrol/finish', {
        challengeToken: challenge.challengeToken,
        code: codeFor(secret),
      }).expect(200);
      expect((done.body as EnrolFinishResponse).user.email).toBe(email);
    });

    it('leaves API keys alone', async () => {
      const owner = await registerUser(t.http);
      const created = await request(t.http)
        .post('/api/v1/api-keys')
        .set('Authorization', bearer(owner))
        .send({ label: 'unaffected by two-factor' })
        .expect(201);
      const { rawKey } = created.body as CreateApiKeyResponse;
      await enrol(t.http, owner);
      await put(owner, true).expect(200);

      await request(t.http)
        .get('/api/v1/envelopes')
        .set('Authorization', `Bearer ${rawKey}`)
        .expect(200);
    });
  });

  describe('an owner resetting someone else', () => {
    const reset = (actor: SignedInUser, id: string) =>
      request(t.http)
        .delete(`/api/v1/users/${id}/two-factor`)
        .set('Authorization', bearer(actor))
        .set('X-Forwarded-For', nextClientIp());

    it('clears their factor, signs them out, mails them, and lists it in the users', async () => {
      const owner = await registerUser(t.http);
      const person = await member(owner);
      await enrol(t.http, person);

      const listed = await request(t.http)
        .get('/api/v1/users')
        .set('Authorization', bearer(owner))
        .expect(200);
      const users = listed.body as TenantUser[];
      expect(users.find((u) => u.id === person.body.user.id)?.twoFactorEnabled).toBe(true);
      expect(users.find((u) => u.id === owner.body.user.id)?.twoFactorEnabled).toBe(false);
      worker.mailbox.clear();
      logs.clear();

      await reset(owner, person.body.user.id).expect(204);

      const row = await ownerQuery<{
        totpSecretCiphertext: string | null;
        totpEnabledAt: Date | null;
      }>(`SELECT "totpSecretCiphertext", "totpEnabledAt" FROM "User" WHERE id = $1`, [
        person.body.user.id,
      ]);
      expect(row.rows[0]).toEqual({ totpSecretCiphertext: null, totpEnabledAt: null });
      const codes = await ownerQuery(`SELECT 1 FROM "RecoveryCode" WHERE "userId" = $1`, [
        person.body.user.id,
      ]);
      expect(codes.rowCount).toBe(0);

      // Their session ended at once.
      expect(
        (
          await request(t.http)
            .get('/api/v1/auth/me')
            .set('Authorization', bearer(person))
            .expect(401)
        ).body.code,
      ).toBe('SESSION_EXPIRED');
      await request(t.http).post('/api/v1/auth/refresh').set('Cookie', person.cookie).expect(401);

      const notice = await waitFor(
        () => emailsTo(worker.mailbox, person.email, 'two-factor-notice')[0],
      );
      expect(notice.subject).toBe('Your two-factor authentication was reset');
      expect(logs.find('Two-factor reset by an owner', 'info')[0]?.fields).toMatchObject({
        userId: person.body.user.id,
        resetBy: owner.body.user.id,
      });

      // With no rule on, they sign in with the password alone again.
      const back = await login(person.email, person.password).expect(200);
      expect((back.body as AuthResponse).accessToken).toBeTruthy();
    });

    it('sends them to enrolment on their next sign-in when the workspace requires it', async () => {
      const owner = await registerUser(t.http);
      const person = await member(owner);
      await enrol(t.http, person);
      await enrol(t.http, owner);
      await put(owner, true).expect(200);

      await reset(owner, person.body.user.id).expect(204);
      expect((await login(person.email, person.password).expect(200)).body).toMatchObject({
        mfaEnrolmentRequired: true,
      });
    });

    it('refuses oneself, someone with no factor, a non-owner and another workspace', async () => {
      const owner = await registerUser(t.http);
      const person = await member(owner);
      const admin = await member(owner, 'ADMIN');
      const stranger = await registerUser(t.http, { organization: 'Elsewhere Clinic' });
      await enrol(t.http, person);
      await enrol(t.http, owner);

      expect((await reset(owner, owner.body.user.id).expect(400)).body.code).toBe('BAD_REQUEST');
      expect((await reset(owner, admin.body.user.id).expect(409)).body.code).toBe(
        'TWO_FACTOR_NOT_ENABLED',
      );
      expect((await reset(admin, person.body.user.id).expect(403)).body.code).toBe(
        'FORBIDDEN_ROLE',
      );
      expect((await reset(person, person.body.user.id).expect(403)).body.code).toBe(
        'FORBIDDEN_ROLE',
      );
      expect((await reset(stranger, person.body.user.id).expect(404)).body.code).toBe('NOT_FOUND');
      // Nothing was cleared by any of that.
      const still = await ownerQuery<{ totpEnabledAt: Date | null }>(
        `SELECT "totpEnabledAt" FROM "User" WHERE id = $1`,
        [person.body.user.id],
      );
      expect(still.rows[0]?.totpEnabledAt).toBeInstanceOf(Date);
    });
  });
});
