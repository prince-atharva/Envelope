import type { TemplateDetail } from '@envelope/shared';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BULK_QUEUE } from '../src/queue/queue.module';
import { createTestApp, type TestApp } from './helpers/app';
import { registerUser, type SignedInUser, uniqueEmail } from './helpers/auth';
import { truncateAll } from './helpers/db';
import { bearer, prepareEnvelope, sendEnvelope } from './helpers/signing';

/**
 * Cross-tenant isolation (docs/05: "a dedicated test suite that attempts
 * cross-tenant access on every endpoint"). Table-driven over every route
 * that takes an envelope id, including every Phase 6 route (docs/17):
 * tenant B, fully authenticated as itself, must never be able to read or
 * change tenant A's envelope. The correct answer throughout is 404 — the
 * same answer a nonexistent id gets — never a 403 or a state-specific
 * error that would confirm the row exists at all.
 */
describe('cross-tenant isolation (e2e)', () => {
  let t: TestApp;
  let ownerA: SignedInUser;
  let ownerB: SignedInUser;
  let draftId: string;
  let recipientId: string;
  let fieldId: string;
  let sentId: string;
  let templateId: string;
  let batchId: string;

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    ownerA = await registerUser(t.http, { fullName: 'Tenant A', organization: 'Tenant A Clinic' });
    ownerB = await registerUser(t.http, { fullName: 'Tenant B', organization: 'Tenant B Clinic' });

    const draft = await prepareEnvelope(t.http, ownerA, [
      { name: 'A Signer', email: uniqueEmail('cross-a-draft') },
    ]);
    draftId = draft.id;
    recipientId = draft.recipients[0]?.id ?? '';
    fieldId = draft.fields[0]?.id ?? '';

    const sent = await prepareEnvelope(t.http, ownerA, [
      { name: 'A Sent Signer', email: uniqueEmail('cross-a-sent') },
    ]);
    sentId = sent.id;
    await sendEnvelope(t.http, ownerA, sentId).expect(200);

    // A template and a bulk batch of tenant A's, for the Phase 9 routes below.
    const source = await prepareEnvelope(t.http, ownerA, [
      { name: 'Patient', email: uniqueEmail('cross-a-template') },
    ]);
    const template = await request(t.http)
      .post('/api/v1/templates')
      .set('Authorization', bearer(ownerA))
      .send({ envelopeId: source.id, name: 'Tenant A form' })
      .expect(201);
    templateId = (template.body as TemplateDetail).id;
    const batch = await request(t.http)
      .post(`/api/v1/templates/${templateId}/bulk`)
      .set('Authorization', bearer(ownerA))
      .send({
        rows: [{ recipients: [{ role: 'Patient', name: 'P', email: uniqueEmail('cross-row') }] }],
      })
      .expect(202);
    batchId = batch.body.batchId;
  });

  afterAll(async () => {
    // No worker runs here; do not leave A's batch job for the next file's worker.
    await t.app.get<Queue>(getQueueToken(BULK_QUEUE)).obliterate({ force: true });
    await t.close();
  });

  function attempt(name: string, build: () => request.Test): void {
    it(name, async () => {
      const res = await build().set('Authorization', bearer(ownerB));
      expect(res.status, `${name} → status`).toBe(404);
      expect(res.body.code, `${name} → code`).toBe('NOT_FOUND');
    });
  }

  describe('reads', () => {
    attempt('GET /envelopes/:id', () => request(t.http).get(`/api/v1/envelopes/${draftId}`));
    attempt('GET /envelopes/:id/events', () =>
      request(t.http).get(`/api/v1/envelopes/${draftId}/events`),
    );
    attempt('GET /envelopes/:id/file', () =>
      request(t.http).get(`/api/v1/envelopes/${draftId}/file`),
    );
    attempt('GET /envelopes/:id/audit', () =>
      request(t.http).get(`/api/v1/envelopes/${sentId}/audit`),
    );
  });

  describe('draft mutations', () => {
    attempt('PATCH /envelopes/:id', () =>
      request(t.http).patch(`/api/v1/envelopes/${draftId}`).send({ title: 'Hijacked' }),
    );
    attempt('POST /envelopes/:id/recipients', () =>
      request(t.http)
        .post(`/api/v1/envelopes/${draftId}/recipients`)
        .send({ name: 'Intruder', email: uniqueEmail('intruder'), role: 'SIGNER' }),
    );
    attempt('PATCH /envelopes/:id/recipients/:recipientId', () =>
      request(t.http)
        .patch(`/api/v1/envelopes/${draftId}/recipients/${recipientId}`)
        .send({ name: 'Hijacked Recipient' }),
    );
    attempt('DELETE /envelopes/:id/recipients/:recipientId', () =>
      request(t.http).delete(`/api/v1/envelopes/${draftId}/recipients/${recipientId}`),
    );
    attempt('PUT /envelopes/:id/fields', () =>
      request(t.http)
        .put(`/api/v1/envelopes/${draftId}/fields`)
        .send({
          fields: [
            {
              id: fieldId,
              recipientId,
              type: 'SIGNATURE',
              pageNumber: 1,
              required: true,
              ratioX: 0.1,
              ratioY: 0.1,
              ratioWidth: 0.2,
              ratioHeight: 0.05,
            },
          ],
        }),
    );
    attempt('POST /envelopes/:id/send', () =>
      request(t.http)
        .post(`/api/v1/envelopes/${draftId}/send`)
        .set('Idempotency-Key', 'cross-tenant-send'),
    );
  });

  describe('sent-envelope mutations', () => {
    attempt('POST /envelopes/:id/remind', () =>
      request(t.http).post(`/api/v1/envelopes/${sentId}/remind`),
    );
    attempt('PATCH /envelopes/:id/reminders', () =>
      request(t.http).patch(`/api/v1/envelopes/${sentId}/reminders`).send({ intervalDays: 3 }),
    );
    attempt('POST /envelopes/:id/void', () =>
      request(t.http).post(`/api/v1/envelopes/${sentId}/void`).send({ reason: 'hijack' }),
    );
    attempt('POST /envelopes/:id/extend', () =>
      request(t.http)
        .post(`/api/v1/envelopes/${sentId}/extend`)
        .set('Idempotency-Key', 'cross-tenant-extend')
        .send({ expiresInDays: 7 }),
    );
  });

  describe('legal hold (docs/17 step 7)', () => {
    attempt('POST /envelopes/:id/legal-hold', () =>
      request(t.http).post(`/api/v1/envelopes/${sentId}/legal-hold`).send({ reason: 'hijack' }),
    );
    attempt('DELETE /envelopes/:id/legal-hold', () =>
      request(t.http).delete(`/api/v1/envelopes/${sentId}/legal-hold`),
    );
  });

  describe('templates and bulk send (docs/20)', () => {
    function attemptCode(name: string, code: string, build: () => request.Test): void {
      it(name, async () => {
        const res = await build().set('Authorization', bearer(ownerB));
        expect(res.status, `${name} → status`).toBe(404);
        expect(res.body.code, `${name} → code`).toBe(code);
      });
    }
    attemptCode('GET /templates/:id', 'TEMPLATE_NOT_FOUND', () =>
      request(t.http).get(`/api/v1/templates/${templateId}`),
    );
    attemptCode('PATCH /templates/:id', 'TEMPLATE_NOT_FOUND', () =>
      request(t.http).patch(`/api/v1/templates/${templateId}`).send({ name: 'Hijacked' }),
    );
    attemptCode('POST /templates/:id/envelopes', 'TEMPLATE_NOT_FOUND', () =>
      request(t.http)
        .post(`/api/v1/templates/${templateId}/envelopes`)
        .send({ recipients: [{ role: 'Patient', name: 'X', email: uniqueEmail('cross-use') }] }),
    );
    attemptCode('POST /templates/:id/bulk', 'TEMPLATE_NOT_FOUND', () =>
      request(t.http)
        .post(`/api/v1/templates/${templateId}/bulk`)
        .send({
          rows: [{ recipients: [{ role: 'Patient', name: 'X', email: uniqueEmail('x') }] }],
        }),
    );
    attemptCode('POST /templates (saving another tenant’s envelope)', 'NOT_FOUND', () =>
      request(t.http).post('/api/v1/templates').send({ envelopeId: draftId, name: 'Stolen' }),
    );
    attemptCode('GET /bulk-batches/:id', 'BULK_BATCH_NOT_FOUND', () =>
      request(t.http).get(`/api/v1/bulk-batches/${batchId}`),
    );

    it('lists none of tenant A’s templates or batches', async () => {
      const templates = await request(t.http)
        .get('/api/v1/templates')
        .set('Authorization', bearer(ownerB));
      expect(templates.body.templates).toEqual([]);
      const archived = await request(t.http)
        .get('/api/v1/templates?archived=true')
        .set('Authorization', bearer(ownerB));
      expect(archived.body.templates).toEqual([]);
      const batches = await request(t.http)
        .get('/api/v1/bulk-batches')
        .set('Authorization', bearer(ownerB));
      expect(batches.body.batches).toEqual([]);
    });

    it('tells the two cases apart no better than for envelopes', async () => {
      const madeUp = '00000000-0000-4000-8000-000000000000';
      const [foreign, missing] = await Promise.all([
        request(t.http).get(`/api/v1/templates/${templateId}`).set('Authorization', bearer(ownerB)),
        request(t.http).get(`/api/v1/templates/${madeUp}`).set('Authorization', bearer(ownerB)),
      ]);
      expect(foreign.status).toBe(missing.status);
      expect(foreign.body.code).toBe(missing.body.code);
    });
  });

  it('a genuinely nonexistent id gets the identical answer, so the two cases cannot be told apart', async () => {
    const madeUp = '00000000-0000-4000-8000-000000000000';
    const [crossTenant, nonexistent] = await Promise.all([
      request(t.http).get(`/api/v1/envelopes/${draftId}`).set('Authorization', bearer(ownerB)),
      request(t.http).get(`/api/v1/envelopes/${madeUp}`).set('Authorization', bearer(ownerB)),
    ]);
    expect(crossTenant.status).toBe(nonexistent.status);
    expect(crossTenant.body.code).toBe(nonexistent.body.code);
  });
});
