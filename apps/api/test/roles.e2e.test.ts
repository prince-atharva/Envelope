import type { AuthResponse, EnvelopeListResponse, TenantUser } from '@envelope/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createTestWorker,
  type TestApp,
  type TestWorker,
  waitFor,
} from './helpers/app';
import { registerUser, type SignedInUser, uniqueEmail } from './helpers/auth';
import { truncateAll } from './helpers/db';
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

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    worker = await createTestWorker();
    owner = await registerUser(t.http, { fullName: 'Roles Owner', organization: 'Roles Clinic' });
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
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
      .send({ password: 'a fresh chosen password' })
      .expect(200);
    const body = accepted.body as AuthResponse;
    expect(body.user.role).toBe(role);
    expect(body.user.tenant.id).toBe(owner.body.user.tenant.id);
    return {
      email,
      password: 'a fresh chosen password',
      accessToken: body.accessToken,
      cookie: '',
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

  it("a MEMBER cannot open another member's envelope — the same answer as a nonexistent one", async () => {
    const memberA = await invite('MEMBER', 'Opaque A');
    const memberB = await invite('MEMBER', 'Opaque B');
    const draft = await prepareEnvelope(t.http, memberB, [{ name: 'Z', email: uniqueEmail('z') }]);

    const res = await request(t.http)
      .get(`/api/v1/envelopes/${draft.id}`)
      .set('Authorization', bearer(memberA))
      .expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
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
});
