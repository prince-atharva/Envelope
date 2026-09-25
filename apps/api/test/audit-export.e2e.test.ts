import { createHash } from 'node:crypto';
import type { AuditExportDocument, AuthResponse } from '@envelope/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalJson } from '../src/audit/audit-chain';
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
 * Audit export (docs/17 step 9, AUD-06): JSON is self-sufficient — anyone
 * with the file, and no access to this platform, can recompute the chain
 * themselves, with exactly the algorithm the export names.
 */
describe('audit export (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;
  let member: SignedInUser;

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    worker = await createTestWorker();
    owner = await registerUser(t.http, { fullName: 'Export Owner', organization: 'Export Clinic' });

    const email = uniqueEmail('export-member');
    await request(t.http)
      .post('/api/v1/users')
      .set('Authorization', bearer(owner))
      .send({ fullName: 'Export Member', email, role: 'MEMBER' })
      .expect(201);
    const message = await waitFor(() =>
      worker.mailbox.messages.filter((m) => m.to === email && m.template === 'user-invited').at(-1),
    );
    const token = INVITE_LINK.exec(message.text)?.[1];
    if (!token) throw new Error('no invite link');
    const accepted = await request(t.http)
      .post(`/api/v1/auth/invitations/${token}/accept`)
      .send({ password: 'an export member password' })
      .expect(200);
    const body = accepted.body as AuthResponse;
    member = {
      email,
      password: 'an export member password',
      accessToken: body.accessToken,
      cookie: '',
      body,
    };
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
  });

  it('re-verifies from the exported file alone, with no database access', async () => {
    const envelope = await prepareEnvelope(t.http, owner, [
      { name: 'Export Signer', email: uniqueEmail('export-signer') },
    ]);

    const res = await request(t.http)
      .get(`/api/v1/envelopes/${envelope.id}/audit`)
      .set('Authorization', bearer(owner))
      .expect(200);
    const doc = res.body as AuditExportDocument;

    expect(doc.envelopeId).toBe(envelope.id);
    expect(doc.verification).toEqual({ valid: true });
    expect(doc.events.length).toBeGreaterThan(0);

    // Recompute the chain exactly as documented, using nothing from this
    // codebase but the standard library — the whole point of the export.
    let previousHash: string | null = null;
    for (const event of doc.events) {
      expect(event.prevHash).toBe(previousHash);
      const payload = canonicalJson({
        envelopeId: doc.envelopeId,
        sequence: event.sequence,
        recipientId: event.recipientId,
        actorUserId: event.actorUserId,
        ipAddress: event.ipAddress,
        userAgent: event.userAgent,
        metadata: event.metadata ?? null,
      });
      const recomputed = createHash('sha256')
        .update([previousHash ?? '', event.action, event.timestamp, payload].join('|'))
        .digest('hex');
      expect(recomputed).toBe(event.eventHash);
      previousHash = event.eventHash;
    }
  });

  it('CSV carries the same events, without the hashes', async () => {
    const envelope = await prepareEnvelope(t.http, owner, [
      { name: 'CSV Signer', email: uniqueEmail('csv-signer') },
    ]);
    const res = await request(t.http)
      .get(`/api/v1/envelopes/${envelope.id}/audit?format=csv`)
      .set('Authorization', bearer(owner))
      .expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = (res.text as string).trim().split('\n');
    expect(lines[0]).toBe(
      'sequence,action,timestamp,actorUserId,recipientId,ipAddress,userAgent,metadata',
    );
    expect(lines.length).toBeGreaterThan(1);
    expect(res.text).not.toContain('eventHash');
  });

  it('a MEMBER cannot export; an ADMIN can', async () => {
    const envelope = await prepareEnvelope(t.http, owner, [
      { name: 'Gated Export', email: uniqueEmail('gated-export') },
    ]);
    const refused = await request(t.http)
      .get(`/api/v1/envelopes/${envelope.id}/audit`)
      .set('Authorization', bearer(member))
      .expect(403);
    expect(refused.body.code).toBe('FORBIDDEN_ROLE');

    await request(t.http)
      .patch(`/api/v1/users/${member.body.user.id}/role`)
      .set('Authorization', bearer(owner))
      .send({ role: 'ADMIN' })
      .expect(200);
    // The role travels in the access token, refreshed at login; this test
    // logs in again rather than waiting out the token's lifetime.
    const relogged = await request(t.http)
      .post('/api/v1/auth/login')
      .send({ email: member.email, password: member.password })
      .expect(200);
    await request(t.http)
      .get(`/api/v1/envelopes/${envelope.id}/audit`)
      .set('Authorization', `Bearer ${(relogged.body as AuthResponse).accessToken}`)
      .expect(200);
  });

  it('records the export itself in the audit trail', async () => {
    const envelope = await prepareEnvelope(t.http, owner, [
      { name: 'Recorded Export', email: uniqueEmail('recorded-export') },
    ]);
    await request(t.http)
      .get(`/api/v1/envelopes/${envelope.id}/audit`)
      .set('Authorization', bearer(owner))
      .expect(200);
    const { rows } = await ownerQuery<{ action: string }>(
      `SELECT action FROM "AuditTrail" WHERE "envelopeId" = $1 AND action = 'AUDIT_EXPORTED'`,
      [envelope.id],
    );
    expect(rows.length).toBe(1);
  });
});
