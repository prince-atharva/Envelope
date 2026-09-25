import type {
  ApiKeySummary,
  AuthResponse,
  CreateApiKeyResponse,
  EnvelopeDetail,
} from '@envelope/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makePdf } from './fixtures/pdfs';
import {
  createTestApp,
  createTestWorker,
  type TestApp,
  type TestWorker,
  waitFor,
} from './helpers/app';
import { registerUser, type SignedInUser, uniqueEmail } from './helpers/auth';
import { truncateAll } from './helpers/db';
import { bearer } from './helpers/signing';

const INVITE_LINK = /\/accept-invite\/([0-9a-f]{64})/;

/**
 * Tenant-scoped API keys (docs/08, "Server integration"; docs/18, ADR
 * 0015): issuance and revocation are JWT-only; the raw key itself
 * authenticates only the allow-listed envelope routes.
 */
describe('API keys (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    worker = await createTestWorker();
    owner = await registerUser(t.http, { fullName: 'Key Owner', organization: 'Key Clinic' });
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
  });

  async function inviteMember(fullName: string): Promise<SignedInUser> {
    const email = uniqueEmail('member');
    await request(t.http)
      .post('/api/v1/users')
      .set('Authorization', bearer(owner))
      .send({ fullName, email, role: 'MEMBER' })
      .expect(201);
    const message = await waitFor(() =>
      worker.mailbox.messages.filter((m) => m.to === email && m.template === 'user-invited').at(-1),
    );
    const token = INVITE_LINK.exec(message.text)?.[1];
    if (!token) throw new Error('no invite link in the email');
    const accepted = await request(t.http)
      .post(`/api/v1/auth/invitations/${token}/accept`)
      .send({ password: 'a fresh chosen password' })
      .expect(200);
    const body = accepted.body as AuthResponse;
    return {
      email,
      password: 'a fresh chosen password',
      accessToken: body.accessToken,
      cookie: '',
      body,
    };
  }

  it('creates a key, shows the raw value once, then lists it without the value', async () => {
    const created = await request(t.http)
      .post('/api/v1/api-keys')
      .set('Authorization', bearer(owner))
      .send({ label: 'HealthProHub production' })
      .expect(201);
    const body = created.body as CreateApiKeyResponse;
    expect(body.rawKey).toMatch(/^eak_/);
    expect(body.apiKey.label).toBe('HealthProHub production');
    expect(body.apiKey.readOnly).toBe(false);
    expect(body.apiKey.revokedAt).toBeNull();

    const listed = await request(t.http)
      .get('/api/v1/api-keys')
      .set('Authorization', bearer(owner))
      .expect(200);
    const keys = listed.body as ApiKeySummary[];
    const match = keys.find((k) => k.id === body.apiKey.id);
    expect(match).toBeDefined();
    expect(JSON.stringify(match)).not.toContain(body.rawKey);
  });

  it('reuses one service-account user across a tenant’s keys', async () => {
    const solo = await registerUser(t.http, { fullName: 'Solo Owner', organization: 'Solo Co' });
    const first = await request(t.http)
      .post('/api/v1/api-keys')
      .set('Authorization', bearer(solo))
      .send({ label: 'first' })
      .expect(201);
    const second = await request(t.http)
      .post('/api/v1/api-keys')
      .set('Authorization', bearer(solo))
      .send({ label: 'second' })
      .expect(201);

    const envelope = await request(t.http)
      .post('/api/v1/envelopes')
      .set('Authorization', `Bearer ${(first.body as CreateApiKeyResponse).rawKey}`)
      .attach('file', await makePdf(1), { filename: 'a.pdf', contentType: 'application/pdf' })
      .expect(201);
    const ownerIdViaFirst = (envelope.body as EnvelopeDetail).id;

    const envelope2 = await request(t.http)
      .post('/api/v1/envelopes')
      .set('Authorization', `Bearer ${(second.body as CreateApiKeyResponse).rawKey}`)
      .attach('file', await makePdf(1), { filename: 'b.pdf', contentType: 'application/pdf' })
      .expect(201);

    // Both envelopes are visible to the human owner: proof both keys wrote
    // into the same tenant, under the same (shared) service-account owner.
    await request(t.http)
      .get(`/api/v1/envelopes/${ownerIdViaFirst}`)
      .set('Authorization', bearer(solo))
      .expect(200);
    await request(t.http)
      .get(`/api/v1/envelopes/${(envelope2.body as EnvelopeDetail).id}`)
      .set('Authorization', bearer(solo))
      .expect(200);
  });

  it('lets a key create and read envelopes, but refuses a route this phase does not allow', async () => {
    const created = await request(t.http)
      .post('/api/v1/api-keys')
      .set('Authorization', bearer(owner))
      .send({ label: 'scope test' })
      .expect(201);
    const rawKey = (created.body as CreateApiKeyResponse).rawKey;

    const envelope = await request(t.http)
      .post('/api/v1/envelopes')
      .set('Authorization', `Bearer ${rawKey}`)
      .attach('file', await makePdf(1), { filename: 'c.pdf', contentType: 'application/pdf' })
      .expect(201);
    const id = (envelope.body as EnvelopeDetail).id;

    await request(t.http)
      .get(`/api/v1/envelopes/${id}`)
      .set('Authorization', `Bearer ${rawKey}`)
      .expect(200);

    // Not allow-listed this phase (docs/18).
    const holdAttempt = await request(t.http)
      .post(`/api/v1/envelopes/${id}/legal-hold`)
      .set('Authorization', `Bearer ${rawKey}`)
      .send({ reason: 'dispute' });
    expect(holdAttempt.status).toBe(403);
    expect(holdAttempt.body.code).toBe('API_KEY_NOT_ALLOWED');

    const usersAttempt = await request(t.http)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${rawKey}`);
    expect(usersAttempt.status).toBe(403);
    expect(usersAttempt.body.code).toBe('API_KEY_NOT_ALLOWED');
  });

  it('refuses a read-only key on a write route, but allows it to read', async () => {
    const created = await request(t.http)
      .post('/api/v1/api-keys')
      .set('Authorization', bearer(owner))
      .send({ label: 'read only', readOnly: true })
      .expect(201);
    const rawKey = (created.body as CreateApiKeyResponse).rawKey;

    const attempt = await request(t.http)
      .post('/api/v1/envelopes')
      .set('Authorization', `Bearer ${rawKey}`)
      .attach('file', await makePdf(1), { filename: 'd.pdf', contentType: 'application/pdf' });
    expect(attempt.status).toBe(403);
    expect(attempt.body.code).toBe('API_KEY_READ_ONLY');

    await request(t.http)
      .get('/api/v1/envelopes')
      .set('Authorization', `Bearer ${rawKey}`)
      .expect(200);
  });

  it('refuses an unknown or revoked key', async () => {
    const bogus = await request(t.http)
      .get('/api/v1/envelopes')
      .set('Authorization', 'Bearer eak_not-a-real-key');
    expect(bogus.status).toBe(401);
    expect(bogus.body.code).toBe('API_KEY_INVALID');

    const created = await request(t.http)
      .post('/api/v1/api-keys')
      .set('Authorization', bearer(owner))
      .send({ label: 'to revoke' })
      .expect(201);
    const { apiKey, rawKey } = created.body as CreateApiKeyResponse;

    await request(t.http)
      .delete(`/api/v1/api-keys/${apiKey.id}`)
      .set('Authorization', bearer(owner))
      .expect(200);

    const revoked = await request(t.http)
      .get('/api/v1/envelopes')
      .set('Authorization', `Bearer ${rawKey}`);
    expect(revoked.status).toBe(401);
    expect(revoked.body.code).toBe('API_KEY_INVALID');
  });

  it('refuses a MEMBER on every key-management route', async () => {
    const member = await inviteMember('Key Member');
    await request(t.http)
      .post('/api/v1/api-keys')
      .set('Authorization', bearer(member))
      .send({ label: 'nope' })
      .expect(403);
    await request(t.http).get('/api/v1/api-keys').set('Authorization', bearer(member)).expect(403);

    const created = await request(t.http)
      .post('/api/v1/api-keys')
      .set('Authorization', bearer(owner))
      .send({ label: 'member cannot revoke' })
      .expect(201);
    await request(t.http)
      .delete(`/api/v1/api-keys/${(created.body as CreateApiKeyResponse).apiKey.id}`)
      .set('Authorization', bearer(member))
      .expect(403);
  });
});
