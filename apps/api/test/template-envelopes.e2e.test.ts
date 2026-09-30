import { randomUUID } from 'node:crypto';
import type { EnvelopeDetail, TemplateDetail } from '@envelope/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  captureLogs,
  createTestApp,
  createTestWorker,
  type TestApp,
  type TestWorker,
} from './helpers/app';
import { registerUser, type SignedInUser, uniqueEmail } from './helpers/auth';
import { ownerQuery, truncateAll } from './helpers/db';
import { bearer, linkFor, prepareEnvelope, sendEnvelope } from './helpers/signing';
import { createApiKey, inviteUser } from './helpers/workspace';

/** Creating envelopes from a template (docs/20 step 3, ADR 0027). */
describe('envelopes from a template (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;
  let outsider: SignedInUser;
  let member: SignedInUser;
  let template: TemplateDetail;
  const logs = captureLogs();

  const as = (user: SignedInUser) => ({ Authorization: bearer(user) });
  const fromTemplate = (
    body: Record<string, unknown>,
    user: SignedInUser = owner,
    id = template.id,
  ) => request(t.http).post(`/api/v1/templates/${id}/envelopes`).set(as(user)).send(body);
  const people = () => [
    { role: 'Patient', name: 'Alex Morgan', email: uniqueEmail('patient') },
    { role: 'Doctor', name: 'Dr Rivera', email: uniqueEmail('doctor') },
  ];

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    worker = await createTestWorker();
    owner = await registerUser(t.http, { fullName: 'From Owner', organization: 'From Clinic' });
    outsider = await registerUser(t.http, { organization: 'Elsewhere' });
    member = await inviteUser(t.http, worker, owner, 'MEMBER', 'From Member');

    const source = await prepareEnvelope(
      t.http,
      owner,
      [
        { name: 'Patient', email: 'p@example.test', routingOrder: 1 },
        { name: 'Doctor', email: 'd@example.test', routingOrder: 2, role: 'APPROVER' },
      ],
      { sequential: true, message: 'Please read and sign' },
    );
    const saved = await request(t.http)
      .post('/api/v1/templates')
      .set(as(owner))
      .send({ envelopeId: source.id, name: 'Consent' })
      .expect(201);
    template = saved.body as TemplateDetail;
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
    logs.restore();
  });

  it('creates a draft with the template’s people, colours, order, fields and settings', async () => {
    const given = people();
    logs.clear();
    const res = await fromTemplate({ recipients: given, externalId: 'visit:7' }).expect(201);
    const envelope = res.body as EnvelopeDetail;

    expect(envelope.status).toBe('DRAFT');
    expect(envelope.title).toBe('Consent');
    expect(envelope.pageCount).toBe(2);
    expect(
      envelope.recipients.map((r) => [r.name, r.email, r.role, r.routingOrder, r.colorIndex]),
    ).toEqual([
      ['Alex Morgan', given[0]?.email, 'SIGNER', 1, 0],
      ['Dr Rivera', given[1]?.email, 'APPROVER', 2, 1],
    ]);
    expect(envelope.fields).toHaveLength(template.fields.length);
    // Each field belongs to the person made from the role it belonged to.
    const patient = envelope.recipients.find((r) => r.name === 'Alex Morgan');
    expect(envelope.fields.filter((f) => f.recipientId === patient?.id)).toHaveLength(
      template.fields.filter((f) => f.templateRoleId === template.roles[0]?.id).length,
    );
    expect(envelope).toMatchObject({ sequentialSigning: true, message: 'Please read and sign' });

    const row = await ownerQuery<{
      originalFileUrl: string;
      jurisdictionCode: string;
      policyVersion: number;
      externalId: string;
      ownerId: string;
    }>(
      `SELECT "originalFileUrl", "jurisdictionCode", "policyVersion", "externalId", "ownerId"
         FROM "Envelope" WHERE id = $1`,
      [envelope.id],
    );
    const stored = row.rows[0];
    expect(stored?.ownerId).toBe(owner.body.user.id);
    expect(stored?.externalId).toBe('visit:7');
    expect(stored?.jurisdictionCode).toBeTruthy();
    expect(stored?.policyVersion).toBeGreaterThan(0);
    // Its own copy of the PDF, never the template's.
    const template_ = await ownerQuery<{ originalFileUrl: string }>(
      'SELECT "originalFileUrl" FROM "Template" WHERE id = $1',
      [template.id],
    );
    expect(stored?.originalFileUrl).not.toBe(template_.rows[0]?.originalFileUrl);
    expect(stored?.originalFileUrl).toContain(`/envelopes/${envelope.id}/`);

    // The trail reads like a hand-made draft, and names the template.
    const events = await ownerQuery<{ action: string; metadata: Record<string, unknown> | null }>(
      `SELECT action, metadata FROM "AuditTrail" WHERE "envelopeId" = $1 ORDER BY sequence`,
      [envelope.id],
    );
    expect(events.rows.map((e) => e.action)).toEqual([
      'ENVELOPE_CREATED',
      'RECIPIENT_ADDED',
      'RECIPIENT_ADDED',
      'FIELDS_SAVED',
    ]);
    expect(events.rows[0]?.metadata).toMatchObject({ templateId: template.id });
    expect(JSON.stringify(events.rows)).not.toContain(given[0]?.email as string);

    const log = logs.find('Envelope created from template', 'info')[0];
    expect(log?.fields).toMatchObject({ envelopeId: envelope.id, templateId: template.id });
    expect(logs.text()).not.toContain(given[0]?.email as string);
  });

  it('gives every envelope its own PDF and its own field ids', async () => {
    const a = (await fromTemplate({ recipients: people() }).expect(201)).body as EnvelopeDetail;
    const b = (await fromTemplate({ recipients: people() }).expect(201)).body as EnvelopeDetail;
    const keys = await ownerQuery<{ originalFileUrl: string }>(
      'SELECT "originalFileUrl" FROM "Envelope" WHERE id = ANY($1)',
      [[a.id, b.id]],
    );
    expect(new Set(keys.rows.map((r) => r.originalFileUrl)).size).toBe(2);
    const ids = new Set([...a.fields, ...b.fields].map((f) => f.id));
    expect(ids.size).toBe(a.fields.length + b.fields.length);
  });

  it('produces a draft that can be sent like any other', async () => {
    const given = people();
    const envelope = (await fromTemplate({ recipients: given }).expect(201)).body as EnvelopeDetail;
    await sendEnvelope(t.http, owner, envelope.id).expect(200);
    // The first person is invited now; the second waits (sequential signing).
    await linkFor(worker.mailbox, given[0]?.email as string);
  });

  it('can send at once', async () => {
    const given = people();
    const res = await fromTemplate({ recipients: given, send: true, message: 'Sign this' }).expect(
      201,
    );
    const envelope = res.body as EnvelopeDetail;
    expect(envelope.status).toBe('SENT');
    expect(envelope.message).toBe('Sign this');
    await linkFor(worker.mailbox, given[0]?.email as string);
  });

  it('refuses people who do not match the template’s roles, and creates nothing', async () => {
    const before = await ownerQuery<{ n: string }>('SELECT count(*) AS n FROM "Envelope"');
    const cases: Record<string, unknown>[] = [
      { recipients: [people()[0]] },
      { recipients: [...people(), { role: 'Nurse', name: 'Nora', email: uniqueEmail('nurse') }] },
      { recipients: [people()[0], { ...people()[0], role: 'Patient' }] },
      {
        recipients: [
          { role: 'Patient', name: 'A', email: 'same@example.test' },
          { role: 'Doctor', name: 'B', email: 'SAME@example.test' },
        ],
      },
    ];
    for (const body of cases) {
      const res = await fromTemplate(body).expect(422);
      expect(res.body.code).toBe('TEMPLATE_ROLE_MISMATCH');
      expect(res.body.errors.length).toBeGreaterThan(0);
    }
    const after = await ownerQuery<{ n: string }>('SELECT count(*) AS n FROM "Envelope"');
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    await fromTemplate({ recipients: [] }).expect(400);
  });

  it('refuses an archived or unknown template, and another workspace’s', async () => {
    const source = await prepareEnvelope(t.http, owner, [
      { name: 'Solo', email: 's@example.test' },
    ]);
    const other = (
      await request(t.http)
        .post('/api/v1/templates')
        .set(as(owner))
        .send({ envelopeId: source.id, name: 'To archive' })
        .expect(201)
    ).body as TemplateDetail;
    await request(t.http)
      .patch(`/api/v1/templates/${other.id}`)
      .set(as(owner))
      .send({ archived: true })
      .expect(200);
    const solo = [{ role: 'Solo', name: 'Solo', email: uniqueEmail('solo') }];
    const archived = await fromTemplate({ recipients: solo }, owner, other.id).expect(409);
    expect(archived.body.code).toBe('TEMPLATE_ARCHIVED');
    const unknown = await fromTemplate({ recipients: solo }, owner, randomUUID()).expect(404);
    expect(unknown.body.code).toBe('TEMPLATE_NOT_FOUND');
    const foreign = await fromTemplate({ recipients: people() }, outsider).expect(404);
    expect(foreign.body.code).toBe('TEMPLATE_NOT_FOUND');
  });

  it('refuses a category the policy blocked after the template was saved, before storing anything', async () => {
    const source = await prepareEnvelope(t.http, owner, [
      { name: 'Only', email: 'o@example.test' },
    ]);
    const blocked = (
      await request(t.http)
        .post('/api/v1/templates')
        .set(as(owner))
        .send({ envelopeId: source.id, name: 'Soon blocked' })
        .expect(201)
    ).body as TemplateDetail;
    await ownerQuery(
      `UPDATE "Template" SET "documentCategory" = 'WILL_OR_TESTAMENTARY' WHERE id = $1`,
      [blocked.id],
    );
    const before = await ownerQuery<{ n: string }>('SELECT count(*) AS n FROM "Envelope"');
    const res = await fromTemplate(
      { recipients: [{ role: 'Only', name: 'Only', email: uniqueEmail('only') }] },
      owner,
      blocked.id,
    ).expect(422);
    expect(res.body.code).toBe('DOCUMENT_CATEGORY_BLOCKED');
    const after = await ownerQuery<{ n: string }>('SELECT count(*) AS n FROM "Envelope"');
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  it('lets a member use a template, owning what they create', async () => {
    const res = await fromTemplate({ recipients: people() }, member).expect(201);
    const envelope = res.body as EnvelopeDetail;
    const row = await ownerQuery<{ ownerId: string }>(
      'SELECT "ownerId" FROM "Envelope" WHERE id = $1',
      [envelope.id],
    );
    expect(row.rows[0]?.ownerId).toBe(member.body.user.id);
    await request(t.http).get(`/api/v1/envelopes/${envelope.id}`).set(as(member)).expect(200);
  });

  it('repeats safely with an Idempotency-Key, and refuses the key with a different body', async () => {
    const given = people();
    const key = `template-${randomUUID()}`;
    const first = await fromTemplate({ recipients: given }).set('Idempotency-Key', key).expect(201);
    const second = await fromTemplate({ recipients: given })
      .set('Idempotency-Key', key)
      .expect(201);
    expect(second.headers['idempotency-replayed']).toBe('true');
    expect(second.body.id).toBe(first.body.id);
    const count = await ownerQuery<{ n: string }>(
      `SELECT count(*) AS n FROM "Recipient" WHERE email = $1`,
      [given[0]?.email],
    );
    expect(count.rows[0]?.n).toBe('1');
    const other = await fromTemplate({ recipients: people() })
      .set('Idempotency-Key', key)
      .expect(422);
    expect(other.body.code).toBe('IDEMPOTENCY_KEY_MISMATCH');
  });

  it('works with an API key, and a read-only key is refused', async () => {
    const full = await createApiKey(t.http, owner);
    const readOnly = await createApiKey(t.http, owner, { readOnly: true });
    await request(t.http)
      .post(`/api/v1/templates/${template.id}/envelopes`)
      .set('Authorization', full.authorization)
      .send({ recipients: people() })
      .expect(201);
    const refused = await request(t.http)
      .post(`/api/v1/templates/${template.id}/envelopes`)
      .set('Authorization', readOnly.authorization)
      .send({ recipients: people() })
      .expect(403);
    expect(refused.body.code).toBe('API_KEY_READ_ONLY');
    await request(t.http)
      .post(`/api/v1/templates/${template.id}/envelopes`)
      .send({ recipients: people() })
      .expect(401);
  });
});
