import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SessionCleanupService } from '../src/maintenance/session-cleanup.service';
import { createTestApp, createTestWorker, type TestApp, type TestWorker } from './helpers/app';
import { registerUser, type SignedInUser } from './helpers/auth';
import { ownerQuery, truncateAll } from './helpers/db';

const DAY = 24 * 3600 * 1000;

/**
 * Deletes refresh-token rows well past their expiry (docs/16 step 14). Never
 * deletes one a login, refresh or rotation still needs.
 */
describe('session cleanup (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let cleanup: SessionCleanupService;
  let owner: SignedInUser;

  /** Inserted directly: the login/refresh flow cannot backdate a session's expiry. */
  async function insertSession(expiresAt: Date): Promise<string> {
    const id = randomUUID();
    await ownerQuery(
      `INSERT INTO "Session" (id, "userId", "familyId", "tokenHash", "expiresAt", "createdAt")
       VALUES ($1, $2, $3, $4, $5, now())`,
      [id, owner.body.user.id, randomUUID(), `hash-${id}`, expiresAt.toISOString()],
    );
    return id;
  }

  async function sessionIds(): Promise<string[]> {
    const { rows } = await ownerQuery<{ id: string }>(
      `SELECT id FROM "Session" WHERE "userId" = $1 ORDER BY "createdAt"`,
      [owner.body.user.id],
    );
    return rows.map((row) => row.id);
  }

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    worker = await createTestWorker();
    cleanup = worker.module.get(SessionCleanupService);
    owner = await registerUser(t.http, { fullName: 'Session Cleanup Owner' });
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
  });

  it('deletes sessions expired well past retention, and leaves the rest', async () => {
    // registerUser already created one live session; this leaves it alone too.
    const wayExpired = await insertSession(new Date(Date.now() - 45 * DAY));
    const recentlyExpired = await insertSession(new Date(Date.now() - 5 * DAY));
    const stillValid = await insertSession(new Date(Date.now() + DAY));

    const result = await cleanup.run(new Date());
    expect(result.changed).toBe(1);
    expect(result.failed).toBe(0);

    const remaining = await sessionIds();
    expect(remaining).not.toContain(wayExpired);
    expect(remaining).toContain(recentlyExpired);
    expect(remaining).toContain(stillValid);

    // Nothing left to delete on a second run.
    expect((await cleanup.run(new Date())).changed).toBe(0);
  });
});
