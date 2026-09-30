import { randomUUID } from 'node:crypto';
import {
  type BulkBatchDetail,
  type BulkBatchListResponse,
  type EnvelopeDetail,
  MAX_BULK_ROWS,
  type TemplateDetail,
} from '@envelope/shared';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BulkRunner } from '../src/bulk/bulk-runner.service';
import { SessionCleanupService } from '../src/maintenance/session-cleanup.service';
import { BULK_QUEUE } from '../src/queue/queue.module';
import {
  captureLogs,
  createTestApp,
  createTestWorker,
  type TestApp,
  type TestWorker,
  waitFor,
} from './helpers/app';
import { registerUser, type SignedInUser, uniqueEmail } from './helpers/auth';
import { ownerQuery, truncateAll } from './helpers/db';
import { bearer, linkFor, prepareEnvelope } from './helpers/signing';
import { createApiKey, inviteUser } from './helpers/workspace';

type Row = { recipients: { role: string; name: string; email: string }[]; externalId?: string };

/** Bulk send: a batch of independent envelopes made by the worker (docs/20 step 4, ADR 0028). */
describe('bulk send (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;
  let member: SignedInUser;
  let outsider: SignedInUser;
  let template: TemplateDetail;
  const logs = captureLogs();

  const as = (user: SignedInUser) => ({ Authorization: bearer(user) });
  const person = (role: string, label = role.toLowerCase()) => ({
    role,
    name: `${role} ${label}`,
    email: uniqueEmail(label),
  });
  const goodRow = (extra: Partial<Row> = {}): Row => ({
    recipients: [person('Patient'), person('Doctor')],
    ...extra,
  });
  const start = (
    body: Record<string, unknown>,
    user: SignedInUser = owner,
    id: string = template.id,
  ) => request(t.http).post(`/api/v1/templates/${id}/bulk`).set(as(user)).send(body);

  async function batchOf(id: string, user: SignedInUser = owner): Promise<BulkBatchDetail> {
    const res = await request(t.http).get(`/api/v1/bulk-batches/${id}`).set(as(user)).expect(200);
    return res.body as BulkBatchDetail;
  }
  /** Polls the database, not the API: a tight HTTP poll trips the per-address request limit. */
  async function finished(
    id: string,
    user: SignedInUser = owner,
    timeoutMs = 30_000,
  ): Promise<BulkBatchDetail> {
    await waitFor(async () => {
      const { rows } = await ownerQuery<{ status: string }>(
        'SELECT status FROM "BulkBatch" WHERE id = $1',
        [id],
      );
      return rows[0]?.status === 'COMPLETED' ? true : undefined;
    }, timeoutMs);
    return batchOf(id, user);
  }
  async function saveTemplate(user: SignedInUser, name: string): Promise<TemplateDetail> {
    const source = await prepareEnvelope(
      t.http,
      user,
      [
        { name: 'Patient', email: 'p@example.test', routingOrder: 1 },
        { name: 'Doctor', email: 'd@example.test', routingOrder: 2, role: 'APPROVER' },
      ],
      { sequential: true },
    );
    const res = await request(t.http)
      .post('/api/v1/templates')
      .set(as(user))
      .send({ envelopeId: source.id, name })
      .expect(201);
    return res.body as TemplateDetail;
  }
  /**
   * A workspace of its own: starting a batch is limited to 10 an hour per workspace, and
   * rejected requests count too, so tests that start many use a fresh one.
   */
  async function newWorkspace(organization: string) {
    const user = await registerUser(t.http, { organization });
    return { owner: user, template: await saveTemplate(user, `${organization} form`) };
  }
  const count = async (table: string) =>
    Number((await ownerQuery<{ n: string }>(`SELECT count(*) AS n FROM "${table}"`)).rows[0]?.n);

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    await t.app.get<Queue>(getQueueToken(BULK_QUEUE)).obliterate({ force: true });
    worker = await createTestWorker();
    owner = await registerUser(t.http, { fullName: 'Bulk Owner', organization: 'Bulk Clinic' });
    outsider = await registerUser(t.http, { organization: 'Elsewhere' });
    member = await inviteUser(t.http, worker, owner, 'MEMBER', 'Bulk Member');
    template = await saveTemplate(owner, 'Bulk consent');
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
    logs.restore();
  });

  it('makes and sends an envelope per row, reports the row that cannot be made, and clears used rows', async () => {
    const rows: Row[] = [
      goodRow({ externalId: 'visit:1' }),
      // Only one of the two people the template needs.
      { recipients: [person('Patient')] },
      goodRow({ externalId: 'visit:3' }),
    ];
    logs.clear();
    const accepted = await start({ rows, send: true, message: 'Please sign' }).expect(202);
    const batchId = accepted.body.batchId as string;
    expect(batchId).toBeTruthy();

    const batch = await finished(batchId);
    expect(batch).toMatchObject({
      status: 'COMPLETED',
      send: true,
      totalRows: 3,
      succeededRows: 2,
      failedRows: 1,
      templateName: 'Bulk consent',
    });
    expect(batch.rows.map((r) => [r.rowIndex, r.status, r.errorCode])).toEqual([
      [0, 'SUCCEEDED', null],
      [1, 'FAILED', 'TEMPLATE_ROLE_MISMATCH'],
      [2, 'SUCCEEDED', null],
    ]);
    expect(batch.rows[1]?.envelopeId).toBeNull();

    // Two real, sent envelopes owned by the person who started the batch, with the row's reference.
    for (const index of [0, 2]) {
      const envelopeId = batch.rows[index]?.envelopeId as string;
      const res = await request(t.http)
        .get(`/api/v1/envelopes/${envelopeId}`)
        .set(as(owner))
        .expect(200);
      const envelope = res.body as EnvelopeDetail;
      expect(envelope.status).toBe('SENT');
      expect(envelope.message).toBe('Please sign');
      expect(envelope.recipients).toHaveLength(2);
      const stored = await ownerQuery<{ externalId: string; ownerId: string }>(
        'SELECT "externalId", "ownerId" FROM "Envelope" WHERE id = $1',
        [envelopeId],
      );
      expect(stored.rows[0]).toEqual({
        externalId: `visit:${index + 1}`,
        ownerId: owner.body.user.id,
      });
      const first = rows[index]?.recipients[0]?.email as string;
      await linkFor(worker.mailbox, first);
    }

    // The envelope is the record of who was emailed: used rows no longer hold addresses.
    const left = await ownerQuery<{ rowIndex: number; has: boolean }>(
      `SELECT "rowIndex", recipients IS NOT NULL AS has FROM "BulkBatchRow"
        WHERE "batchId" = $1 ORDER BY "rowIndex"`,
      [batchId],
    );
    expect(left.rows.map((r) => r.has)).toEqual([false, true, false]);

    // Audit evidence carries the requester's address, not the worker's.
    const audit = await ownerQuery<{ ipAddress: string }>(
      `SELECT "ipAddress" FROM "AuditTrail" WHERE "envelopeId" = $1 AND action = 'ENVELOPE_CREATED'`,
      [batch.rows[0]?.envelopeId],
    );
    expect(audit.rows[0]?.ipAddress).not.toBe('worker');

    expect(logs.find('Bulk batch accepted', 'info')[0]?.fields).toMatchObject({ batchId, rows: 3 });
    expect(logs.find('Bulk row succeeded', 'info')).toHaveLength(2);
    expect(logs.find('Bulk row failed', 'warn')[0]?.fields).toMatchObject({
      rowIndex: 1,
      code: 'TEMPLATE_ROLE_MISMATCH',
    });
    expect(logs.find('Bulk batch completed', 'info')[0]?.fields).toMatchObject({
      succeededRows: 2,
      failedRows: 1,
    });
    for (const row of rows)
      for (const p of row.recipients) expect(logs.text()).not.toContain(p.email);

    // Reading a batch never shows an address.
    const text = JSON.stringify(batch);
    for (const row of rows) for (const p of row.recipients) expect(text).not.toContain(p.email);
  });

  it('leaves drafts when not asked to send', async () => {
    const accepted = await start({ rows: [goodRow(), goodRow()] }).expect(202);
    const batch = await finished(accepted.body.batchId);
    expect(batch).toMatchObject({ send: false, succeededRows: 2, failedRows: 0 });
    for (const row of batch.rows) {
      const res = await request(t.http)
        .get(`/api/v1/envelopes/${row.envelopeId}`)
        .set(as(owner))
        .expect(200);
      expect(res.body.status).toBe('DRAFT');
    }
  });

  it('does nothing more when a finished batch’s job runs again', async () => {
    const accepted = await start({ rows: [goodRow()], send: true }).expect(202);
    await finished(accepted.body.batchId);
    const before = await count('Envelope');
    await worker.module.get(BulkRunner).run(accepted.body.batchId);
    expect(await count('Envelope')).toBe(before);
  });

  it('finishes a row whose envelope was made before a crash, without making another', async () => {
    const people = [person('Patient'), person('Doctor')];
    // The state a crash leaves: the draft exists and the row knows it, but was never sent.
    const draft = await request(t.http)
      .post(`/api/v1/templates/${template.id}/envelopes`)
      .set(as(owner))
      .send({ recipients: people })
      .expect(201);
    const batchId = randomUUID();
    await ownerQuery(
      `INSERT INTO "BulkBatch" (id, "tenantId", "templateId", "createdById", status, "sendOnCreate",
                                "totalRows", "clientIp", "clientUserAgent")
       VALUES ($1, $2, $3, $4, 'PROCESSING', true, 1, '203.0.113.9', 'test')`,
      [batchId, owner.body.user.tenant.id, template.id, owner.body.user.id],
    );
    await ownerQuery(
      `INSERT INTO "BulkBatchRow" (id, "batchId", "rowIndex", status, recipients, "envelopeId")
       VALUES ($1, $2, 0, 'PENDING', $3::jsonb, $4)`,
      [randomUUID(), batchId, JSON.stringify(people), draft.body.id],
    );
    const before = await count('Envelope');
    await worker.module.get(BulkRunner).run(batchId);

    expect(await count('Envelope')).toBe(before);
    const batch = await batchOf(batchId);
    expect(batch).toMatchObject({ status: 'COMPLETED', succeededRows: 1, failedRows: 0 });
    expect(batch.rows[0]).toMatchObject({ status: 'SUCCEEDED', envelopeId: draft.body.id });
    const res = await request(t.http)
      .get(`/api/v1/envelopes/${draft.body.id}`)
      .set(as(owner))
      .expect(200);
    expect(res.body.status).toBe('SENT');
    await linkFor(worker.mailbox, people[0]?.email as string);
  });

  it('refuses too many rows and malformed rows, storing nothing', async () => {
    const ws = await newWorkspace('Strict Clinic');
    const before = { batches: await count('BulkBatch'), rows: await count('BulkBatchRow') };
    const many = Array.from({ length: MAX_BULK_ROWS + 1 }, () => goodRow());
    const tooMany = await start({ rows: many }, ws.owner, ws.template.id).expect(422);
    expect(tooMany.body.code).toBe('BULK_TOO_LARGE');

    const badEmail = await start(
      {
        rows: [goodRow(), { recipients: [{ role: 'Patient', name: 'X', email: 'not-an-email' }] }],
      },
      ws.owner,
      ws.template.id,
    ).expect(400);
    expect(badEmail.body.code).toBe('VALIDATION_FAILED');
    await start({ rows: [] }, ws.owner, ws.template.id).expect(400);
    await start({ rows: [goodRow()], extra: true }, ws.owner, ws.template.id).expect(400);
    expect({ batches: await count('BulkBatch'), rows: await count('BulkBatchRow') }).toEqual(
      before,
    );
  });

  it('accepts exactly the maximum number of rows', async () => {
    const ws = await newWorkspace('Maximum Clinic');
    const accepted = await start(
      { rows: Array.from({ length: MAX_BULK_ROWS }, () => goodRow()) },
      ws.owner,
      ws.template.id,
    ).expect(202);
    const batch = await batchOf(accepted.body.batchId, ws.owner);
    expect(batch.totalRows).toBe(MAX_BULK_ROWS);
    // Let the worker finish so the next tests start with an idle queue.
    const done = await finished(accepted.body.batchId, ws.owner, 120_000);
    expect(done).toMatchObject({ succeededRows: MAX_BULK_ROWS, failedRows: 0 });
  }, 150_000);

  it('refuses an archived, unknown or foreign template', async () => {
    const ws = await newWorkspace('Archive Clinic');
    await request(t.http)
      .patch(`/api/v1/templates/${ws.template.id}`)
      .set(as(ws.owner))
      .send({ archived: true })
      .expect(200);
    const archived = await start({ rows: [goodRow()] }, ws.owner, ws.template.id).expect(409);
    expect(archived.body.code).toBe('TEMPLATE_ARCHIVED');
    const unknown = await start({ rows: [goodRow()] }, ws.owner, randomUUID()).expect(404);
    expect(unknown.body.code).toBe('TEMPLATE_NOT_FOUND');
    const foreign = await start({ rows: [goodRow()] }, outsider, ws.template.id).expect(404);
    expect(foreign.body.code).toBe('TEMPLATE_NOT_FOUND');
  });

  it('lets a member start a batch and see only their own, an admin see all, and outsiders none', async () => {
    const mine = await start({ rows: [goodRow()] }, member).expect(202);
    const ownersBatch = await start({ rows: [goodRow()] }).expect(202);
    await finished(mine.body.batchId, member);
    await finished(ownersBatch.body.batchId);

    const memberList = (
      await request(t.http).get('/api/v1/bulk-batches').set(as(member)).expect(200)
    ).body as BulkBatchListResponse;
    const ids = memberList.batches.map((b) => b.id);
    expect(ids).toContain(mine.body.batchId);
    expect(ids).not.toContain(ownersBatch.body.batchId);
    await request(t.http)
      .get(`/api/v1/bulk-batches/${ownersBatch.body.batchId}`)
      .set(as(member))
      .expect(404);

    const ownerList = (await request(t.http).get('/api/v1/bulk-batches').set(as(owner)).expect(200))
      .body as BulkBatchListResponse;
    expect(ownerList.batches.map((b) => b.id)).toEqual(
      expect.arrayContaining([mine.body.batchId, ownersBatch.body.batchId]),
    );
    // Newest first.
    const times = ownerList.batches.map((b) => Date.parse(b.createdAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));

    const foreignRead = await request(t.http)
      .get(`/api/v1/bulk-batches/${mine.body.batchId}`)
      .set(as(outsider))
      .expect(404);
    expect(foreignRead.body.code).toBe('BULK_BATCH_NOT_FOUND');
    const foreignList = (
      await request(t.http).get('/api/v1/bulk-batches').set(as(outsider)).expect(200)
    ).body as BulkBatchListResponse;
    expect(foreignList.batches).toEqual([]);
  });

  it('repeats safely with an Idempotency-Key', async () => {
    const ws = await newWorkspace('Idempotent Clinic');
    const body = { rows: [goodRow()] };
    const key = `bulk-${randomUUID()}`;
    const first = await start(body, ws.owner, ws.template.id)
      .set('Idempotency-Key', key)
      .expect(202);
    const second = await start(body, ws.owner, ws.template.id)
      .set('Idempotency-Key', key)
      .expect(202);
    expect(second.headers['idempotency-replayed']).toBe('true');
    expect(second.body.batchId).toBe(first.body.batchId);
    const other = await start({ rows: [goodRow()] }, ws.owner, ws.template.id)
      .set('Idempotency-Key', key)
      .expect(422);
    expect(other.body.code).toBe('IDEMPOTENCY_KEY_MISMATCH');
    await finished(first.body.batchId, ws.owner);
    expect(
      (
        await ownerQuery<{ n: string }>(
          'SELECT count(*) AS n FROM "BulkBatch" WHERE "tenantId" = $1',
          [ws.owner.body.user.tenant.id],
        )
      ).rows[0]?.n,
    ).toBe('1');
  });

  it('works with an API key, and a read-only key can read batches but not start one', async () => {
    const ws = await newWorkspace('Partner Clinic');
    const full = await createApiKey(t.http, ws.owner);
    const readOnly = await createApiKey(t.http, ws.owner, { readOnly: true });
    const started = await request(t.http)
      .post(`/api/v1/templates/${ws.template.id}/bulk`)
      .set('Authorization', full.authorization)
      .send({ rows: [goodRow()] })
      .expect(202);
    await finished(started.body.batchId, ws.owner);
    await request(t.http)
      .get(`/api/v1/bulk-batches/${started.body.batchId}`)
      .set('Authorization', readOnly.authorization)
      .expect(200);
    await request(t.http)
      .get('/api/v1/bulk-batches')
      .set('Authorization', readOnly.authorization)
      .expect(200);
    const refused = await request(t.http)
      .post(`/api/v1/templates/${ws.template.id}/bulk`)
      .set('Authorization', readOnly.authorization)
      .send({ rows: [goodRow()] })
      .expect(403);
    expect(refused.body.code).toBe('API_KEY_READ_ONLY');
    await request(t.http)
      .post(`/api/v1/templates/${ws.template.id}/bulk`)
      .send({ rows: [goodRow()] })
      .expect(401);
  });

  it('clears the addresses kept on failed rows once a finished batch is 30 days old', async () => {
    const accepted = await start({ rows: [{ recipients: [person('Patient')] }] }).expect(202);
    const batchId = accepted.body.batchId as string;
    await finished(batchId);
    const has = async () =>
      (
        await ownerQuery<{ has: boolean }>(
          `SELECT recipients IS NOT NULL AS has FROM "BulkBatchRow" WHERE "batchId" = $1`,
          [batchId],
        )
      ).rows[0]?.has;
    expect(await has()).toBe(true);

    const cleanup = worker.module.get(SessionCleanupService);
    await cleanup.run(new Date());
    expect(await has()).toBe(true);

    await ownerQuery(
      `UPDATE "BulkBatch" SET "createdAt" = now() - interval '31 days' WHERE id = $1`,
      [batchId],
    );
    await cleanup.run(new Date());
    expect(await has()).toBe(false);
    // The outcome stays.
    const batch = await batchOf(batchId);
    expect(batch.rows[0]).toMatchObject({ status: 'FAILED', errorCode: 'TEMPLATE_ROLE_MISMATCH' });
  });

  it('limits how many batches a workspace can start in an hour', async () => {
    const busy = await newWorkspace('Busy Clinic');
    const one = { rows: [{ recipients: [person('Patient'), person('Doctor')] }] };
    for (let i = 0; i < 10; i += 1) await start(one, busy.owner, busy.template.id).expect(202);
    const limited = await start(one, busy.owner, busy.template.id).expect(429);
    expect(limited.body.code).toBe('RATE_LIMITED');
    // Another workspace is not affected.
    await start({ rows: [goodRow()] }).expect(202);
  }, 60_000);
});
