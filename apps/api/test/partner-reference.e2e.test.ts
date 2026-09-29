import type {
  CreateApiKeyResponse,
  CreateEmbedSessionResponse,
  EmbedSessionResponse,
  EnvelopeDetail,
  EnvelopeListResponse,
} from '@envelope/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makePdf } from './fixtures/pdfs';
import { captureLogs, createTestApp, type TestApp } from './helpers/app';
import { registerUser, type SignedInUser } from './helpers/auth';
import { truncateAll } from './helpers/db';
import { bearer } from './helpers/signing';

const origin = 'https://healthprohub.example';

/**
 * A partner's own reference on an envelope (docs/18 workstream 10, ADR
 * 0019): set at creation or while a draft, filterable, and fixed once sent.
 */
describe('partner reference: externalId and metadata (e2e)', () => {
  let t: TestApp;
  let owner: SignedInUser;
  let key: string;
  let logs: ReturnType<typeof captureLogs>;

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    logs = captureLogs();
    owner = await registerUser(t.http);
    const created = await request(t.http)
      .post('/api/v1/api-keys')
      .set('Authorization', bearer(owner))
      .send({ label: 'Partner', embedOrigins: [origin] })
      .expect(201);
    key = (created.body as CreateApiKeyResponse).rawKey;
  });

  afterAll(async () => {
    logs.restore();
    await t.close();
  });

  const keyAuth = () => `Bearer ${key}`;

  async function upload(fields: Record<string, string> = {}, auth = keyAuth()) {
    let req = request(t.http)
      .post('/api/v1/envelopes')
      .set('Authorization', auth)
      .attach('file', await makePdf(1), { filename: 'ref.pdf', contentType: 'application/pdf' });
    for (const [name, value] of Object.entries(fields)) req = req.field(name, value);
    return req;
  }

  it('sets both on create, returns them on detail, and defaults to none', async () => {
    const created = await upload({
      externalId: 'visit:1001',
      metadata: JSON.stringify({ department: 'billing', form: 'consent-v3' }),
    }).then((r) => {
      expect(r.status).toBe(201);
      return r.body as EnvelopeDetail;
    });
    expect(created.externalId).toBe('visit:1001');
    expect(created.metadata).toEqual({ department: 'billing', form: 'consent-v3' });

    const plain = (await upload().then((r) => r.body)) as EnvelopeDetail;
    expect(plain.externalId).toBeNull();
    expect(plain.metadata).toBeNull();
  });

  it('rejects an invalid externalId and oversize or malformed metadata', async () => {
    const invalid: Record<string, string>[] = [
      { externalId: 'has space' },
      { externalId: 'x'.repeat(201) },
      { metadata: 'not json' },
      { metadata: JSON.stringify({ n: 1 }) },
      { metadata: JSON.stringify({ a: 'x'.repeat(2100) }) },
    ];
    for (const fields of invalid) {
      const res = await upload(fields);
      expect(res.status, JSON.stringify(fields)).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
  });

  it('lists by exact externalId, across views, and never across tenants', async () => {
    const ref = 'lookup:42';
    const mine = (await upload({ externalId: ref }).then((r) => r.body)) as EnvelopeDetail;
    await upload({ externalId: 'lookup:420' });

    const outsider = await registerUser(t.http);
    await request(t.http)
      .post('/api/v1/envelopes')
      .set('Authorization', bearer(outsider))
      .field('externalId', ref)
      .attach('file', await makePdf(1), { filename: 'x.pdf', contentType: 'application/pdf' })
      .expect(201);

    const found = await request(t.http)
      .get('/api/v1/envelopes')
      .query({ externalId: ref })
      .set('Authorization', keyAuth())
      .expect(200);
    const items = (found.body as EnvelopeListResponse).items;
    expect(items.map((i) => i.id)).toEqual([mine.id]);
    expect(items[0]?.externalId).toBe(ref);

    const attention = await request(t.http)
      .get('/api/v1/envelopes')
      .query({ externalId: ref, view: 'attention' })
      .set('Authorization', keyAuth())
      .expect(200);
    expect((attention.body as EnvelopeListResponse).items).toEqual([]);

    const drafts = await request(t.http)
      .get('/api/v1/envelopes')
      .query({ externalId: ref, view: 'drafts' })
      .set('Authorization', bearer(owner))
      .expect(200);
    expect((drafts.body as EnvelopeListResponse).items.map((i) => i.id)).toEqual([mine.id]);
  });

  it('edits and clears both while a draft, and audits only the names of what changed', async () => {
    const draft = (await upload({ externalId: 'edit:1' }).then((r) => r.body)) as EnvelopeDetail;
    const patched = await request(t.http)
      .patch(`/api/v1/envelopes/${draft.id}`)
      .set('Authorization', keyAuth())
      .set('If-Match', String(draft.draftRevision))
      .send({ externalId: 'edit:2', metadata: { patient: 'secret-label' } })
      .expect(200);
    expect(patched.body.draftRevision).toBe(draft.draftRevision + 1);

    const after = (
      await request(t.http)
        .get(`/api/v1/envelopes/${draft.id}`)
        .set('Authorization', keyAuth())
        .expect(200)
    ).body as EnvelopeDetail;
    expect(after.externalId).toBe('edit:2');
    expect(after.metadata).toEqual({ patient: 'secret-label' });

    const cleared = await request(t.http)
      .patch(`/api/v1/envelopes/${draft.id}`)
      .set('Authorization', keyAuth())
      .send({ externalId: null, metadata: null })
      .expect(200);
    expect(cleared.body.draftRevision).toBeGreaterThan(patched.body.draftRevision);
    const empty = (
      await request(t.http)
        .get(`/api/v1/envelopes/${draft.id}`)
        .set('Authorization', keyAuth())
        .expect(200)
    ).body as EnvelopeDetail;
    expect(empty.externalId).toBeNull();
    expect(empty.metadata).toBeNull();

    const events = await request(t.http)
      .get(`/api/v1/envelopes/${draft.id}/events`)
      .set('Authorization', keyAuth())
      .expect(200);
    expect(JSON.stringify(events.body)).not.toContain('secret-label');
    expect(logs.text()).not.toContain('secret-label');
    expect(logs.text()).not.toContain('edit:2');
  });

  it('refuses a read-only key and a non-draft envelope', async () => {
    const readOnly = (
      await request(t.http)
        .post('/api/v1/api-keys')
        .set('Authorization', bearer(owner))
        .send({ label: 'ro', readOnly: true })
        .expect(201)
    ).body as CreateApiKeyResponse;
    const draft = (await upload({ externalId: 'ro:1' }).then((r) => r.body)) as EnvelopeDetail;
    await request(t.http)
      .patch(`/api/v1/envelopes/${draft.id}`)
      .set('Authorization', `Bearer ${readOnly.rawKey}`)
      .send({ externalId: 'ro:2' })
      .expect(403);
    await upload({ externalId: 'ro:3' }, `Bearer ${readOnly.rawKey}`).then((r) =>
      expect(r.status).toBe(403),
    );

    // Voiding a draft leaves it VOIDED: no longer editable.
    await request(t.http)
      .post(`/api/v1/envelopes/${draft.id}/void`)
      .set('Authorization', bearer(owner))
      .send({ reason: 'not needed' });
    const late = await request(t.http)
      .patch(`/api/v1/envelopes/${draft.id}`)
      .set('Authorization', keyAuth())
      .send({ externalId: 'ro:4' });
    expect(late.status).toBeGreaterThanOrEqual(400);
    expect(late.body.code).toBe('ENVELOPE_NOT_DRAFT');
  });

  describe('through an embedded editor', () => {
    async function session(body: Record<string, unknown>): Promise<CreateEmbedSessionResponse> {
      const res = await request(t.http)
        .post('/api/v1/embed/sessions')
        .set('Authorization', keyAuth())
        .send({ parentOrigin: origin, externalActorId: 'staff:1', actions: ['edit'], ...body });
      expect(res.status).toBe(201);
      return res.body;
    }
    async function bearerFor(s: CreateEmbedSessionResponse): Promise<string> {
      const res = await request(t.http)
        .post('/api/v1/embed/sessions/exchange')
        .send({ sessionId: s.sessionId, launchToken: s.launchToken })
        .expect(200);
      return `Bearer ${(res.body as EmbedSessionResponse).accessToken}`;
    }

    it('applies the session’s reference to the draft its upload creates', async () => {
      const s = await session({
        mode: 'upload',
        externalId: 'embed:7',
        metadata: { source: 'iframe' },
      });
      const auth = await bearerFor(s);
      const res = await request(t.http)
        .post('/api/v1/embed/session/envelope')
        .set('Authorization', auth)
        .attach('file', await makePdf(1), 'embedded.pdf')
        .expect(201);
      expect((res.body as EnvelopeDetail).externalId).toBe('embed:7');
      expect((res.body as EnvelopeDetail).metadata).toEqual({ source: 'iframe' });
    });

    it('does not let the browser set or change the reference itself', async () => {
      const uploadSession = await session({ mode: 'upload' });
      await request(t.http)
        .post('/api/v1/embed/session/envelope')
        .set('Authorization', await bearerFor(uploadSession))
        .field('externalId', 'from-browser')
        .attach('file', await makePdf(1), 'embedded.pdf')
        .expect(403);

      const draft = (await upload({ externalId: 'embed:8' }).then((r) => r.body)) as EnvelopeDetail;
      const existing = await session({ mode: 'existing', envelopeId: draft.id });
      await request(t.http)
        .patch(`/api/v1/envelopes/${draft.id}`)
        .set('Authorization', await bearerFor(existing))
        .send({ externalId: 'hijack' })
        .expect(403);
      const same = (
        await request(t.http)
          .get(`/api/v1/envelopes/${draft.id}`)
          .set('Authorization', keyAuth())
          .expect(200)
      ).body as EnvelopeDetail;
      expect(same.externalId).toBe('embed:8');
    });

    it('rejects reference fields on an existing-mode session', async () => {
      const draft = (await upload().then((r) => r.body)) as EnvelopeDetail;
      await request(t.http)
        .post('/api/v1/embed/sessions')
        .set('Authorization', keyAuth())
        .send({
          mode: 'existing',
          envelopeId: draft.id,
          parentOrigin: origin,
          externalActorId: 'staff:1',
          actions: ['edit'],
          externalId: 'x',
        })
        .expect(400);
    });
  });
});
