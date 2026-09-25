import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  });

  afterAll(() => t.close());

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
