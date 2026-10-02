import { randomUUID } from 'node:crypto';
import type { ReportSummary } from '@envelope/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, createTestWorker, type TestApp, type TestWorker } from './helpers/app';
import { registerUser, type SignedInUser } from './helpers/auth';
import { ownerQuery, truncateAll } from './helpers/db';
import { bearer } from './helpers/signing';
import { createApiKey, inviteUser } from './helpers/workspace';

interface SeedRecipient {
  role?: 'SIGNER' | 'APPROVER' | 'CC';
  status: 'PENDING' | 'SENT' | 'VIEWED' | 'SIGNED' | 'DECLINED' | 'DELEGATED';
  viewedAt?: string;
  consentGivenAt?: string;
  signedAt?: string;
}

/**
 * Workspace reports (docs/22 step 9): seeded rows with hand-computed answers, so a change to a
 * definition shows up as a changed number rather than a plausible-looking one.
 */
describe('reports (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;
  let other: SignedInUser;

  async function ids(user: SignedInUser): Promise<{ tenantId: string; ownerId: string }> {
    const { rows } = await ownerQuery<{ tenantId: string; ownerId: string }>(
      `SELECT "tenantId", id AS "ownerId" FROM "User" WHERE email = $1`,
      [user.email],
    );
    const row = rows[0];
    if (!row) throw new Error('no user row');
    return row;
  }

  async function seed(
    who: { tenantId: string; ownerId: string },
    envelope: {
      status: string;
      sentAt: string | null;
      completedAt?: string;
      recipients?: SeedRecipient[];
    },
  ): Promise<void> {
    const id = randomUUID();
    await ownerQuery(
      `INSERT INTO "Envelope" (id, "tenantId", "ownerId", title, status, "originalFileUrl",
         "originalFilename", "pageCount", "originalHash", "sentAt", "completedAt",
         "finalHash", "completedFileUrl", "voidedAt", "voidReason", "expiredAt", "updatedAt")
       VALUES ($1, $2, $3, 'Seeded', $4::"EnvelopeStatus", 'k', 'a.pdf', 1, $5, $6, $7, $8, $9,
         $10, $11, $12, now())`,
      [
        id,
        who.tenantId,
        who.ownerId,
        envelope.status,
        'a'.repeat(64),
        envelope.sentAt,
        // The table refuses a COMPLETED envelope without its seal, a VOIDED or EXPIRED one without its time.
        envelope.completedAt ?? (envelope.status === 'COMPLETED' ? envelope.sentAt : null),
        envelope.status === 'COMPLETED' ? 'b'.repeat(64) : null,
        envelope.status === 'COMPLETED' ? 'sealed-key' : null,
        envelope.status === 'VOIDED' ? envelope.sentAt : null,
        envelope.status === 'VOIDED' ? 'Seeded' : null,
        envelope.status === 'EXPIRED' ? envelope.sentAt : null,
      ],
    );
    for (const [index, r] of (envelope.recipients ?? []).entries()) {
      await ownerQuery(
        `INSERT INTO "Recipient" (id, "envelopeId", name, email, role, status, "viewedAt",
           "consentGivenAt", "consentText", "signedAt", "tokenUsedAt", "declinedAt",
           "declinedReason")
         VALUES ($1, $2, 'Seeded', $3, $4::"RecipientRole", $5::"RecipientStatus", $6, $7, $8, $9,
           $10, $11, $12)`,
        [
          randomUUID(),
          id,
          `r${index}-${id}@example.test`,
          r.role ?? 'SIGNER',
          r.status,
          r.viewedAt ?? null,
          r.consentGivenAt ?? null,
          // The table requires the wording whenever consent is recorded.
          r.consentGivenAt ? 'I agree' : null,
          r.signedAt ?? null,
          // The table requires evidence for a finished recipient: a spent link, or a reason.
          r.status === 'SIGNED' ? (r.signedAt ?? null) : null,
          r.status === 'DECLINED' ? '2026-09-12T10:00:00Z' : null,
          r.status === 'DECLINED' ? 'Seeded' : null,
        ],
      );
    }
  }

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    worker = await createTestWorker();
    owner = await registerUser(t.http, { fullName: 'Report Owner', organization: 'Report Clinic' });
    other = await registerUser(t.http, { fullName: 'Other Owner', organization: 'Other Clinic' });
    const mine = await ids(owner);
    const theirs = await ids(other);

    const seen = { viewedAt: '2026-09-10T08:30:00Z', consentGivenAt: '2026-09-10T08:35:00Z' };
    // Completed after 4 hours; the signer signed 1 hour after sending.
    await seed(mine, {
      status: 'COMPLETED',
      sentAt: '2026-09-10T08:00:00Z',
      completedAt: '2026-09-10T12:00:00Z',
      recipients: [{ status: 'SIGNED', ...seen, signedAt: '2026-09-10T09:00:00Z' }],
    });
    // Completed after 48 hours; the signer signed 6 hours after sending.
    await seed(mine, {
      status: 'COMPLETED',
      sentAt: '2026-09-10T10:00:00Z',
      completedAt: '2026-09-12T10:00:00Z',
      recipients: [{ status: 'SIGNED', ...seen, signedAt: '2026-09-10T16:00:00Z' }],
    });
    await seed(mine, {
      status: 'SENT',
      sentAt: '2026-09-11T09:00:00Z',
      recipients: [{ status: 'SENT' }],
    });
    await seed(mine, {
      status: 'DECLINED',
      sentAt: '2026-09-15T09:00:00Z',
      recipients: [{ status: 'DECLINED', ...seen }],
    });
    await seed(mine, {
      status: 'VOIDED',
      sentAt: '2026-09-16T09:00:00Z',
      recipients: [{ status: 'VIEWED', viewedAt: '2026-09-16T10:00:00Z' }],
    });
    await seed(mine, {
      status: 'EXPIRED',
      sentAt: '2026-09-20T09:00:00Z',
      recipients: [{ status: 'VIEWED', ...seen }],
    });
    // A passed-on part: the delegator's row is history and must not count as someone who dropped off.
    await seed(mine, {
      status: 'PARTIALLY_SIGNED',
      sentAt: '2026-09-25T09:00:00Z',
      recipients: [{ status: 'DELEGATED' }, { status: 'SENT' }, { role: 'CC', status: 'SENT' }],
    });
    // Outside the window, never sent, and another workspace's.
    await seed(mine, { status: 'COMPLETED', sentAt: '2026-08-31T23:59:59Z' });
    await seed(mine, { status: 'COMPLETED', sentAt: '2026-10-01T00:00:00Z' });
    await seed(mine, { status: 'DRAFT', sentAt: null });
    await seed(theirs, {
      status: 'COMPLETED',
      sentAt: '2026-09-10T08:00:00Z',
      completedAt: '2026-09-10T09:00:00Z',
    });
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
  });

  const summary = (user: SignedInUser, query: string) =>
    request(t.http).get(`/api/v1/reports/summary${query}`).set('Authorization', bearer(user));

  it('matches the numbers worked out by hand', async () => {
    const res = await summary(owner, '?from=2026-09-01&to=2026-09-30').expect(200);
    const body = res.body as ReportSummary;

    expect(body).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-30',
      sent: 7,
      completed: 2,
      declined: 1,
      cancelled: 1,
      expired: 1,
      open: 2,
    });
    expect(body.completionRate).toBeCloseTo(2 / 7, 10);
    // 1 h and 6 h: the median is 3.5 h, the 90th percentile 5.5 h.
    expect(body.timeToFirstSignature).toEqual({
      medianSeconds: 12_600,
      p90Seconds: 19_800,
      samples: 2,
    });
    // 4 h and 48 h: the median is 26 h.
    expect(body.timeToComplete).toEqual({ medianSeconds: 93_600, p90Seconds: null, samples: 2 });
    expect(body.dropOff).toEqual({ invited: 7, opened: 5, consented: 4, signed: 2, declined: 1 });
  });

  it('gives one entry per day, including days with nothing sent', async () => {
    const body = (await summary(owner, '?from=2026-09-01&to=2026-09-30').expect(200))
      .body as ReportSummary;
    expect(body.daily).toHaveLength(30);
    const sent = Object.fromEntries(
      body.daily.filter((d) => d.sent > 0).map((d) => [d.date, d.sent]),
    );
    expect(sent).toEqual({
      '2026-09-10': 2,
      '2026-09-11': 1,
      '2026-09-15': 1,
      '2026-09-16': 1,
      '2026-09-20': 1,
      '2026-09-25': 1,
    });
    expect(body.daily[0]).toEqual({ date: '2026-09-01', sent: 0 });
  });

  it('includes both end days and nothing outside them', async () => {
    const edge = (await summary(owner, '?from=2026-08-31&to=2026-08-31').expect(200))
      .body as ReportSummary;
    expect(edge.sent).toBe(1);
    const next = (await summary(owner, '?from=2026-10-01&to=2026-10-01').expect(200))
      .body as ReportSummary;
    expect(next.sent).toBe(1);
  });

  it('reports zeros, not errors, for a window with nothing in it', async () => {
    const body = (await summary(owner, '?from=2025-01-01&to=2025-01-07').expect(200))
      .body as ReportSummary;
    expect(body).toMatchObject({ sent: 0, completionRate: null });
    expect(body.timeToFirstSignature).toEqual({
      medianSeconds: null,
      p90Seconds: null,
      samples: 0,
    });
    expect(body.dropOff.invited).toBe(0);
  });

  it("counts only the caller's own workspace", async () => {
    const theirs = (await summary(other, '?from=2026-09-01&to=2026-09-30').expect(200))
      .body as ReportSummary;
    expect(theirs).toMatchObject({ sent: 1, completed: 1, open: 0 });
  });

  it('refuses a window of 367 days, a reversed one and a malformed day', async () => {
    await summary(owner, '?from=2025-10-01&to=2026-10-01').expect(200);
    await summary(owner, '?from=2025-09-30&to=2026-10-01').expect(400);
    await summary(owner, '?from=2026-09-30&to=2026-09-01').expect(400);
    await summary(owner, '?from=yesterday').expect(400);
    await summary(owner, '?tenantId=00000000-0000-0000-0000-000000000000').expect(400);
  });

  it('defaults to the last 30 days', async () => {
    const body = (await summary(owner, '').expect(200)).body as ReportSummary;
    expect(body.daily).toHaveLength(30);
  });

  it('is for Admins and Owners only, and closed to API keys and anonymous callers', async () => {
    const admin = await inviteUser(t.http, worker, owner, 'ADMIN');
    const member = await inviteUser(t.http, worker, owner, 'MEMBER');
    await summary(admin, '').expect(200);
    await summary(member, '').expect(403);
    const key = await createApiKey(t.http, owner);
    await request(t.http)
      .get('/api/v1/reports/summary')
      .set('Authorization', key.authorization)
      .expect(403);
    await request(t.http).get('/api/v1/reports/summary').expect(401);
  });
});
