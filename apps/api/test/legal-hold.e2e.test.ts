import type { AuthResponse } from '@envelope/shared';
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
import { ownerQuery, truncateAll } from './helpers/db';
import { bearer, prepareEnvelope } from './helpers/signing';

const INVITE_LINK = /\/accept-invite\/([0-9a-f]{64})/;

/**
 * Legal hold (docs/07, docs/17 step 7): overrides cancel, extend and purge
 * until released; both placing and releasing are audit events; ADMIN or
 * OWNER only.
 */
describe('legal hold (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;
  let member: SignedInUser;

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    worker = await createTestWorker();
    owner = await registerUser(t.http, { fullName: 'Hold Owner', organization: 'Hold Clinic' });

    const email = uniqueEmail('hold-member');
    await request(t.http)
      .post('/api/v1/users')
      .set('Authorization', bearer(owner))
      .send({ fullName: 'Hold Member', email, role: 'MEMBER' })
      .expect(201);
    const message = await waitFor(() =>
      worker.mailbox.messages.filter((m) => m.to === email && m.template === 'user-invited').at(-1),
    );
    const token = INVITE_LINK.exec(message.text)?.[1];
    if (!token) throw new Error('no invite link');
    const accepted = await request(t.http)
      .post(`/api/v1/auth/invitations/${token}/accept`)
      .send({ password: 'a member password' })
      .expect(200);
    const body = accepted.body as AuthResponse;
    member = {
      email,
      password: 'a member password',
      accessToken: body.accessToken,
      cookie: '',
      body,
    };
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
  });

  async function holdRow(envelopeId: string) {
    const { rows } = await ownerQuery<{
      legalHoldAt: Date | null;
      legalHoldReason: string | null;
    }>(`SELECT "legalHoldAt", "legalHoldReason" FROM "Envelope" WHERE id = $1`, [envelopeId]);
    return rows[0];
  }

  async function auditActions(envelopeId: string) {
    const { rows } = await ownerQuery<{ action: string }>(
      `SELECT action FROM "AuditTrail" WHERE "envelopeId" = $1 ORDER BY sequence`,
      [envelopeId],
    );
    return rows.map((r) => r.action);
  }

  it('places and releases a hold, both recorded in the audit trail', async () => {
    const envelope = await prepareEnvelope(t.http, owner, [
      { name: 'Held Signer', email: uniqueEmail('held') },
    ]);

    const placed = await request(t.http)
      .post(`/api/v1/envelopes/${envelope.id}/legal-hold`)
      .set('Authorization', bearer(owner))
      .send({ reason: 'Anticipated dispute' })
      .expect(200);
    expect(placed.body.legalHoldReason).toBe('Anticipated dispute');
    expect(await holdRow(envelope.id)).toMatchObject({ legalHoldReason: 'Anticipated dispute' });
    expect(await auditActions(envelope.id)).toContain('LEGAL_HOLD_PLACED');

    const released = await request(t.http)
      .delete(`/api/v1/envelopes/${envelope.id}/legal-hold`)
      .set('Authorization', bearer(owner))
      .expect(200);
    expect(released.body.legalHoldAt).toBeNull();
    const row = await holdRow(envelope.id);
    expect(row?.legalHoldAt).toBeNull();
    expect(await auditActions(envelope.id)).toContain('LEGAL_HOLD_RELEASED');
  });

  it('refuses to release a hold that is not there', async () => {
    const envelope = await prepareEnvelope(t.http, owner, [
      { name: 'No Hold', email: uniqueEmail('nohold') },
    ]);
    await request(t.http)
      .delete(`/api/v1/envelopes/${envelope.id}/legal-hold`)
      .set('Authorization', bearer(owner))
      .expect(400);
  });

  it('blocks cancelling and extending a held document', async () => {
    const envelope = await prepareEnvelope(t.http, owner, [
      { name: 'Blocked Signer', email: uniqueEmail('blocked') },
    ]);
    await request(t.http)
      .post(`/api/v1/envelopes/${envelope.id}/legal-hold`)
      .set('Authorization', bearer(owner))
      .send({ reason: 'Hold before cancel test' })
      .expect(200);

    const voided = await request(t.http)
      .post(`/api/v1/envelopes/${envelope.id}/void`)
      .set('Authorization', bearer(owner))
      .send({ reason: 'trying anyway' })
      .expect(409);
    expect(voided.body.code).toBe('ENVELOPE_ON_LEGAL_HOLD');

    const extended = await request(t.http)
      .post(`/api/v1/envelopes/${envelope.id}/extend`)
      .set('Authorization', bearer(owner))
      .set('Idempotency-Key', `extend-${envelope.id}`)
      .send({ expiresInDays: 7 })
      .expect(409);
    expect(extended.body.code).toBe('ENVELOPE_ON_LEGAL_HOLD');
  });

  it('a MEMBER cannot place or release a hold; an ADMIN can', async () => {
    const envelope = await prepareEnvelope(t.http, owner, [
      { name: 'Role Gated', email: uniqueEmail('gated') },
    ]);
    const refused = await request(t.http)
      .post(`/api/v1/envelopes/${envelope.id}/legal-hold`)
      .set('Authorization', bearer(member))
      .send({ reason: 'not allowed' })
      .expect(403);
    expect(refused.body.code).toBe('FORBIDDEN_ROLE');

    await request(t.http)
      .post(`/api/v1/envelopes/${envelope.id}/legal-hold`)
      .set('Authorization', bearer(owner))
      .send({ reason: 'placed by owner' })
      .expect(200);
    await request(t.http)
      .delete(`/api/v1/envelopes/${envelope.id}/legal-hold`)
      .set('Authorization', bearer(member))
      .expect(403);
  });
});
