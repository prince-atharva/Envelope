import type { AuthResponse, EnvelopeListResponse, TenantUser } from '@envelope/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { bearer, prepareEnvelope } from './helpers/signing';

const INVITE_LINK = /\/accept-invite\/([0-9a-f]{64})/;

/**
 * User roles (docs/17 step 5-6): who may manage a workspace's users, a
 * MEMBER's own visibility scoping, and the invitation flow that gets a
 * second person into a tenant in the first place.
 */
describe('roles and users (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;
  const logs = captureLogs();

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    worker = await createTestWorker();
    owner = await registerUser(t.http, { fullName: 'Roles Owner', organization: 'Roles Clinic' });
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
    logs.restore();
  });

  async function invite(role: 'ADMIN' | 'MEMBER', fullName: string): Promise<SignedInUser> {
    const email = uniqueEmail(role.toLowerCase());
    await request(t.http)
      .post('/api/v1/users')
      .set('Authorization', bearer(owner))
      .send({ fullName, email, role })
      .expect(201);

    const message = await waitFor(() =>
      worker.mailbox.messages.filter((m) => m.to === email && m.template === 'user-invited').at(-1),
    );
    const token = INVITE_LINK.exec(message.text)?.[1];
    if (!token) throw new Error('no invite link in the email');

    // The preview works before acceptance.
    const preview = await request(t.http).get(`/api/v1/auth/invitations/${token}`).expect(200);
    expect(preview.body.email).toBe(email);
    expect(preview.body.workspaceName).toBe(owner.body.user.tenant.name);

    const accepted = await request(t.http)
      .post(`/api/v1/auth/invitations/${token}/accept`)
      .set('X-Forwarded-For', nextClientIp())
      .send({ password: 'a fresh chosen password' })
      .expect(200);
    const body = accepted.body as AuthResponse;
    expect(body.user.role).toBe(role);
    expect(body.user.tenant.id).toBe(owner.body.user.tenant.id);
    return {
      email,
      password: 'a fresh chosen password',
      accessToken: body.accessToken,
      cookie: refreshCookieFrom(accepted),
      body,
    };
  }

  it('OWNER only may see or manage the user list', async () => {
    const member = await invite('MEMBER', 'Scope Member');
    await request(t.http).get('/api/v1/users').set('Authorization', bearer(member)).expect(403);
    const list = await request(t.http)
      .get('/api/v1/users')
      .set('Authorization', bearer(owner))
      .expect(200);
    const users = list.body as TenantUser[];
    expect(users.map((u) => u.email)).toContain(member.email);
  });

  it('an invited account cannot log in with a guessed password until it accepts', async () => {
    const email = uniqueEmail('locked');
    await request(t.http)
      .post('/api/v1/users')
      .set('Authorization', bearer(owner))
      .send({ fullName: 'Locked Person', email, role: 'MEMBER' })
      .expect(201);
    await request(t.http)
      .post('/api/v1/auth/login')
      .send({ email, password: 'a guess at the password' })
      .expect(401);
  });

  it('refuses to demote the last owner (LAST_OWNER, 409)', async () => {
    const res = await request(t.http)
      .patch(`/api/v1/users/${owner.body.user.id}/role`)
      .set('Authorization', bearer(owner))
      .send({ role: 'ADMIN' })
      .expect(409);
    expect(res.body.code).toBe('LAST_OWNER');
  });

  it('an owner cannot remove themselves, whether or not they are the last one (BAD_REQUEST, 400)', async () => {
    await request(t.http)
      .delete(`/api/v1/users/${owner.body.user.id}`)
      .set('Authorization', bearer(owner))
      .expect(400);
  });

  it('an owner cannot remove themselves even with a co-owner present', async () => {
    const secondOwner = await invite('MEMBER', 'Future Owner');
    await request(t.http)
      .patch(`/api/v1/users/${secondOwner.body.user.id}/role`)
      .set('Authorization', bearer(owner))
      .send({ role: 'OWNER' })
      .expect(200);
    await request(t.http)
      .delete(`/api/v1/users/${owner.body.user.id}`)
      .set('Authorization', bearer(owner))
      .expect(400);
  });

  it('a MEMBER sees and counts only the envelopes they own', async () => {
    const memberA = await invite('MEMBER', 'Member A');
    const memberB = await invite('MEMBER', 'Member B');

    const ownA = await prepareEnvelope(t.http, memberA, [{ name: 'X', email: uniqueEmail('x') }]);
    await prepareEnvelope(t.http, memberB, [{ name: 'Y', email: uniqueEmail('y') }]);

    const list = await request(t.http)
      .get('/api/v1/envelopes?view=all')
      .set('Authorization', bearer(memberA))
      .expect(200);
    const body = list.body as EnvelopeListResponse;
    expect(body.items.map((e) => e.id)).toEqual([ownA.id]);

    const counts = await request(t.http)
      .get('/api/v1/envelopes/counts')
      .set('Authorization', bearer(memberA))
      .expect(200);
    expect(counts.body.drafts).toBe(1);
    expect(counts.body.all).toBe(1);
  });

  it("a MEMBER cannot open, read the events of, or download the document of another member's envelope — every one the same answer as a nonexistent one (docs/18 workstream 7 step 7.0)", async () => {
    const memberA = await invite('MEMBER', 'Opaque A');
    const memberB = await invite('MEMBER', 'Opaque B');
    const draft = await prepareEnvelope(t.http, memberB, [{ name: 'Z', email: uniqueEmail('z') }]);

    const res = await request(t.http)
      .get(`/api/v1/envelopes/${draft.id}`)
      .set('Authorization', bearer(memberA))
      .expect(404);
    expect(res.body.code).toBe('NOT_FOUND');

    const eventsAsA = await request(t.http)
      .get(`/api/v1/envelopes/${draft.id}/events`)
      .set('Authorization', bearer(memberA))
      .expect(404);
    expect(eventsAsA.body.code).toBe('NOT_FOUND');

    const fileAsA = await request(t.http)
      .get(`/api/v1/envelopes/${draft.id}/file`)
      .set('Authorization', bearer(memberA))
      .expect(404);
    expect(fileAsA.body.code).toBe('NOT_FOUND');

    // The real ETag, fetched as the owner, still doesn't unlock a 304 for a
    // MEMBER who isn't the owner — the scope check runs before the
    // conditional-request shortcut, so it can't leak that the document
    // exists via a 304 either.
    const fileAsOwner = await request(t.http)
      .get(`/api/v1/envelopes/${draft.id}/file`)
      .set('Authorization', bearer(memberB))
      .expect(200);
    const etag = fileAsOwner.headers.etag as string;
    expect(etag).toBeTruthy();
    const conditionalAsA = await request(t.http)
      .get(`/api/v1/envelopes/${draft.id}/file`)
      .set('Authorization', bearer(memberA))
      .set('If-None-Match', etag)
      .expect(404);
    expect(conditionalAsA.body.code).toBe('NOT_FOUND');

    // The named documents (docs/18 step 11.3) share that scope check, and it
    // comes before their "not completed yet" 409 as well as before any ETag.
    for (const name of ['original', 'completed', 'certificate']) {
      const named = `/api/v1/envelopes/${draft.id}/documents/${name}`;
      const res = await request(t.http)
        .get(named)
        .set('Authorization', bearer(memberA))
        .expect(404);
      expect(res.body.code).toBe('NOT_FOUND');
      await request(t.http)
        .get(named)
        .set('Authorization', bearer(memberA))
        .set('If-None-Match', etag)
        .expect(404);
    }
    await request(t.http)
      .get(`/api/v1/envelopes/${draft.id}/documents/original`)
      .set('Authorization', bearer(memberB))
      .expect(200);

    // OWNER (and, identically, ADMIN — same non-MEMBER code path) still sees
    // the whole tenant, unaffected by the scope check.
    await request(t.http)
      .get(`/api/v1/envelopes/${draft.id}/events`)
      .set('Authorization', bearer(owner))
      .expect(200);
  });

  it("a MEMBER cannot cancel another member's envelope; an ADMIN can", async () => {
    const memberA = await invite('MEMBER', 'Cancel A');
    const memberB = await invite('MEMBER', 'Cancel B');
    const admin = await invite('ADMIN', 'Cancel Admin');
    const draft = await prepareEnvelope(t.http, memberB, [{ name: 'W', email: uniqueEmail('w') }]);

    const refused = await request(t.http)
      .post(`/api/v1/envelopes/${draft.id}/void`)
      .set('Authorization', bearer(memberA))
      .expect(403);
    expect(refused.body.code).toBe('FORBIDDEN_ROLE');

    await request(t.http)
      .post(`/api/v1/envelopes/${draft.id}/void`)
      .set('Authorization', bearer(admin))
      .expect(200);
  });

  it('OWNER and ADMIN see the whole tenant, not just their own', async () => {
    const memberA = await invite('MEMBER', 'Whole A');
    await prepareEnvelope(t.http, memberA, [{ name: 'V', email: uniqueEmail('v') }]);

    const asOwner = await request(t.http)
      .get('/api/v1/envelopes?view=all')
      .set('Authorization', bearer(owner))
      .expect(200);
    const ids = (asOwner.body as EnvelopeListResponse).items.map((e) => e.id);
    expect(ids.length).toBeGreaterThan(1);
  });

  describe('removing a user (docs/19, ADR 0023)', () => {
    async function remove(user: SignedInUser): Promise<void> {
      await request(t.http)
        .delete(`/api/v1/users/${user.body.user.id}`)
        .set('Authorization', bearer(owner))
        .expect(204);
    }

    it('marks the account disabled, downgrades it and revokes every session at once', async () => {
      const removed = await invite('ADMIN', 'Removed Admin');
      // A second sign-in: two live sessions for one person.
      await request(t.http)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', nextClientIp())
        .send({ email: removed.email, password: removed.password })
        .expect(200);
      logs.clear();

      await remove(removed);

      const [row] = (
        await ownerQuery<{ role: string; disabledAt: Date | null; active: string }>(
          `SELECT u."role"::text AS role, u."disabledAt",
                  (SELECT count(*) FROM "Session" s
                    WHERE s."userId" = u.id AND s."revokedAt" IS NULL)::text AS active
             FROM "User" u WHERE u.id = $1`,
          [removed.body.user.id],
        )
      ).rows;
      expect(row?.role).toBe('MEMBER');
      expect(row?.disabledAt).toBeInstanceOf(Date);
      expect(row?.active).toBe('0');

      const revoked = await ownerQuery<{ revokedReason: string }>(
        `SELECT "revokedReason" FROM "Session" WHERE "userId" = $1`,
        [removed.body.user.id],
      );
      expect(revoked.rows.length).toBeGreaterThanOrEqual(2);
      expect(new Set(revoked.rows.map((r) => r.revokedReason))).toEqual(new Set(['user-removed']));

      const log = logs.find('User removed', 'info')[0];
      expect(log?.fields).toMatchObject({
        userId: removed.body.user.id,
        removedBy: owner.body.user.id,
      });
      expect(Number(log?.fields.revokedSessions)).toBeGreaterThanOrEqual(2);
    });

    it("stops the removed user's open access token and refresh cookie working", async () => {
      const removed = await invite('MEMBER', 'Removed Member');
      await request(t.http)
        .get('/api/v1/auth/me')
        .set('Authorization', bearer(removed))
        .expect(200);

      await remove(removed);

      const me = await request(t.http)
        .get('/api/v1/auth/me')
        .set('Authorization', bearer(removed))
        .expect(401);
      expect(me.body.code).toBe('SESSION_EXPIRED');

      const refresh = await request(t.http)
        .post('/api/v1/auth/refresh')
        .set('Cookie', removed.cookie)
        .expect(401);
      expect(refresh.body.code).toBe('SESSION_EXPIRED');
    });

    it('refuses the removed user at sign-in exactly as it refuses a wrong password', async () => {
      const removed = await invite('MEMBER', 'Removed Login');
      await remove(removed);

      const withOldPassword = await request(t.http)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', nextClientIp())
        .send({ email: removed.email, password: removed.password })
        .expect(401);
      const withWrongPassword = await request(t.http)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', nextClientIp())
        .send({ email: removed.email, password: 'definitely not the password' })
        .expect(401);
      expect(withOldPassword.body.code).toBe('INVALID_CREDENTIALS');
      expect(withOldPassword.body.detail).toBe(withWrongPassword.body.detail);
    });

    it("leaves another workspace's users and this workspace's other users untouched", async () => {
      const bystander = await invite('MEMBER', 'Bystander');
      const stranger = await registerUser(t.http, { organization: 'Other Clinic' });
      const removed = await invite('MEMBER', 'Removed Neighbour');

      await remove(removed);

      await request(t.http)
        .get('/api/v1/auth/me')
        .set('Authorization', bearer(bystander))
        .expect(200);
      await request(t.http)
        .get('/api/v1/auth/me')
        .set('Authorization', bearer(stranger))
        .expect(200);
      await request(t.http)
        .post('/api/v1/auth/refresh')
        .set('Cookie', bystander.cookie)
        .expect(200);

      const other = await request(t.http)
        .delete(`/api/v1/users/${removed.body.user.id}`)
        .set('Authorization', bearer(stranger))
        .expect(404);
      expect(other.body.code).toBe('NOT_FOUND');
    });
  });
});
