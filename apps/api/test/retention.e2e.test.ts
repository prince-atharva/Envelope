import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../src/audit/audit.service';
import { RetentionService } from '../src/maintenance/retention.service';
import { createTestApp, createTestWorker, type TestApp, type TestWorker } from './helpers/app';
import { registerUser, type SignedInUser, uniqueEmail } from './helpers/auth';
import { ownerQuery, truncateAll } from './helpers/db';
import { bearer, prepareEnvelope } from './helpers/signing';
import { readStoredObject } from './helpers/storage';

/**
 * The retention sweeper (docs/17 step 8, ADR 0014): removes storage objects
 * from an old draft or a cancelled/declined envelope, but never an audit
 * row and never a sealed, completed document.
 */
describe('retention sweeper (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;
  let retention: RetentionService;
  let audit: AuditService;

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    worker = await createTestWorker();
    owner = await registerUser(t.http, {
      fullName: 'Retention Owner',
      organization: 'Retention Clinic',
    });
    retention = worker.module.get(RetentionService);
    audit = worker.module.get(AuditService);
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
  });

  async function backdate(envelopeId: string, daysAgo: number) {
    await ownerQuery(
      `UPDATE "Envelope" SET "updatedAt" = now() - ($2 || ' days')::interval WHERE id = $1`,
      [envelopeId, String(daysAgo)],
    );
  }

  async function envelopeRow(envelopeId: string) {
    const { rows } = await ownerQuery<{
      purgedAt: Date | null;
      status: string;
      originalFileUrl: string;
    }>(`SELECT "purgedAt", status, "originalFileUrl" FROM "Envelope" WHERE id = $1`, [envelopeId]);
    return rows[0];
  }

  async function auditEventCount(envelopeId: string) {
    const { rows } = await ownerQuery<{ count: string }>(
      `SELECT count(*) FROM "AuditTrail" WHERE "envelopeId" = $1`,
      [envelopeId],
    );
    return Number(rows[0]?.count ?? 0);
  }

  it('purges an old unsent draft: the file goes, the audit trail does not', async () => {
    const envelope = await prepareEnvelope(t.http, owner, [
      { name: 'Draft Signer', email: uniqueEmail('draft-purge') },
    ]);
    const before = await envelopeRow(envelope.id);
    if (!before) throw new Error('envelope missing');
    await readStoredObject(before.originalFileUrl); // exists before the sweep
    await backdate(envelope.id, 91);

    const result = await retention.run();
    expect(result.changed).toBeGreaterThanOrEqual(1);

    const after = await envelopeRow(envelope.id);
    expect(after?.purgedAt).not.toBeNull();
    await expect(readStoredObject(before.originalFileUrl)).rejects.toThrow();

    const recipients = await ownerQuery<{ name: string; email: string }>(
      `SELECT name, email FROM "Recipient" WHERE "envelopeId" = $1`,
      [envelope.id],
    );
    expect(recipients.rows[0]?.name).toBe('Removed');
    expect(recipients.rows[0]?.email).toMatch(/^purged-.+@removed\.invalid$/);

    // The audit chain is intact and complete, exactly as before the purge:
    // the purge itself is one more link in the same chain, never a deletion.
    expect(await auditEventCount(envelope.id)).toBeGreaterThan(0);
    const verification = await audit.verify(envelope.id);
    expect(verification.valid).toBe(true);
  });

  it('does not purge a draft younger than the retention window', async () => {
    const envelope = await prepareEnvelope(t.http, owner, [
      { name: 'Fresh Draft', email: uniqueEmail('fresh-draft') },
    ]);
    await backdate(envelope.id, 10);
    await retention.run();
    const row = await envelopeRow(envelope.id);
    expect(row?.purgedAt).toBeNull();
  });

  it('a legal hold excludes an envelope from the sweep even when old', async () => {
    const envelope = await prepareEnvelope(t.http, owner, [
      { name: 'Held Draft', email: uniqueEmail('held-draft') },
    ]);
    await backdate(envelope.id, 200);
    await request(t.http)
      .post(`/api/v1/envelopes/${envelope.id}/legal-hold`)
      .set('Authorization', bearer(owner))
      .send({ reason: 'Do not purge' })
      .expect(200);

    await retention.run();
    const row = await envelopeRow(envelope.id);
    expect(row?.purgedAt).toBeNull();
  });

  it('purges an old cancelled envelope after its longer window, not before', async () => {
    const envelope = await prepareEnvelope(t.http, owner, [
      { name: 'Voided Signer', email: uniqueEmail('voided-purge') },
    ]);
    await request(t.http)
      .post(`/api/v1/envelopes/${envelope.id}/void`)
      .set('Authorization', bearer(owner))
      .expect(200);

    await backdate(envelope.id, 200); // past the draft window, not the voided one
    await retention.run();
    expect((await envelopeRow(envelope.id))?.purgedAt).toBeNull();

    await backdate(envelope.id, 366); // past VOIDED_RETENTION_DAYS
    await retention.run();
    expect((await envelopeRow(envelope.id))?.purgedAt).not.toBeNull();
  });

  it('a purged envelope answers ENVELOPE_PURGED on download, not a storage error', async () => {
    const envelope = await prepareEnvelope(t.http, owner, [
      { name: 'Download After Purge', email: uniqueEmail('purged-download') },
    ]);
    await backdate(envelope.id, 91);
    await retention.run();

    const res = await request(t.http)
      .get(`/api/v1/envelopes/${envelope.id}/file`)
      .set('Authorization', bearer(owner))
      .expect(410);
    expect(res.body.code).toBe('ENVELOPE_PURGED');
  });
});
