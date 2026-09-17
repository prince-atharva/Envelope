import { randomUUID } from 'node:crypto';
import type {
  EnvelopeDetail,
  FieldInfo,
  RecipientResponse,
  SaveFieldsResponse,
} from '@envelope/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../src/audit/audit.service';
import { makePdf } from './fixtures/pdfs';
import { captureLogs, createTestApp, type TestApp } from './helpers/app';
import { registerUser, type SignedInUser } from './helpers/auth';
import { appRoleQuery, ownerQuery, truncateAll } from './helpers/db';

/** A valid signature field, 150x40pt on an A4 page, near the top left. */
function aField(recipientId: string, overrides: Partial<FieldInfo> = {}): Record<string, unknown> {
  return {
    id: randomUUID(),
    recipientId,
    type: 'SIGNATURE',
    pageNumber: 1,
    required: true,
    ratioX: 0.1,
    ratioY: 0.2,
    ratioWidth: 0.25,
    ratioHeight: 0.05,
    ...overrides,
  };
}

describe('drafts (e2e)', () => {
  let t: TestApp;
  let owner: SignedInUser;
  let outsider: SignedInUser;
  const logs = captureLogs();

  const auth = (user: SignedInUser) => `Bearer ${user.accessToken}`;

  /**
   * A draft envelope, inserted straight into the database.
   *
   * This suite is about editing drafts, not uploading, and uploading one PDF per
   * test would hit the 20-per-minute-per-tenant upload limit. The upload path
   * itself is covered by envelopes.e2e.test.ts, and `uploadEnvelope` below still
   * exercises it where the audit chain has to start with a real upload.
   */
  async function newEnvelope(pages = 3): Promise<{ id: string; pageCount: number }> {
    const id = randomUUID();
    await ownerQuery(
      `INSERT INTO "Envelope"
         (id, "tenantId", "ownerId", title, status, "originalFileUrl", "originalFilename",
          "pageCount", "originalHash", "updatedAt")
       VALUES ($1, $2, $3, 'Draft under test', 'DRAFT', $4, 'contract.pdf', $5, $6, now())`,
      [
        id,
        owner.body.user.tenant.id,
        owner.body.user.id,
        `tenants/test/${id}.pdf`,
        pages,
        'a'.repeat(64),
      ],
    );
    return { id, pageCount: pages };
  }

  async function uploadEnvelope(pages = 3): Promise<EnvelopeDetail> {
    const res = await request(t.http)
      .post('/api/v1/envelopes')
      .set('Authorization', auth(owner))
      .attach('file', await makePdf(pages), {
        filename: 'contract.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    return res.body as EnvelopeDetail;
  }

  async function addRecipient(
    envelopeId: string,
    body: Record<string, unknown>,
    user = owner,
  ): Promise<RecipientResponse> {
    const res = await request(t.http)
      .post(`/api/v1/envelopes/${envelopeId}/recipients`)
      .set('Authorization', auth(user))
      .send(body)
      .expect(201);
    return res.body as RecipientResponse;
  }

  const saveFields = (envelopeId: string, fields: unknown[], user = owner) =>
    request(t.http)
      .put(`/api/v1/envelopes/${envelopeId}/fields`)
      .set('Authorization', auth(user))
      .send({ fields });

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    owner = await registerUser(t.http, { organization: 'Draft Clinic' });
    outsider = await registerUser(t.http, { organization: 'Other Clinic' });
  });

  afterAll(async () => {
    await t.close();
    logs.restore();
  });

  beforeEach(() => logs.clear());

  describe('recipients', () => {
    it('adds people, gives each a colour, and orders them for signing', async () => {
      const envelope = await newEnvelope();

      const first = await addRecipient(envelope.id, {
        name: 'Priya Sharma',
        email: 'priya@example.com',
      });
      const second = await addRecipient(envelope.id, {
        name: 'Raj Patel',
        email: 'RAJ@EXAMPLE.COM',
        role: 'APPROVER',
      });

      expect(first.recipient).toMatchObject({
        name: 'Priya Sharma',
        email: 'priya@example.com',
        role: 'SIGNER',
        status: 'PENDING',
        routingOrder: 1,
        colorIndex: 0,
      });
      // Emails are normalised, so the same person cannot be added twice by case.
      expect(second.recipient.email).toBe('raj@example.com');
      expect(second.recipient.routingOrder).toBe(2);
      expect(second.recipient.colorIndex).toBe(1);
      expect(second.draftRevision).toBeGreaterThan(first.draftRevision);
    });

    it('has no signing token until the envelope is sent', async () => {
      const envelope = await newEnvelope();
      const { recipient } = await addRecipient(envelope.id, {
        name: 'Token Free',
        email: 'token.free@example.com',
      });

      const rows = await ownerQuery<{ tokenHash: string | null; tokenExpiresAt: Date | null }>(
        'SELECT "tokenHash", "tokenExpiresAt" FROM "Recipient" WHERE id = $1',
        [recipient.id],
      );
      expect(rows.rows[0]).toEqual({ tokenHash: null, tokenExpiresAt: null });
    });

    it('refuses the same email twice on one envelope', async () => {
      const envelope = await newEnvelope();
      await addRecipient(envelope.id, { name: 'First', email: 'twice@example.com' });

      const res = await request(t.http)
        .post(`/api/v1/envelopes/${envelope.id}/recipients`)
        .set('Authorization', auth(owner))
        .send({ name: 'Second', email: 'twice@example.com' })
        .expect(409);
      expect(res.body.code).toBe('RECIPIENT_EMAIL_TAKEN');
    });

    it('reuses a freed colour when someone is removed', async () => {
      const envelope = await newEnvelope();
      const first = await addRecipient(envelope.id, { name: 'A', email: 'a@example.com' });
      await addRecipient(envelope.id, { name: 'B', email: 'b@example.com' });

      await request(t.http)
        .delete(`/api/v1/envelopes/${envelope.id}/recipients/${first.recipient.id}`)
        .set('Authorization', auth(owner))
        .expect(200);

      const third = await addRecipient(envelope.id, { name: 'C', email: 'c@example.com' });
      expect(third.recipient.colorIndex).toBe(0);
    });

    it('removes a person’s fields with them', async () => {
      const envelope = await newEnvelope();
      const { recipient } = await addRecipient(envelope.id, {
        name: 'Leaving',
        email: 'leaving@example.com',
      });
      await saveFields(envelope.id, [aField(recipient.id)]).expect(200);

      await request(t.http)
        .delete(`/api/v1/envelopes/${envelope.id}/recipients/${recipient.id}`)
        .set('Authorization', auth(owner))
        .expect(200);

      const after = await request(t.http)
        .get(`/api/v1/envelopes/${envelope.id}`)
        .set('Authorization', auth(owner))
        .expect(200);
      expect((after.body as EnvelopeDetail).fields).toHaveLength(0);
      expect((after.body as EnvelopeDetail).recipients).toHaveLength(0);
    });

    it('drops the fields of someone changed to a copy-only role', async () => {
      const envelope = await newEnvelope();
      const { recipient } = await addRecipient(envelope.id, {
        name: 'Demoted',
        email: 'demoted@example.com',
      });
      await saveFields(envelope.id, [aField(recipient.id)]).expect(200);

      const res = await request(t.http)
        .patch(`/api/v1/envelopes/${envelope.id}/recipients/${recipient.id}`)
        .set('Authorization', auth(owner))
        .send({ role: 'CC' })
        .expect(200);

      expect((res.body as RecipientResponse).fieldsRemoved).toBe(1);
      expect((res.body as RecipientResponse).recipient.role).toBe('CC');
    });

    it('answers an unknown recipient with 404', async () => {
      const envelope = await newEnvelope();
      await request(t.http)
        .patch(`/api/v1/envelopes/${envelope.id}/recipients/${randomUUID()}`)
        .set('Authorization', auth(owner))
        .send({ name: 'Nobody' })
        .expect(404);
    });
  });

  describe('envelope settings', () => {
    it('changes the title, message and signing order', async () => {
      const envelope = await newEnvelope();

      await request(t.http)
        .patch(`/api/v1/envelopes/${envelope.id}`)
        .set('Authorization', auth(owner))
        .send({ title: 'Consent form', message: 'Please sign by Friday.', sequentialSigning: true })
        .expect(200);

      const after = await request(t.http)
        .get(`/api/v1/envelopes/${envelope.id}`)
        .set('Authorization', auth(owner))
        .expect(200);
      expect(after.body).toMatchObject({
        title: 'Consent form',
        message: 'Please sign by Friday.',
        sequentialSigning: true,
      });
    });

    it('refuses an empty change', async () => {
      const envelope = await newEnvelope();
      await request(t.http)
        .patch(`/api/v1/envelopes/${envelope.id}`)
        .set('Authorization', auth(owner))
        .send({})
        .expect(400);
    });
  });

  describe('fields', () => {
    it('saves a layout, returns it, and reads it back unchanged', async () => {
      const envelope = await newEnvelope();
      const { recipient } = await addRecipient(envelope.id, {
        name: 'Signer',
        email: 'signer@example.com',
      });
      const field = aField(recipient.id, { pageNumber: 3 });

      const saved = await saveFields(envelope.id, [field]).expect(200);
      expect((saved.body as SaveFieldsResponse).fields).toHaveLength(1);
      expect((saved.body as SaveFieldsResponse).fields[0]).toMatchObject({
        id: field.id,
        pageNumber: 3,
        ratioX: 0.1,
        ratioWidth: 0.25,
      });

      const detail = await request(t.http)
        .get(`/api/v1/envelopes/${envelope.id}`)
        .set('Authorization', auth(owner))
        .expect(200);
      expect((detail.body as EnvelopeDetail).fields).toEqual(
        (saved.body as SaveFieldsResponse).fields,
      );
    });

    it('replaces the whole layout, so deletions stick', async () => {
      const envelope = await newEnvelope();
      const { recipient } = await addRecipient(envelope.id, {
        name: 'Signer',
        email: 'replace@example.com',
      });
      await saveFields(envelope.id, [
        aField(recipient.id),
        aField(recipient.id, { ratioY: 0.5 }),
      ]).expect(200);

      const second = await saveFields(envelope.id, [aField(recipient.id, { ratioY: 0.7 })]).expect(
        200,
      );
      expect((second.body as SaveFieldsResponse).fields).toHaveLength(1);
      expect((second.body as SaveFieldsResponse).fields[0]?.ratioY).toBe(0.7);
    });

    it('writes nothing when the layout has not changed', async () => {
      const envelope = await newEnvelope();
      const { recipient } = await addRecipient(envelope.id, {
        name: 'Idle',
        email: 'idle@example.com',
      });
      const layout = [aField(recipient.id)];

      const first = await saveFields(envelope.id, layout).expect(200);
      logs.clear();
      const second = await saveFields(envelope.id, layout).expect(200);

      // No new revision, so autosave cannot flood the audit chain.
      expect((second.body as SaveFieldsResponse).draftRevision).toBe(
        (first.body as SaveFieldsResponse).draftRevision,
      );
      expect(logs.find('Field layout unchanged; nothing written')).toHaveLength(1);

      const events = await appRoleQuery<{ count: string }>(
        `SELECT count(*) FROM "AuditTrail" WHERE "envelopeId" = $1 AND action = 'FIELDS_SAVED'`,
        [envelope.id],
      );
      expect(events.rows[0]?.count).toBe('1');
    });

    it('accepts an empty layout', async () => {
      const envelope = await newEnvelope();
      const { recipient } = await addRecipient(envelope.id, {
        name: 'Signer',
        email: 'empty@example.com',
      });
      await saveFields(envelope.id, [aField(recipient.id)]).expect(200);

      const cleared = await saveFields(envelope.id, []).expect(200);
      expect((cleared.body as SaveFieldsResponse).fields).toEqual([]);
    });

    it('rejects pixel coordinates with INVALID_COORDINATE_SPACE and the path', async () => {
      const envelope = await newEnvelope();
      const { recipient } = await addRecipient(envelope.id, {
        name: 'Signer',
        email: 'pixels@example.com',
      });

      const res = await saveFields(envelope.id, [
        aField(recipient.id),
        { ...aField(recipient.id), x: 120, y: 340 },
      ]).expect(400);

      expect(res.body.code).toBe('INVALID_COORDINATE_SPACE');
      expect(res.body.errors.map((e: { path: string }) => e.path)).toEqual([
        'fields[1].x',
        'fields[1].y',
      ]);
    });

    it.each([
      ['a ratio above 1', { ratioX: 1.5 }, 'RATIO_OUT_OF_RANGE'],
      ['a negative ratio', { ratioY: -0.2 }, 'RATIO_OUT_OF_RANGE'],
      ['a zero-width field', { ratioWidth: 0 }, 'RATIO_OUT_OF_RANGE'],
      ['a field off the right edge', { ratioX: 0.9, ratioWidth: 0.2 }, 'FIELD_EXCEEDS_PAGE'],
      ['a field off the bottom', { ratioY: 0.99, ratioHeight: 0.05 }, 'FIELD_EXCEEDS_PAGE'],
      ['a page beyond the document', { pageNumber: 99 }, 'PAGE_OUT_OF_RANGE'],
    ])('rejects %s', async (_name, overrides, code) => {
      const envelope = await newEnvelope();
      const { recipient } = await addRecipient(envelope.id, {
        name: 'Signer',
        email: `bad-${code}-${Math.random()}@example.com`,
      });

      const res = await saveFields(envelope.id, [aField(recipient.id, overrides)]).expect(400);
      expect(res.body.code).toBe(code);
    });

    it('rejects the whole request when one field is bad', async () => {
      const envelope = await newEnvelope();
      const { recipient } = await addRecipient(envelope.id, {
        name: 'Signer',
        email: 'allornothing@example.com',
      });
      await saveFields(envelope.id, [aField(recipient.id)]).expect(200);

      await saveFields(envelope.id, [
        aField(recipient.id, { ratioY: 0.5 }),
        aField(recipient.id, { ratioX: 2 }),
      ]).expect(400);

      const detail = await request(t.http)
        .get(`/api/v1/envelopes/${envelope.id}`)
        .set('Authorization', auth(owner))
        .expect(200);
      // The original layout is untouched.
      expect((detail.body as EnvelopeDetail).fields).toHaveLength(1);
      expect((detail.body as EnvelopeDetail).fields[0]?.ratioY).toBe(0.2);
    });

    it('rejects a field belonging to someone on another envelope', async () => {
      const mine = await newEnvelope();
      const other = await newEnvelope();
      const { recipient } = await addRecipient(other.id, {
        name: 'Elsewhere',
        email: 'elsewhere@example.com',
      });

      const res = await saveFields(mine.id, [aField(recipient.id)]).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.errors[0].path).toBe('fields[0].recipientId');
    });

    it('rejects fields for a recipient who only receives a copy', async () => {
      const envelope = await newEnvelope();
      const { recipient } = await addRecipient(envelope.id, {
        name: 'Copied',
        email: 'copied@example.com',
        role: 'CC',
      });

      const res = await saveFields(envelope.id, [aField(recipient.id)]).expect(400);
      expect(res.body.errors[0].message).toMatch(/cannot have fields/);
    });

    it('rejects two fields sharing an id', async () => {
      const envelope = await newEnvelope();
      const { recipient } = await addRecipient(envelope.id, {
        name: 'Signer',
        email: 'duplicate@example.com',
      });
      const field = aField(recipient.id);

      const res = await saveFields(envelope.id, [field, { ...field, ratioY: 0.6 }]).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('rejects more fields than the limit allows', async () => {
      const envelope = await newEnvelope();
      const { recipient } = await addRecipient(envelope.id, {
        name: 'Signer',
        email: 'toomany@example.com',
      });

      const fields = Array.from({ length: 1001 }, () => aField(recipient.id));
      await saveFields(envelope.id, fields).expect(400);
    });
  });

  describe('concurrency', () => {
    it('refuses a save based on a revision someone else has moved past', async () => {
      const envelope = await newEnvelope();
      const { recipient, draftRevision } = await addRecipient(envelope.id, {
        name: 'Signer',
        email: 'concurrent@example.com',
      });

      // A second tab changes something first.
      await request(t.http)
        .patch(`/api/v1/envelopes/${envelope.id}`)
        .set('Authorization', auth(owner))
        .send({ title: 'Changed elsewhere' })
        .expect(200);

      const stale = await saveFields(envelope.id, [aField(recipient.id)])
        .set('If-Match', `"${draftRevision}"`)
        .expect(412);

      expect(stale.body.code).toBe('DRAFT_REVISION_MISMATCH');
      expect(stale.headers.etag).toBeDefined();
    });

    it('accepts a save that carries the current revision', async () => {
      const envelope = await newEnvelope();
      const { recipient, draftRevision } = await addRecipient(envelope.id, {
        name: 'Signer',
        email: 'current@example.com',
      });

      await saveFields(envelope.id, [aField(recipient.id)])
        .set('If-Match', `"${draftRevision}"`)
        .expect(200);
    });
  });

  describe('a sent envelope', () => {
    it('can no longer be edited', async () => {
      const envelope = await newEnvelope();
      const { recipient } = await addRecipient(envelope.id, {
        name: 'Signer',
        email: 'sent@example.com',
      });
      // Phase 3 owns sending; for now force the status the way sending will.
      await ownerQuery(`UPDATE "Envelope" SET status = 'SENT' WHERE id = $1`, [envelope.id]);

      const patched = await request(t.http)
        .patch(`/api/v1/envelopes/${envelope.id}`)
        .set('Authorization', auth(owner))
        .send({ title: 'Too late' })
        .expect(409);
      expect(patched.body.code).toBe('ENVELOPE_NOT_DRAFT');

      const saved = await saveFields(envelope.id, [aField(recipient.id)]).expect(409);
      expect(saved.body.code).toBe('ENVELOPE_NOT_DRAFT');

      await ownerQuery(`UPDATE "Envelope" SET status = 'DRAFT' WHERE id = $1`, [envelope.id]);
    });
  });

  describe('tenant isolation', () => {
    it('answers every draft endpoint with the same 404 another tenant gets for a random id', async () => {
      const mine = await newEnvelope();
      const { recipient } = await addRecipient(mine.id, {
        name: 'Mine',
        email: 'mine@example.com',
      });
      const unknown = randomUUID();

      const attempts = [
        () =>
          request(t.http)
            .patch(`/api/v1/envelopes/${mine.id}`)
            .set('Authorization', auth(outsider))
            .send({ title: 'Stolen' }),
        () =>
          request(t.http)
            .post(`/api/v1/envelopes/${mine.id}/recipients`)
            .set('Authorization', auth(outsider))
            .send({ name: 'Intruder', email: 'intruder@example.com' }),
        () =>
          request(t.http)
            .patch(`/api/v1/envelopes/${mine.id}/recipients/${recipient.id}`)
            .set('Authorization', auth(outsider))
            .send({ name: 'Renamed' }),
        () =>
          request(t.http)
            .delete(`/api/v1/envelopes/${mine.id}/recipients/${recipient.id}`)
            .set('Authorization', auth(outsider)),
        () =>
          request(t.http)
            .put(`/api/v1/envelopes/${mine.id}/fields`)
            .set('Authorization', auth(outsider))
            .send({ fields: [] }),
      ];

      for (const attempt of attempts) {
        const refused = await attempt().expect(404);
        const missing = await request(t.http)
          .patch(`/api/v1/envelopes/${unknown}`)
          .set('Authorization', auth(outsider))
          .send({ title: 'Nothing' })
          .expect(404);
        expect({ ...refused.body, instance: null, requestId: null }).toEqual({
          ...missing.body,
          instance: null,
          requestId: null,
        });
      }

      // Nothing was changed by any of those attempts.
      const detail = await request(t.http)
        .get(`/api/v1/envelopes/${mine.id}`)
        .set('Authorization', auth(owner))
        .expect(200);
      expect((detail.body as EnvelopeDetail).recipients).toHaveLength(1);
      expect((detail.body as EnvelopeDetail).recipients[0]?.name).toBe('Mine');
    });
  });

  describe('audit trail and logs', () => {
    it('records every change in an unbroken chain', async () => {
      const envelope = await uploadEnvelope();
      const { recipient } = await addRecipient(envelope.id, {
        name: 'Audited',
        email: 'audited@example.com',
      });
      await saveFields(envelope.id, [aField(recipient.id)]).expect(200);
      await request(t.http)
        .patch(`/api/v1/envelopes/${envelope.id}`)
        .set('Authorization', auth(owner))
        .send({ sequentialSigning: true })
        .expect(200);
      await request(t.http)
        .delete(`/api/v1/envelopes/${envelope.id}/recipients/${recipient.id}`)
        .set('Authorization', auth(owner))
        .expect(200);

      const verification = await t.app.get(AuditService).verify(envelope.id);
      expect(verification.valid).toBe(true);

      const detail = await request(t.http)
        .get(`/api/v1/envelopes/${envelope.id}`)
        .set('Authorization', auth(owner))
        .expect(200);
      expect((detail.body as EnvelopeDetail).auditTrail.map((e) => e.action)).toEqual([
        'ENVELOPE_CREATED',
        'RECIPIENT_ADDED',
        'FIELDS_SAVED',
        'ENVELOPE_UPDATED',
        'RECIPIENT_REMOVED',
      ]);
    });

    it('keeps names, emails and messages out of the audit trail', async () => {
      const envelope = await newEnvelope();
      await addRecipient(envelope.id, {
        name: 'Very Private Person',
        email: 'very.private@example.com',
      });
      await request(t.http)
        .patch(`/api/v1/envelopes/${envelope.id}`)
        .set('Authorization', auth(owner))
        .send({ message: 'Confidential treatment details' })
        .expect(200);

      const rows = await appRoleQuery<{ metadata: unknown }>(
        'SELECT metadata FROM "AuditTrail" WHERE "envelopeId" = $1',
        [envelope.id],
      );
      const metadata = JSON.stringify(rows.rows);
      expect(metadata).not.toContain('Very Private Person');
      expect(metadata).not.toContain('very.private@example.com');
      expect(metadata).not.toContain('Confidential treatment details');
    });

    it('never writes a recipient email or name to a log in clear', async () => {
      const envelope = await newEnvelope();
      await addRecipient(envelope.id, {
        name: 'Logged Person',
        email: 'logged.person@example.com',
      });

      expect(logs.text()).not.toContain('logged.person@example.com');
      expect(logs.text()).not.toContain('Logged Person');
      expect(logs.find('Recipient added')).toHaveLength(1);
      expect(logs.find('Recipient added')[0]?.fields.email).toBe('l***@example.com');
    });
  });

  describe('database guarantees', () => {
    it('refuses a field whose recipient belongs to another envelope', async () => {
      const mine = await newEnvelope();
      const other = await newEnvelope();
      const { recipient } = await addRecipient(other.id, {
        name: 'Elsewhere',
        email: 'fk@example.com',
      });

      // Straight to the database, bypassing every application check: the
      // composite foreign key is the last line of defence.
      await expect(
        ownerQuery(
          `INSERT INTO "DocumentField"
             (id, "envelopeId", "recipientId", type, "pageNumber", required,
              "ratioX", "ratioY", "ratioWidth", "ratioHeight")
           VALUES ($1, $2, $3, 'SIGNATURE', 1, true, 0.1, 0.1, 0.2, 0.05)`,
          [randomUUID(), mine.id, recipient.id],
        ),
      ).rejects.toThrow(/foreign key|violates/i);
    });

    it('lets the application role write the new columns', async () => {
      const envelope = await newEnvelope();
      const { recipient } = await addRecipient(envelope.id, {
        name: 'Grants',
        email: 'grants@example.com',
      });

      await expect(
        appRoleQuery('UPDATE "Recipient" SET "colorIndex" = 3 WHERE id = $1', [recipient.id]),
      ).resolves.toBeDefined();
      await expect(
        appRoleQuery('UPDATE "Envelope" SET message = $2 WHERE id = $1', [envelope.id, 'ok']),
      ).resolves.toBeDefined();
    });
  });
});
