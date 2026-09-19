import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditChainCheckService } from '../src/maintenance/audit-chain-check.service';
import { RedisService } from '../src/redis/redis.service';
import { createTestApp, createTestWorker, type TestApp, type TestWorker } from './helpers/app';
import { registerUser, type SignedInUser } from './helpers/auth';
import { ownerQuery, truncateAll } from './helpers/db';
import { prepareEnvelope } from './helpers/signing';
import { TEST_ENV } from './test-env';

/** The nightly audit-chain check (docs/16 step 12, ADR 0004). */
describe('audit-chain check (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;
  let check: AuditChainCheckService;

  const alertEmails = () =>
    worker.mailbox.messages.filter(
      (m) => m.template === 'alert' && m.text.includes('Alert: chain-check-'),
    );

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    worker = await createTestWorker();
    const redis = worker.module.get(RedisService).client;
    const held = await redis.keys(`${TEST_ENV.QUEUE_PREFIX}:alert-gate:chain-check-*`);
    if (held.length > 0) await redis.del(...held);
    check = worker.module.get(AuditChainCheckService);
    owner = await registerUser(t.http, { fullName: 'Chain Owner' });
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
  });

  it('walks every envelope in batches and passes intact trails', async () => {
    await prepareEnvelope(t.http, owner, [{ name: 'Intact', email: 'intact@example.com' }]);
    // 150 more envelopes, straight in the table, so the walk takes two batches.
    const { rows } = await ownerQuery<{ tenantId: string; ownerId: string }>(
      `SELECT "tenantId", "ownerId" FROM "Envelope" LIMIT 1`,
    );
    const base = rows[0];
    for (let i = 0; i < 150; i += 1) {
      await ownerQuery(
        `INSERT INTO "Envelope" (id, "tenantId", "ownerId", title, "originalFileUrl",
           "originalFilename", "pageCount", "originalHash", "updatedAt")
         VALUES ($1, $2, $3, 'Batch', 'k', 'a.pdf', 1, $4, now())`,
        [randomUUID(), base?.tenantId, base?.ownerId, 'a'.repeat(64)],
      );
    }
    const result = await check.run();
    expect(result.scanned).toBe(151);
    expect(result.breaks).toEqual([]);
    expect(alertEmails()).toEqual([]);
  });

  it('finds an altered event and a missing status event, in one alert email', async () => {
    const altered = await prepareEnvelope(t.http, owner, [
      { name: 'Altered', email: 'altered@example.com' },
    ]);
    const cut = await prepareEnvelope(t.http, owner, [{ name: 'Cut', email: 'cut@example.com' }]);
    // Only the owner role can do this; the application's role cannot.
    await ownerQuery(
      `UPDATE "AuditTrail" SET "userAgent" = 'edited' WHERE "envelopeId" = $1 AND sequence = 1`,
      [altered.id],
    );
    await ownerQuery(
      `UPDATE "Envelope" SET status = 'EXPIRED', "sentAt" = now(), "expiresAt" = now(),
              "expiredAt" = now() WHERE id = $1`,
      [cut.id],
    );

    const result = await check.run();
    expect(result.breaks).toEqual(
      expect.arrayContaining([
        { envelopeId: altered.id, reason: 'hash mismatch', sequence: 1 },
        { envelopeId: cut.id, reason: 'missing ENVELOPE_EXPIRED', sequence: null },
      ]),
    );
    expect(result.broken).toBe(2);

    // A second run the same night is logged, but emails nobody again.
    await check.run();
    const emails = alertEmails();
    expect(emails).toHaveLength(1);
    expect(emails[0]?.text).toContain('broken: 2');
    expect(emails[0]?.text).toContain(altered.id);
    expect(emails[0]?.text).not.toContain('altered@example.com');
  });
});
