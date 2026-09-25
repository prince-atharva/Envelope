import { createHash, randomUUID } from 'node:crypto';
import type { EnvelopeDetail, EnvelopeListResponse } from '@envelope/shared';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../src/audit/audit.service';
import { sha256Hex } from '../src/uploads/pdf-validator.service';
import {
  inspectPdf,
  makeActivePdf,
  makeBlankPdf,
  makeEncryptedPdf,
  makePdf,
} from './fixtures/pdfs';
import { captureLogs, createTestApp, type TestApp } from './helpers/app';
import { registerUser, type SignedInUser } from './helpers/auth';
import { appRoleQuery, ownerQuery, truncateAll } from './helpers/db';
import { readStoredObject } from './helpers/storage';

/** Collects a binary response body into a Buffer. */
function binary(res: Response, done: (error: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
}

describe('envelopes (e2e)', () => {
  let t: TestApp;
  let owner: SignedInUser;
  let outsider: SignedInUser;
  let twelvePages: Buffer;
  const logs = captureLogs();

  const auth = (user: SignedInUser) => `Bearer ${user.accessToken}`;
  const upload = (user: SignedInUser, bytes: Buffer, filename = 'document.pdf') =>
    request(t.http)
      .post('/api/v1/envelopes')
      .set('Authorization', auth(user))
      .attach('file', bytes, { filename, contentType: 'application/pdf' });

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    owner = await registerUser(t.http, { organization: 'Owner Clinic' });
    outsider = await registerUser(t.http, { organization: 'Another Clinic' });
    twelvePages = await makePdf(12);
  });

  afterAll(async () => {
    await t.close();
    logs.restore();
  });

  beforeEach(() => logs.clear());

  describe('upload', () => {
    let created: EnvelopeDetail;

    it('stores a 12-page PDF untouched as version 0 and records who uploaded it', async () => {
      const res = await upload(owner, twelvePages, 'Consent Form March.pdf').expect(201);
      created = res.body as EnvelopeDetail;
      const sha256 = sha256Hex(twelvePages);

      expect(created).toMatchObject({
        title: 'Consent Form March',
        status: 'DRAFT',
        originalFilename: 'Consent Form March.pdf',
        pageCount: 12,
        originalHash: sha256,
        finalHash: null,
        owner: { id: owner.body.user.id, fullName: 'Test Sender' },
        versions: [
          {
            versionNumber: 0,
            sha256,
            pageCount: 12,
            sizeBytes: twelvePages.length,
            isFinal: false,
          },
        ],
        auditTrail: [
          {
            sequence: 1,
            action: 'ENVELOPE_CREATED',
            actorUserId: owner.body.user.id,
            recipientId: null,
          },
        ],
      });

      // Stored under a random key, never the uploaded name, and byte-for-byte identical.
      const row = await ownerQuery<{ originalFileUrl: string; tenantId: string }>(
        'SELECT "originalFileUrl", "tenantId" FROM "Envelope" WHERE id = $1',
        [created.id],
      );
      const key = row.rows[0]?.originalFileUrl ?? '';
      expect(key).toMatch(
        new RegExp(
          `^tenants/${owner.body.user.tenant.id}/envelopes/${created.id}/v0-[0-9a-f-]{36}\\.pdf$`,
        ),
      );
      expect((await readStoredObject(key)).equals(twelvePages)).toBe(true);

      expect(await t.app.get(AuditService).verify(created.id)).toEqual({ valid: true, events: 1 });

      for (const message of [
        'PDF accepted',
        'Stored object',
        'Audit event recorded',
        'Envelope created',
      ]) {
        expect(logs.find(message, 'info'), message).toHaveLength(1);
      }
      expect(logs.find('Envelope created')[0]?.fields).toMatchObject({
        envelopeId: created.id,
        pageCount: 12,
        sha256,
      });
      // Titles and file names can contain patient data and are never logged.
      expect(logs.text()).not.toContain('Consent Form');
    });

    it('serves the document back with the same SHA-256, cacheable by its ETag', async () => {
      const res = await request(t.http)
        .get(`/api/v1/envelopes/${created.id}/file`)
        .set('Authorization', auth(owner))
        .buffer(true)
        .parse(binary)
        .expect(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toContain(
        'inline; filename="Consent Form March.pdf"',
      );
      expect(sha256Hex(res.body as Buffer)).toBe(created.originalHash);
      expect(logs.find('Document opened', 'info')).toHaveLength(1);
      // Immutable once created (ADR 0003): safe to cache for a long time,
      // but `private` since the route is still authorized per tenant.
      expect(res.headers['cache-control']).toBe('private, max-age=31536000, immutable');
      expect(res.headers.etag).toBe(`"${created.originalHash}"`);
    });

    it('answers a matching If-None-Match with 304 and no body, and never opens the file', async () => {
      // The suite-wide `logs` capture (declared once, above): a second,
      // local captureLogs()/.restore() here would spy on and then restore
      // the same shared PinoLogger.prototype methods, breaking the outer
      // capture for every test that runs after this one.
      const before = logs.find('Document opened', 'info').length;
      await request(t.http)
        .get(`/api/v1/envelopes/${created.id}/file`)
        .set('Authorization', auth(owner))
        .set('If-None-Match', `"${created.originalHash}"`)
        .expect(304)
        .expect((res) => {
          if (res.text) throw new Error(`expected no body, got ${res.text.length} bytes`);
        });
      expect(logs.find('Document opened', 'info')).toHaveLength(before);
    });

    it('uses the title field and keeps non-ASCII file names intact', async () => {
      const res = await request(t.http)
        .post('/api/v1/envelopes')
        .set('Authorization', auth(owner))
        .field('title', '  Referral letter ')
        .attach('file', await makePdf(1), {
          filename: 'Überweisung – Patientin.pdf',
          contentType: 'application/pdf',
        })
        .expect(201);
      expect(res.body).toMatchObject({
        title: 'Referral letter',
        originalFilename: 'Überweisung – Patientin.pdf',
      });
    });

    it('removes active content before storing, and records what was removed', async () => {
      const active = await makeActivePdf();
      const res = await upload(owner, active, 'active.pdf').expect(201);
      const envelope = res.body as EnvelopeDetail;
      expect(envelope.originalHash).not.toBe(sha256Hex(active));

      const row = await ownerQuery<{ originalFileUrl: string }>(
        'SELECT "originalFileUrl" FROM "Envelope" WHERE id = $1',
        [envelope.id],
      );
      const stored = await readStoredObject(row.rows[0]?.originalFileUrl ?? '');
      expect(sha256Hex(stored)).toBe(envelope.originalHash);
      expect((await inspectPdf(stored)).findings).toEqual([]);

      const audit = await ownerQuery<{ metadata: Record<string, unknown> }>(
        'SELECT metadata FROM "AuditTrail" WHERE "envelopeId" = $1',
        [envelope.id],
      );
      expect(audit.rows[0]?.metadata).toMatchObject({
        sanitized: true,
        removedActiveContent: expect.arrayContaining(['javascript', 'embedded-files']),
        upload: { sha256: sha256Hex(active), sizeBytes: active.length },
      });
      expect(logs.find('Removed active content from PDF', 'info')).toHaveLength(1);
    });

    it.each([
      ['a text file', async () => Buffer.from('just text'), 415, 'UNSUPPORTED_FILE_TYPE'],
      ['a password-protected PDF', makeEncryptedPdf, 422, 'ENCRYPTED_PDF'],
      ['a 501-page PDF', () => makeBlankPdf(501), 422, 'PAGE_LIMIT_EXCEEDED'],
    ])('rejects %s without storing anything', async (_label, build, status, code) => {
      const before = await ownerQuery<{ count: string }>('SELECT count(*) FROM "Envelope"');
      const res = await upload(owner, await build()).expect(status);
      expect(res.body).toMatchObject({ code });
      expect(logs.find('PDF rejected', 'warn')[0]?.fields).toMatchObject({ errorCode: code });
      const after = await ownerQuery<{ count: string }>('SELECT count(*) FROM "Envelope"');
      expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
      expect(logs.find('Stored object')).toHaveLength(0);
    });

    it('requires a file in the "file" field', async () => {
      const missing = await request(t.http)
        .post('/api/v1/envelopes')
        .set('Authorization', auth(owner))
        .field('title', 'No file')
        .expect(400);
      expect(missing.body).toMatchObject({ code: 'FILE_REQUIRED' });

      const wrongField = await request(t.http)
        .post('/api/v1/envelopes')
        .set('Authorization', auth(owner))
        .attach('document', twelvePages, 'x.pdf')
        .expect(400);
      expect(wrongField.body).toMatchObject({ code: 'FILE_REQUIRED' });
    });

    it('rejects files over 25 MB', async () => {
      const oversized = Buffer.alloc(26 * 1024 * 1024);
      oversized.write('%PDF-1.7');
      const res = await upload(owner, oversized).expect(413);
      expect(res.body).toMatchObject({ code: 'FILE_TOO_LARGE' });
    });

    it('requires authentication', async () => {
      await request(t.http)
        .post('/api/v1/envelopes')
        .attach('file', twelvePages, 'x.pdf')
        .expect(401);
    });

    it('limits each tenant to 20 uploads per minute', async () => {
      const busy = await registerUser(t.http);
      const small = await makePdf(1);
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 21; attempt += 1) {
        statuses.push((await upload(busy, small)).status);
      }
      expect(statuses).toEqual([...Array(20).fill(201), 429]);
      expect(logs.find('Tenant upload rate limit exceeded', 'warn')).toHaveLength(1);

      // Another tenant is unaffected.
      await upload(outsider, small).expect(201);
    });
  });

  describe('reading', () => {
    it('lists newest first, one page at a time', async () => {
      const lister = await registerUser(t.http);
      const titles = ['first', 'second', 'third'];
      for (const title of titles) {
        await upload(lister, await makePdf(1), `${title}.pdf`).expect(201);
      }

      const page1 = await request(t.http)
        .get('/api/v1/envelopes?limit=2')
        .set('Authorization', auth(lister))
        .expect(200);
      const first = page1.body as EnvelopeListResponse;
      expect(first.items.map((item) => item.title)).toEqual(['third', 'second']);
      expect(first.nextCursor).toEqual(expect.any(String));

      const page2 = await request(t.http)
        .get(`/api/v1/envelopes?limit=2&cursor=${first.nextCursor}`)
        .set('Authorization', auth(lister))
        .expect(200);
      const second = page2.body as EnvelopeListResponse;
      expect(second.items.map((item) => item.title)).toEqual(['first']);
      expect(second.nextCursor).toBeNull();

      await request(t.http)
        .get('/api/v1/envelopes?cursor=not-a-cursor')
        .set('Authorization', auth(lister))
        .expect(400);
    });

    it('never shows one tenant another tenant’s envelopes', async () => {
      const mine = ((await upload(owner, await makePdf(1))).body as EnvelopeDetail).id;

      const list = await request(t.http)
        .get('/api/v1/envelopes?limit=100')
        .set('Authorization', auth(outsider))
        .expect(200);
      expect((list.body as EnvelopeListResponse).items.map((item) => item.id)).not.toContain(mine);

      const foreign = await request(t.http)
        .get(`/api/v1/envelopes/${mine}`)
        .set('Authorization', auth(outsider))
        .expect(404);
      const missing = await request(t.http)
        .get(`/api/v1/envelopes/${randomUUID()}`)
        .set('Authorization', auth(outsider))
        .expect(404);
      // Indistinguishable from an id that does not exist.
      expect({ ...foreign.body, instance: null, requestId: null }).toEqual({
        ...missing.body,
        instance: null,
        requestId: null,
      });

      await request(t.http)
        .get(`/api/v1/envelopes/${mine}/file`)
        .set('Authorization', auth(outsider))
        .expect(404);
    });

    it('answers malformed ids and unknown versions with 404', async () => {
      await request(t.http)
        .get('/api/v1/envelopes/not-a-uuid')
        .set('Authorization', auth(owner))
        .expect(404);
      const mine = ((await upload(owner, await makePdf(1))).body as EnvelopeDetail).id;
      await request(t.http)
        .get(`/api/v1/envelopes/${mine}/file?version=7`)
        .set('Authorization', auth(owner))
        .expect(404);
    });
  });

  describe('audit events and detail caching (100M-row scale follow-up)', () => {
    /**
     * Fills out sequence 2..upTo with synthetic events (1 already exists:
     * ENVELOPE_CREATED from the upload), so the detail's 20-event cap and
     * /events pagination both have something to page past. Hashes only need
     * to satisfy the CHECK constraint's shape, not a real chain: nothing
     * here exercises chain verification.
     */
    async function fillAuditTrail(envelopeId: string, upTo: number): Promise<void> {
      for (let sequence = 2; sequence <= upTo; sequence += 1) {
        const hash = createHash('sha256').update(`${envelopeId}:${sequence}`).digest('hex');
        const prevHash = createHash('sha256')
          .update(`${envelopeId}:${sequence - 1}`)
          .digest('hex');
        await ownerQuery(
          `INSERT INTO "AuditTrail"
             (id, "envelopeId", action, "ipAddress", "userAgent", sequence, "prevHash", "eventHash", timestamp)
           VALUES ($1, $2, 'REMINDER_SCHEDULED', 'system', 'system', $3, $4, $5, now())`,
          [randomUUID(), envelopeId, sequence, prevHash, hash],
        );
      }
    }

    /** Same encoding GET /envelopes/:id/events uses (envelopes.service.ts). */
    const cursorFor = (sequence: number) => Buffer.from(String(sequence)).toString('base64url');

    it('caps the detail at 20 events but reports the true total, and pages the rest oldest-first', async () => {
      const envelope = ((await upload(owner, await makePdf(1))).body as EnvelopeDetail).id;
      await fillAuditTrail(envelope, 24);

      const detail = await request(t.http)
        .get(`/api/v1/envelopes/${envelope}`)
        .set('Authorization', auth(owner))
        .expect(200);
      const body = detail.body as EnvelopeDetail;
      expect(body.auditTrail).toHaveLength(20);
      expect(body.auditTrail.map((e) => e.sequence)).toEqual(
        Array.from({ length: 20 }, (_, i) => i + 1),
      );
      expect(body.auditEventCount).toBe(24);

      const page1 = await request(t.http)
        .get(`/api/v1/envelopes/${envelope}/events?limit=3&cursor=${cursorFor(20)}`)
        .set('Authorization', auth(owner))
        .expect(200);
      expect(page1.body.items.map((e: { sequence: number }) => e.sequence)).toEqual([21, 22, 23]);
      expect(page1.body.nextCursor).toEqual(expect.any(String));

      const page2 = await request(t.http)
        .get(`/api/v1/envelopes/${envelope}/events?limit=3&cursor=${page1.body.nextCursor}`)
        .set('Authorization', auth(owner))
        .expect(200);
      expect(page2.body.items.map((e: { sequence: number }) => e.sequence)).toEqual([24]);
      expect(page2.body.nextCursor).toBeNull();

      // Continuing from the very start (no cursor) walks the whole trail.
      const fromStart = await request(t.http)
        .get(`/api/v1/envelopes/${envelope}/events?limit=100`)
        .set('Authorization', auth(owner))
        .expect(200);
      expect(fromStart.body.items).toHaveLength(24);

      await request(t.http)
        .get(`/api/v1/envelopes/${randomUUID()}/events`)
        .set('Authorization', auth(owner))
        .expect(404);
      await request(t.http)
        .get(`/api/v1/envelopes/${envelope}/events`)
        .set('Authorization', auth(outsider))
        .expect(404);
    });

    it('answers a matching If-None-Match with 304, and a fresh audit event busts it', async () => {
      const envelope = ((await upload(owner, await makePdf(1))).body as EnvelopeDetail).id;

      const first = await request(t.http)
        .get(`/api/v1/envelopes/${envelope}`)
        .set('Authorization', auth(owner))
        .expect(200);
      const etag = first.headers.etag as string;
      expect(etag).toEqual(expect.any(String));
      expect(first.headers['cache-control']).toBe('private, no-cache');

      await request(t.http)
        .get(`/api/v1/envelopes/${envelope}`)
        .set('Authorization', auth(owner))
        .set('If-None-Match', etag)
        .expect(304)
        .expect((res) => {
          if (res.text) throw new Error(`expected no body, got ${res.text.length} bytes`);
        });

      // A new audit event changes the ETag even though nothing here touches
      // the envelope row itself: every mutation in this codebase records
      // one (e.g. a recipient viewing their link), so the audit trail's own
      // sequence is what the ETag actually leans on, not just updatedAt.
      await fillAuditTrail(envelope, 2);
      const second = await request(t.http)
        .get(`/api/v1/envelopes/${envelope}`)
        .set('Authorization', auth(owner))
        .set('If-None-Match', etag)
        .expect(200);
      expect(second.headers.etag).not.toBe(etag);
    });
  });

  describe('audit trail protection (docs/05, invariant 5)', () => {
    it('the application role cannot change or delete audit history', async () => {
      const envelope = ((await upload(owner, await makePdf(1))).body as EnvelopeDetail).id;

      await expect(
        appRoleQuery(`UPDATE "AuditTrail" SET action = 'TAMPERED' WHERE "envelopeId" = $1`, [
          envelope,
        ]),
      ).rejects.toThrow(/permission denied for table AuditTrail/);
      await expect(
        appRoleQuery(`DELETE FROM "AuditTrail" WHERE "envelopeId" = $1`, [envelope]),
      ).rejects.toThrow(/permission denied for table AuditTrail/);
      await expect(appRoleQuery('TRUNCATE "AuditTrail"')).rejects.toThrow(/permission denied/);
      // Deleting the envelope would take its audit rows with it, so that is refused too.
      await expect(
        appRoleQuery(`DELETE FROM "Envelope" WHERE id = $1`, [envelope]),
      ).rejects.toThrow(/violates foreign key constraint "AuditTrail_envelopeId_fkey"/);

      expect(await t.app.get(AuditService).verify(envelope)).toEqual({ valid: true, events: 1 });
    });

    it('verification catches tampering done with owner privileges', async () => {
      const envelope = ((await upload(owner, await makePdf(1))).body as EnvelopeDetail).id;
      await ownerQuery(
        `UPDATE "AuditTrail" SET "ipAddress" = '198.51.100.99' WHERE "envelopeId" = $1`,
        [envelope],
      );
      logs.clear();
      const result = await t.app.get(AuditService).verify(envelope);
      expect(result).toMatchObject({
        valid: false,
        brokenAt: { sequence: 1, reason: 'hash mismatch' },
      });
      expect(logs.find('Audit chain verification failed', 'error')[0]?.fields).toMatchObject({
        alert: true,
        envelopeId: envelope,
      });
    });
  });
});
