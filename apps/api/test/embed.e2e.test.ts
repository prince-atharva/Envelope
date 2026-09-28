import type { CreateEmbedSessionResponse, EmbedSessionResponse } from '@envelope/shared';
import { PinoLogger } from 'nestjs-pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EmbedSessionPurgeService } from '../src/maintenance/embed-session-purge.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { makePdf } from './fixtures/pdfs';
import { captureLogs, createTestApp, type TestApp } from './helpers/app';
import { registerUser, type SignedInUser } from './helpers/auth';
import { ownerQuery, truncateAll } from './helpers/db';
import { bearer, prepareEnvelope } from './helpers/signing';

const origin = 'https://healthprohub.example';
describe('embedded sender authority (e2e)', () => {
  let t: TestApp;
  let owner: SignedInUser;
  let key: string;
  let keyId: string;
  let id: string;
  let otherId: string;
  let logs: ReturnType<typeof captureLogs>;
  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    logs = captureLogs();
    owner = await registerUser(t.http);
    const created = await request(t.http)
      .post('/api/v1/api-keys')
      .set('Authorization', bearer(owner))
      .send({ label: 'Embed host' })
      .expect(201);
    key = created.body.rawKey;
    keyId = created.body.apiKey.id;
    await request(t.http)
      .put('/api/v1/embed/origins')
      .set('Authorization', bearer(owner))
      .send({ origins: [origin] })
      .expect(200);
    id = (await prepareEnvelope(t.http, owner, [])).id;
    otherId = (await prepareEnvelope(t.http, owner, [])).id;
  });
  afterAll(async () => {
    logs.restore();
    await t.close();
  });
  async function issue(
    actions = ['edit', 'send'],
    mode = 'existing',
  ): Promise<CreateEmbedSessionResponse> {
    const result = await request(t.http)
      .post('/api/v1/embed/sessions')
      .set('Authorization', `Bearer ${key}`)
      .send({
        mode,
        ...(mode === 'existing' ? { envelopeId: id } : {}),
        parentOrigin: origin,
        externalActorId: 'staff:123',
        actions,
      })
      .expect(201);
    return result.body;
  }
  async function exchange(session: CreateEmbedSessionResponse): Promise<EmbedSessionResponse> {
    const result = await request(t.http)
      .post('/api/v1/embed/sessions/exchange')
      .send({ sessionId: session.sessionId, launchToken: session.launchToken })
      .expect(200);
    return result.body;
  }
  it('denies human/read-only issuers, unapproved origins and other tenants', async () => {
    const body = {
      mode: 'existing',
      envelopeId: id,
      parentOrigin: origin,
      externalActorId: 'staff:123',
      actions: ['edit'],
    };
    await request(t.http)
      .post('/api/v1/embed/sessions')
      .set('Authorization', bearer(owner))
      .send(body)
      .expect(403);
    const ro = await request(t.http)
      .post('/api/v1/api-keys')
      .set('Authorization', bearer(owner))
      .send({ label: 'read', readOnly: true })
      .expect(201);
    await request(t.http)
      .post('/api/v1/embed/sessions')
      .set('Authorization', `Bearer ${ro.body.rawKey}`)
      .send(body)
      .expect(403);
    await request(t.http)
      .post('/api/v1/embed/sessions')
      .set('Authorization', `Bearer ${key}`)
      .send({ ...body, parentOrigin: 'https://other.example' })
      .expect(403);
    const outsider = await registerUser(t.http);
    const alien = await prepareEnvelope(t.http, outsider, []);
    await request(t.http)
      .post('/api/v1/embed/sessions')
      .set('Authorization', `Bearer ${key}`)
      .send({ ...body, envelopeId: alien.id })
      .expect(404);
    await request(t.http)
      .put('/api/v1/embed/origins')
      .set('Authorization', `Bearer ${key}`)
      .send({ origins: [] })
      .expect(403);
  });
  it('serves frame HTML with the exact parent origin and no credential in URLs', async () => {
    const session = await issue();
    const frame = await request(t.http).get(`/api/v1/embed/frame/${session.sessionId}`).expect(200);
    expect(frame.headers['content-security-policy']).toContain(`frame-ancestors ${origin}`);
    expect(frame.headers['x-frame-options']).toBeUndefined();
    expect(frame.headers['cache-control']).toBe('no-store');
    expect(frame.text).not.toContain(session.launchToken);
    expect(frame.text).toContain('embed-bootstrap');
  });
  it('rejects a swapped launch token without consuming it', async () => {
    const first = await issue();
    const second = await issue();
    await request(t.http)
      .post('/api/v1/embed/sessions/exchange')
      .send({ sessionId: first.sessionId, launchToken: second.launchToken })
      .expect(401);
    await exchange(second);
  });
  it('redeems launch exactly once even concurrently and never exposes stored credentials', async () => {
    const session = await issue();
    const results = await Promise.all(
      [0, 1].map(() =>
        request(t.http)
          .post('/api/v1/embed/sessions/exchange')
          .send({ sessionId: session.sessionId, launchToken: session.launchToken }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const stored = await ownerQuery('SELECT * FROM "EmbedSession" WHERE id=$1', [
      session.sessionId,
    ]);
    expect(JSON.stringify(stored.rows)).not.toContain(session.launchToken);
    expect(JSON.stringify(stored.rows)).not.toContain(
      results.find((r) => r.status === 200)?.body.accessToken,
    );
    expect(session.frameUrl).not.toContain(session.launchToken);
    expect(logs.text()).not.toContain(session.launchToken);
    expect(logs.text()).not.toContain('staff:123');
  });
  it('restricts bound sessions to editor routes and grants send separately', async () => {
    const session = await issue(['edit']);
    const access = await exchange(session);
    const auth = `Bearer ${access.accessToken}`;
    await request(t.http).get(`/api/v1/envelopes/${id}`).set('Authorization', auth).expect(200);
    await request(t.http)
      .get(`/api/v1/envelopes/${otherId}`)
      .set('Authorization', auth)
      .expect(403);
    for (const path of [
      'envelopes',
      'envelopes/counts',
      `envelopes/${id}/events`,
      'users',
      'api-keys',
      'webhooks',
      'embed/origins',
    ]) {
      await request(t.http).get(`/api/v1/${path}`).set('Authorization', auth).expect(403);
    }
    await request(t.http)
      .get(`/api/v1/envelopes/${id}/file?version=1`)
      .set('Authorization', auth)
      .expect(403);
    await request(t.http)
      .post(`/api/v1/envelopes/${id}/send`)
      .set('Authorization', auth)
      .send({})
      .expect(403);
    await request(t.http).post('/api/v1/envelopes').set('Authorization', auth).expect(403);
    await request(t.http)
      .patch(`/api/v1/envelopes/${id}`)
      .set('Authorization', auth)
      .send({ title: 'Prepared in HealthProHub' })
      .expect(200);
    const audit = await ownerQuery(
      'SELECT metadata FROM "AuditTrail" WHERE "envelopeId"=$1 ORDER BY sequence DESC LIMIT 1',
      [id],
    );
    expect(audit.rows[0]?.metadata).toMatchObject({
      embedSessionId: session.sessionId,
      externalActorId: 'staff:123',
    });
    await request(t.http)
      .post('/api/v1/embed/session/close')
      .set('Authorization', auth)
      .expect(204);
    await request(t.http).get(`/api/v1/envelopes/${id}`).set('Authorization', auth).expect(401);
    expect(logs.text()).not.toContain(access.accessToken);
  });
  it('binds concurrent/retried uploads to one real draft with attribution', async () => {
    const session = await issue(['edit'], 'upload');
    const access = await exchange(session);
    const pdf = await makePdf(1);
    const upload = () =>
      request(t.http)
        .post('/api/v1/embed/session/envelope')
        .set('Authorization', `Bearer ${access.accessToken}`)
        .attach('file', pdf, 'embedded.pdf');
    const results = await Promise.all([upload(), upload()]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results[0]?.body.id).toBe(results[1]?.body.id);
    const retry = await upload().expect(201);
    expect(retry.body.id).toBe(results[0]?.body.id);
    await request(t.http)
      .get(`/api/v1/envelopes/${retry.body.id}`)
      .set('Authorization', `Bearer ${access.accessToken}`)
      .expect(200);
    const audit = await ownerQuery('SELECT metadata FROM "AuditTrail" WHERE "envelopeId"=$1', [
      retry.body.id,
    ]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.metadata.embedSessionId).toBe(session.sessionId);
  });
  it('refuses expired credentials and revocation of an origin or issuing key', async () => {
    const expired = await issue();
    await ownerQuery(
      'UPDATE "EmbedSession" SET "launchExpiresAt"=now()-interval \'1 minute\' WHERE id=$1',
      [expired.sessionId],
    );
    await request(t.http)
      .post('/api/v1/embed/sessions/exchange')
      .send({ sessionId: expired.sessionId, launchToken: expired.launchToken })
      .expect(401);
    const session = await issue();
    const access = await exchange(session);
    await request(t.http)
      .put('/api/v1/embed/origins')
      .set('Authorization', bearer(owner))
      .send({ origins: [] })
      .expect(200);
    await request(t.http)
      .get(`/api/v1/envelopes/${id}`)
      .set('Authorization', `Bearer ${access.accessToken}`)
      .expect(401);
    await request(t.http)
      .put('/api/v1/embed/origins')
      .set('Authorization', bearer(owner))
      .send({ origins: [origin] })
      .expect(200);
    await ownerQuery(
      'UPDATE "EmbedSession" SET "expiresAt"=now()-interval \'1 minute\' WHERE id=$1',
      [session.sessionId],
    );
    await request(t.http)
      .get(`/api/v1/envelopes/${id}`)
      .set('Authorization', `Bearer ${access.accessToken}`)
      .expect(401);
    const active = await issue();
    const token = await exchange(active);
    await request(t.http)
      .delete(`/api/v1/api-keys/${keyId}`)
      .set('Authorization', bearer(owner))
      .expect(200);
    await request(t.http)
      .get(`/api/v1/envelopes/${id}`)
      .set('Authorization', `Bearer ${token.accessToken}`)
      .expect(401);
  });
  it('purges expired operational sessions without modifying the evidence chain', async () => {
    const before = await ownerQuery('SELECT count(*) FROM "AuditTrail"');
    await ownerQuery('UPDATE "EmbedSession" SET "expiresAt"=now()-interval \'8 days\'');
    const purge = new EmbedSessionPurgeService(
      t.app.get(PrismaService),
      await t.app.resolve(PinoLogger),
    );
    expect((await purge.run()).changed).toBeGreaterThan(0);
    const after = await ownerQuery('SELECT count(*) FROM "AuditTrail"');
    expect(after.rows).toEqual(before.rows);
  });
});
