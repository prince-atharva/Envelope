import { randomUUID } from 'node:crypto';
import type { TemplateDetail, TemplateListResponse } from '@envelope/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  captureLogs,
  createTestApp,
  createTestWorker,
  type TestApp,
  type TestWorker,
} from './helpers/app';
import { registerUser, type SignedInUser } from './helpers/auth';
import { ownerQuery, truncateAll } from './helpers/db';
import { bearer, type PersonSpec, prepareEnvelope } from './helpers/signing';
import { readStoredObject } from './helpers/storage';
import { createApiKey, inviteUser } from './helpers/workspace';

/**
 * Saving an envelope as a template, and reading and managing templates
 * (docs/20 step 2, ADR 0027).
 */
describe('templates (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;
  let outsider: SignedInUser;
  let member: SignedInUser;
  const logs = captureLogs();

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    worker = await createTestWorker();
    owner = await registerUser(t.http, {
      fullName: 'Template Owner',
      organization: 'Template Clinic',
    });
    outsider = await registerUser(t.http, { organization: 'Other Clinic' });
    member = await inviteUser(t.http, worker, owner, 'MEMBER', 'Template Member');
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
    logs.restore();
  });

  const as = (user: SignedInUser) => ({ Authorization: bearer(user) });

  async function prepared(
    people: PersonSpec[] = [{ name: 'Alex Morgan', email: 'alex@example.test' }],
  ) {
    return prepareEnvelope(t.http, owner, people);
  }

  function save(body: Record<string, unknown>, user: SignedInUser = owner) {
    return request(t.http).post('/api/v1/templates').set(as(user)).send(body);
  }

  it('saves an envelope as a template with its own copy of the PDF, its roles and its fields', async () => {
    const envelope = await prepared([
      { name: 'Alex Morgan', email: 'alex@example.test' },
      { name: 'Dr Rivera', email: 'rivera@example.test', role: 'APPROVER' },
      { name: 'Records', email: 'records@example.test', role: 'CC' },
    ]);
    const [alex, rivera] = envelope.recipients;
    logs.clear();
    const res = await save({
      envelopeId: envelope.id,
      name: 'Intake consent',
      description: 'The standard form',
      roleNames: { [alex?.id as string]: 'Patient' },
    }).expect(201);
    const template = res.body as TemplateDetail;

    expect(template.name).toBe('Intake consent');
    expect(template.pageCount).toBe(2);
    expect(template.roleCount).toBe(3);
    // Named after the person unless renamed; a CC keeps its kind and has no fields.
    expect(template.roles.map((r) => [r.name, r.role, r.routingOrder])).toEqual([
      ['Patient', 'SIGNER', 1],
      ['Dr Rivera', 'APPROVER', 2],
      ['Records', 'CC', 3],
    ]);
    expect(template.fields).toHaveLength(envelope.fields.length);
    const patient = template.roles.find((r) => r.name === 'Patient');
    expect(template.fields.filter((f) => f.templateRoleId === patient?.id)).toHaveLength(5);
    expect(rivera).toBeDefined();

    // Its own stored PDF, outside every envelope's prefix, with the same bytes.
    const stored = await ownerQuery<{ originalFileUrl: string; originalHash: string }>(
      'SELECT "originalFileUrl", "originalHash" FROM "Template" WHERE id = $1',
      [template.id],
    );
    const key = stored.rows[0]?.originalFileUrl as string;
    expect(key).toContain(`/templates/${template.id}/`);
    expect(key).not.toContain('/envelopes/');
    const original = await ownerQuery<{ originalFileUrl: string }>(
      'SELECT "originalFileUrl" FROM "Envelope" WHERE id = $1',
      [envelope.id],
    );
    expect(await readStoredObject(key)).toEqual(
      await readStoredObject(original.rows[0]?.originalFileUrl as string),
    );

    const log = logs.find('Template created', 'info')[0];
    expect(log?.fields).toMatchObject({ templateId: template.id, roleCount: 3 });
    // No one's email or name goes into the logs.
    expect(logs.text()).not.toContain('alex@example.test');
    expect(logs.text()).not.toContain('Alex Morgan');
  });

  it('names roles after the people, and keeps two people with one name apart', async () => {
    const envelope = await prepared([
      { name: 'Sam', email: 'sam1@example.test' },
      { name: 'Sam', email: 'sam2@example.test' },
    ]);
    const res = await save({ envelopeId: envelope.id, name: 'Two Sams' }).expect(201);
    expect((res.body as TemplateDetail).roles.map((r) => r.name)).toEqual(['Sam', 'Sam (2)']);
  });

  it('refuses an envelope that is not ready, an unknown role name key, and a repeated role name', async () => {
    const bare = await prepareEnvelope(t.http, owner, []);
    const none = await save({ envelopeId: bare.id, name: 'Nothing yet' }).expect(422);
    expect(none.body.code).toBe('NOT_READY_TO_SEND');

    const envelope = await prepared();
    const unknown = await save({
      envelopeId: envelope.id,
      name: 'Bad roles',
      roleNames: { [randomUUID()]: 'Ghost' },
    }).expect(400);
    expect(unknown.body.code).toBe('VALIDATION_FAILED');

    const two = await prepared([
      { name: 'One', email: 'one@example.test' },
      { name: 'Two', email: 'two@example.test' },
    ]);
    const same = await save({
      envelopeId: two.id,
      name: 'Same names',
      roleNames: {
        [two.recipients[0]?.id as string]: 'Patient',
        [two.recipients[1]?.id as string]: 'Patient',
      },
    }).expect(400);
    expect(same.body.code).toBe('VALIDATION_FAILED');
  });

  it('keeps a name unique among active templates, and frees it on archive', async () => {
    const envelope = await prepared();
    await save({ envelopeId: envelope.id, name: 'Unique name' }).expect(201);
    const again = await save({ envelopeId: envelope.id, name: 'Unique name' }).expect(409);
    expect(again.body.code).toBe('TEMPLATE_NAME_TAKEN');

    const list = (await request(t.http).get('/api/v1/templates').set(as(owner)).expect(200))
      .body as TemplateListResponse;
    const first = list.templates.find((x) => x.name === 'Unique name');
    await request(t.http)
      .patch(`/api/v1/templates/${first?.id}`)
      .set(as(owner))
      .send({ archived: true })
      .expect(200);
    const reused = await save({ envelopeId: envelope.id, name: 'Unique name' }).expect(201);
    const newId = (reused.body as TemplateDetail).id;

    // Restoring the old one now would duplicate an active name.
    const restore = await request(t.http)
      .patch(`/api/v1/templates/${first?.id}`)
      .set(as(owner))
      .send({ archived: false })
      .expect(409);
    expect(restore.body.code).toBe('TEMPLATE_NAME_TAKEN');
    await request(t.http)
      .patch(`/api/v1/templates/${newId}`)
      .set(as(owner))
      .send({ archived: true })
      .expect(200);
    await request(t.http)
      .patch(`/api/v1/templates/${first?.id}`)
      .set(as(owner))
      .send({ archived: false })
      .expect(200);
  });

  it('renames, describes and archives, and lists archived ones only on request', async () => {
    const envelope = await prepared();
    const created = (await save({ envelopeId: envelope.id, name: 'Before' }).expect(201))
      .body as TemplateDetail;
    logs.clear();
    const renamed = await request(t.http)
      .patch(`/api/v1/templates/${created.id}`)
      .set(as(owner))
      .send({ name: 'After', description: 'Now described', defaultMessage: 'Please sign' })
      .expect(200);
    expect(renamed.body).toMatchObject({
      name: 'After',
      description: 'Now described',
      defaultMessage: 'Please sign',
    });
    expect(logs.find('Template renamed', 'info')).toHaveLength(1);

    await request(t.http)
      .patch(`/api/v1/templates/${created.id}`)
      .set(as(owner))
      .send({})
      .expect(400);
    await request(t.http)
      .patch(`/api/v1/templates/${created.id}`)
      .set(as(owner))
      .send({ archived: true })
      .expect(200);
    expect(logs.find('Template archived', 'info')).toHaveLength(1);

    const active = (await request(t.http).get('/api/v1/templates').set(as(owner)).expect(200))
      .body as TemplateListResponse;
    expect(active.templates.map((x) => x.id)).not.toContain(created.id);
    const archived = (
      await request(t.http).get('/api/v1/templates?archived=true').set(as(owner)).expect(200)
    ).body as TemplateListResponse;
    expect(archived.templates.map((x) => x.id)).toContain(created.id);
    // An archived template can still be read by id.
    const read = await request(t.http)
      .get(`/api/v1/templates/${created.id}`)
      .set(as(owner))
      .expect(200);
    expect(read.body.archivedAt).not.toBeNull();
  });

  it('lets a member read templates but not create or change them', async () => {
    const envelope = await prepared();
    const created = (await save({ envelopeId: envelope.id, name: 'Shared form' }).expect(201))
      .body as TemplateDetail;

    const denied = await save({ envelopeId: envelope.id, name: 'By a member' }, member).expect(403);
    expect(denied.body.code).toBe('FORBIDDEN_ROLE');
    await request(t.http)
      .patch(`/api/v1/templates/${created.id}`)
      .set(as(member))
      .send({ name: 'Hijacked' })
      .expect(403);
    await request(t.http).get(`/api/v1/templates/${created.id}`).set(as(member)).expect(200);
    const list = (await request(t.http).get('/api/v1/templates').set(as(member)).expect(200))
      .body as TemplateListResponse;
    expect(list.templates.map((x) => x.id)).toContain(created.id);
    await request(t.http).get('/api/v1/templates?archived=true').set(as(member)).expect(403);
  });

  it('never shows or changes another workspace’s template, or saves its envelope', async () => {
    const envelope = await prepared();
    const created = (await save({ envelopeId: envelope.id, name: 'Private form' }).expect(201))
      .body as TemplateDetail;

    const read = await request(t.http)
      .get(`/api/v1/templates/${created.id}`)
      .set(as(outsider))
      .expect(404);
    expect(read.body.code).toBe('TEMPLATE_NOT_FOUND');
    await request(t.http)
      .patch(`/api/v1/templates/${created.id}`)
      .set(as(outsider))
      .send({ name: 'Mine now' })
      .expect(404);
    const list = (await request(t.http).get('/api/v1/templates').set(as(outsider)).expect(200))
      .body as TemplateListResponse;
    expect(list.templates).toEqual([]);

    const theirs = await save({ envelopeId: envelope.id, name: 'Stolen' }, outsider).expect(404);
    expect(theirs.body.code).toBe('NOT_FOUND');
  });

  it('works with a full API key, and a read-only key can read but not write', async () => {
    const full = await createApiKey(t.http, owner);
    const readOnly = await createApiKey(t.http, owner, { readOnly: true });
    const envelope = await prepared();

    const created = await request(t.http)
      .post('/api/v1/templates')
      .set('Authorization', full.authorization)
      .send({ envelopeId: envelope.id, name: 'From a partner' })
      .expect(201);
    const id = (created.body as TemplateDetail).id;
    await request(t.http)
      .get(`/api/v1/templates/${id}`)
      .set('Authorization', readOnly.authorization)
      .expect(200);
    await request(t.http)
      .get('/api/v1/templates')
      .set('Authorization', readOnly.authorization)
      .expect(200);
    const refused = await request(t.http)
      .post('/api/v1/templates')
      .set('Authorization', readOnly.authorization)
      .send({ envelopeId: envelope.id, name: 'Nope' })
      .expect(403);
    expect(refused.body.code).toBe('API_KEY_READ_ONLY');
    await request(t.http)
      .patch(`/api/v1/templates/${id}`)
      .set('Authorization', readOnly.authorization)
      .send({ name: 'Nope' })
      .expect(403);
  });

  it('refuses a malformed id and unknown body keys', async () => {
    // An id that cannot exist is answered like one that does not, as elsewhere.
    await request(t.http).get('/api/v1/templates/not-a-uuid').set(as(owner)).expect(404);
    const envelope = await prepared();
    await save({ envelopeId: envelope.id, name: 'Extra', layout: [] }).expect(400);
    await request(t.http).get('/api/v1/templates').expect(401);
  });
});
