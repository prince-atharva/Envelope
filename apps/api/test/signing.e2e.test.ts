import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { EnvelopeDetail, SendEnvelopeResponse } from '@envelope/shared';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../src/audit/audit.service';
import type { EmailJobData } from '../src/mail/mail.types';
import { EMAIL_QUEUE } from '../src/queue/queue.module';
import { makePng, pngDataUrl } from './fixtures/png';
import {
  captureLogs,
  createTestApp,
  createTestWorker,
  type TestApp,
  type TestWorker,
  waitFor,
} from './helpers/app';
import { registerUser, type SignedInUser } from './helpers/auth';
import { ownerQuery, truncateAll } from './helpers/db';
import {
  bearer,
  emailsTo,
  linkFor,
  type PersonSpec,
  type PreparedEnvelope,
  prepareEnvelope,
  sendEnvelope,
} from './helpers/signing';
import { readStoredObject } from './helpers/storage';
import { TEST_ENV } from './test-env';

const hmac = (token: string) =>
  createHmac('sha256', TEST_ENV.SIGNING_TOKEN_SECRET ?? '')
    .update(token)
    .digest('hex');

let counter = 0;
/** People with addresses unique to this run, so mailbox lookups never collide. */
function people(...specs: Omit<PersonSpec, 'email'>[]): PersonSpec[] {
  return specs.map((spec) => {
    counter += 1;
    const local = spec.name.toLowerCase().replaceAll(' ', '.');
    return { ...spec, email: `${local}.${counter}@example.com` };
  });
}

describe('sending and signing (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;
  let outsider: SignedInUser;
  let queue: Queue<EmailJobData>;
  const logs = captureLogs();

  async function recipientRows(envelopeId: string) {
    const { rows } = await ownerQuery<{
      id: string;
      email: string;
      status: string;
      tokenHash: string | null;
      tokenExpiresAt: Date | null;
      invitedAt: Date | null;
      notifiedAt: Date | null;
    }>(
      `SELECT id, email, status, "tokenHash", "tokenExpiresAt", "invitedAt", "notifiedAt"
         FROM "Recipient" WHERE "envelopeId" = $1 ORDER BY "routingOrder", "createdAt"`,
      [envelopeId],
    );
    return rows;
  }

  async function auditActions(envelopeId: string): Promise<string[]> {
    const { rows } = await ownerQuery<{ action: string }>(
      `SELECT action FROM "AuditTrail" WHERE "envelopeId" = $1 ORDER BY sequence`,
      [envelopeId],
    );
    return rows.map((row) => row.action);
  }

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    queue = t.app.get<Queue<EmailJobData>>(getQueueToken(EMAIL_QUEUE));
    await queue.obliterate({ force: true });
    worker = await createTestWorker();
    owner = await registerUser(t.http, { fullName: 'Raj Kumar', organization: 'Signing Clinic' });
    outsider = await registerUser(t.http, { organization: 'Other Clinic' });
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
    logs.restore();
  });

  beforeEach(() => logs.clear());

  describe('sending', () => {
    it('needs an Idempotency-Key', async () => {
      const envelope = await prepareEnvelope(t.http, owner, people({ name: 'Priya Sharma' }));
      const res = await request(t.http)
        .post(`/api/v1/envelopes/${envelope.id}/send`)
        .set('Authorization', bearer(owner))
        .send({})
        .expect(400);
      expect(res.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    });

    it('refuses a draft that is not ready, and changes nothing', async () => {
      const envelope = await prepareEnvelope(t.http, owner, people({ name: 'Priya Sharma' }));
      await request(t.http)
        .put(`/api/v1/envelopes/${envelope.id}/fields`)
        .set('Authorization', bearer(owner))
        .send({ fields: [] })
        .expect(200);

      const res = await sendEnvelope(t.http, owner, envelope.id).expect(422);
      expect(res.body.code).toBe('RECIPIENT_HAS_NO_FIELDS');
      expect(res.body.errors).toEqual([
        { path: `recipients.${envelope.recipients[0]?.id}`, message: expect.any(String) },
      ]);

      const copyOnly = await prepareEnvelope(
        t.http,
        owner,
        people({ name: 'Copy Only', role: 'CC' }),
      );
      const refused = await sendEnvelope(t.http, owner, copyOnly.id).expect(422);
      expect(refused.body.code).toBe('NOT_READY_TO_SEND');

      const { rows } = await ownerQuery<{ status: string; sentAt: Date | null }>(
        `SELECT status, "sentAt" FROM "Envelope" WHERE id = ANY($1)`,
        [[envelope.id, copyOnly.id]],
      );
      expect(rows).toEqual([
        { status: 'DRAFT', sentAt: null },
        { status: 'DRAFT', sentAt: null },
      ]);
      expect(await auditActions(envelope.id)).not.toContain('ENVELOPE_SENT');
    });

    it('sends to every signer at once, and each gets a link of their own', async () => {
      const team = people(
        { name: 'Priya Sharma' },
        { name: 'Anil Mehta', role: 'APPROVER' },
        { name: 'Copy Person', role: 'CC' },
      );
      const envelope = await prepareEnvelope(t.http, owner, team, {
        message: 'Please sign by Friday.',
      });

      const before = Date.now();
      const res = await sendEnvelope(t.http, owner, envelope.id, { expiresInDays: 3 }).expect(200);
      const body = res.body as SendEnvelopeResponse;
      expect(body).toMatchObject({ id: envelope.id, status: 'SENT' });
      expect(body.invited.map((r) => r.id).sort()).toEqual(
        envelope.recipients
          .filter((r) => r.role !== 'CC')
          .map((r) => r.id)
          .sort(),
      );
      const expiresAt = new Date(body.expiresAt).getTime();
      expect(expiresAt - before).toBeGreaterThan(3 * 86_400_000 - 5_000);
      expect(expiresAt - before).toBeLessThan(3 * 86_400_000 + 5_000);

      const [priya, anil, copy] = team;
      if (!priya || !anil || !copy) throw new Error('missing people');
      const priyaToken = await linkFor(worker.mailbox, priya.email);
      const anilToken = await linkFor(worker.mailbox, anil.email);
      expect(priyaToken).not.toBe(anilToken);

      const invitation = emailsTo(worker.mailbox, priya.email, 'invitation')[0];
      expect(invitation?.subject).toBe('Raj Kumar has sent you a document to sign');
      expect(invitation?.text).toContain('Please sign by Friday.');
      expect(emailsTo(worker.mailbox, anil.email)[0]?.subject).toBe(
        'Raj Kumar has sent you a document to approve',
      );
      // Copies go out with the finished document (Phase 4), not now.
      expect(emailsTo(worker.mailbox, copy.email)).toEqual([]);

      const rows = await waitFor(async () => {
        const current = await recipientRows(envelope.id);
        return current.filter((row) => row.notifiedAt).length === 2 ? current : undefined;
      });
      const byEmail = new Map(rows.map((row) => [row.email, row]));
      expect(byEmail.get(priya.email)).toMatchObject({
        status: 'SENT',
        tokenHash: hmac(priyaToken),
      });
      // Compared in SQL: the columns have no time zone, so the pg driver would
      // read them in the machine's local zone.
      const { rows: expiry } = await ownerQuery<{ same: boolean }>(
        `SELECT bool_and(r."tokenExpiresAt" = e."expiresAt") AS same
           FROM "Recipient" r JOIN "Envelope" e ON e.id = r."envelopeId"
          WHERE e.id = $1 AND r."tokenHash" IS NOT NULL`,
        [envelope.id],
      );
      expect(expiry[0]?.same).toBe(true);
      expect(byEmail.get(anil.email)?.tokenHash).toBe(hmac(anilToken));
      expect(byEmail.get(copy.email)).toMatchObject({
        status: 'PENDING',
        tokenHash: null,
        invitedAt: null,
      });

      const actions = await auditActions(envelope.id);
      expect(actions.filter((action) => action === 'ENVELOPE_SENT')).toHaveLength(1);
      expect(actions.filter((action) => action === 'EMAIL_SENT')).toHaveLength(2);
      const { rows: emailEvents } = await ownerQuery<{ recipientId: string | null }>(
        `SELECT "recipientId" FROM "AuditTrail" WHERE "envelopeId" = $1 AND action = 'EMAIL_SENT'`,
        [envelope.id],
      );
      expect(emailEvents.every((event) => event.recipientId !== null)).toBe(true);
      expect((await t.app.get(AuditService).verify(envelope.id)).valid).toBe(true);
    });

    it('emails only the first person when signing one after another', async () => {
      const team = people({ name: 'First Signer' }, { name: 'Second Signer' });
      const envelope = await prepareEnvelope(t.http, owner, team, { sequential: true });

      const res = await sendEnvelope(t.http, owner, envelope.id).expect(200);
      expect((res.body as SendEnvelopeResponse).invited).toEqual([
        { id: envelope.recipients[0]?.id, status: 'SENT' },
      ]);

      const [first, second] = team;
      if (!first || !second) throw new Error('missing people');
      await linkFor(worker.mailbox, first.email);
      const rows = await recipientRows(envelope.id);
      expect(rows.map((row) => row.status)).toEqual(['SENT', 'PENDING']);
      expect(emailsTo(worker.mailbox, second.email)).toEqual([]);
    });

    it('replays a repeated request instead of sending twice', async () => {
      const team = people({ name: 'Replay Signer' });
      const envelope = await prepareEnvelope(t.http, owner, team);
      const key = randomUUID();

      const first = await sendEnvelope(t.http, owner, envelope.id, {}, key).expect(200);
      const again = await sendEnvelope(t.http, owner, envelope.id, {}, key).expect(200);
      expect(again.headers['idempotency-replayed']).toBe('true');
      expect(again.body).toEqual(first.body);

      const mismatch = await sendEnvelope(t.http, owner, envelope.id, { expiresInDays: 5 }, key);
      expect(mismatch.status).toBe(422);
      expect(mismatch.body.code).toBe('IDEMPOTENCY_KEY_MISMATCH');

      const fresh = await sendEnvelope(t.http, owner, envelope.id).expect(409);
      expect(fresh.body.code).toBe('ENVELOPE_NOT_DRAFT');

      await linkFor(worker.mailbox, team[0]?.email ?? '');
      expect(emailsTo(worker.mailbox, team[0]?.email ?? '', 'invitation')).toHaveLength(1);
      expect(
        (await auditActions(envelope.id)).filter((action) => action === 'ENVELOPE_SENT'),
      ).toHaveLength(1);
    });

    it("answers another tenant's envelope exactly like a missing one", async () => {
      const envelope = await prepareEnvelope(t.http, owner, people({ name: 'Tenant Signer' }));
      const theirs = await sendEnvelope(t.http, outsider, envelope.id).expect(404);
      const missing = await sendEnvelope(t.http, outsider, randomUUID()).expect(404);
      expect(theirs.body.code).toBe(missing.body.code);
    });

    it('never puts a raw token on the queue or in the logs', async () => {
      const team = people({ name: 'Leak Check' });
      const envelope = await prepareEnvelope(t.http, owner, team);
      await sendEnvelope(t.http, owner, envelope.id).expect(200);
      const token = await linkFor(worker.mailbox, team[0]?.email ?? '');

      const jobs = await queue.getJobs(['completed', 'waiting', 'active', 'delayed', 'failed']);
      expect(JSON.stringify(jobs.map((job) => job.data))).not.toContain(token);
      expect(logs.text()).not.toContain(token);
    });
  });

  describe('signing', () => {
    const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1';
    const api = (token: string, path = '') => `/api/v1/sign/${token}${path}`;
    const open = (token: string) => request(t.http).get(api(token)).set('User-Agent', UA);
    const post = (token: string, path: string, body: unknown) =>
      request(t.http)
        .post(api(token, path))
        .set('User-Agent', UA)
        .send(body as object);

    /** Sends a fresh envelope and returns each person's link, in the order given. */
    async function sent(
      specs: Omit<PersonSpec, 'email'>[],
      options: { sequential?: boolean; upload?: boolean } = {},
    ) {
      const team = people(...specs);
      const envelope = await prepareEnvelope(t.http, owner, team, options);
      await sendEnvelope(t.http, owner, envelope.id).expect(200);
      return { envelope, team };
    }

    async function consent(token: string) {
      const session = await open(token).expect(200);
      await post(token, '/consent', {
        agreed: true,
        consentTextHash: session.body.consentTextHash,
      }).expect(200);
    }

    async function adoptBoth(token: string) {
      await post(token, '/adopt', {
        kind: 'SIGNATURE',
        method: 'DRAWN',
        image: pngDataUrl(),
      }).expect(200);
      await post(token, '/adopt', {
        kind: 'INITIALS',
        method: 'TYPED',
        image: pngDataUrl(makePng(120, 60)),
      }).expect(200);
    }

    function checkboxOf(envelope: PreparedEnvelope, recipientId?: string) {
      const box = envelope.fields.find(
        (f) => f.type === 'CHECKBOX' && f.recipientId === recipientId,
      );
      if (!box) throw new Error('no checkbox');
      return box;
    }

    it('shows the notice first and nothing about the document until consent', async () => {
      const { envelope, team } = await sent([{ name: 'Gate Keeper' }], { upload: true });
      const token = await linkFor(worker.mailbox, team[0]?.email ?? '');

      const res = await open(token).expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.body).toMatchObject({
        envelopeTitle: 'agreement',
        senderName: 'Raj Kumar',
        recipientName: 'Gate Keeper',
        pageCount: 2,
        consentRequired: true,
        fields: [],
        adopted: {},
      });
      expect(res.body.consentText).toMatch(/^DRAFT — not legally reviewed/);
      expect(res.body.consentTextHash).toBe(
        createHash('sha256').update(res.body.consentText).digest('hex'),
      );

      for (const [path, body] of [
        ['/adopt', { kind: 'SIGNATURE', method: 'DRAWN', image: pngDataUrl() }],
        ['/submit', { fields: [] }],
      ] as const) {
        expect((await post(token, path, body).expect(403)).body.code).toBe('CONSENT_REQUIRED');
      }
      const document = await request(t.http).get(api(token, '/document')).expect(403);
      expect(document.body.code).toBe('CONSENT_REQUIRED');

      // Opening twice is recorded once.
      await open(token).expect(200);
      const rows = await recipientRows(envelope.id);
      expect(rows[0]?.status).toBe('VIEWED');
      expect((await auditActions(envelope.id)).filter((a) => a === 'ENVELOPE_VIEWED')).toHaveLength(
        1,
      );
    });

    it('stores the exact notice agreed to, with the address and browser', async () => {
      const { envelope, team } = await sent([{ name: 'Consent Giver' }, { name: 'Other Signer' }], {
        upload: true,
      });
      const token = await linkFor(worker.mailbox, team[0]?.email ?? '');
      const session = await open(token).expect(200);

      const stale = await post(token, '/consent', {
        agreed: true,
        consentTextHash: 'f'.repeat(64),
      }).expect(409);
      expect(stale.body.code).toBe('CONSENT_TEXT_CHANGED');

      const agreed = await post(token, '/consent', {
        agreed: true,
        consentTextHash: session.body.consentTextHash,
      }).expect(200);
      const again = await post(token, '/consent', {
        agreed: true,
        consentTextHash: session.body.consentTextHash,
      }).expect(200);
      expect(again.body.consentGivenAt).toBe(agreed.body.consentGivenAt);

      const { rows } = await ownerQuery<{ consentText: string }>(
        `SELECT "consentText" FROM "Recipient" WHERE id = $1`,
        [envelope.recipients[0]?.id],
      );
      expect(rows[0]?.consentText).toBe(session.body.consentText);
      const { rows: events } = await ownerQuery<{ ipAddress: string; userAgent: string }>(
        `SELECT "ipAddress", "userAgent" FROM "AuditTrail"
          WHERE "envelopeId" = $1 AND action = 'CONSENT_GIVEN'`,
        [envelope.id],
      );
      expect(events).toHaveLength(1);
      expect(events[0]?.userAgent).toBe(UA);
      expect(events[0]?.ipAddress).toMatch(/127\.0\.0\.1|::1/);

      // Now the fields arrive: this person's only, top to bottom.
      const after = await open(token).expect(200);
      const mine = envelope.fields.filter((f) => f.recipientId === envelope.recipients[0]?.id);
      expect(after.body.consentRequired).toBe(false);
      expect(after.body.consentText).toBeNull();
      expect(after.body.fields.map((f: { id: string }) => f.id)).toEqual(
        [...mine].sort((a, b) => a.ratioY - b.ratioY).map((f) => f.id),
      );
      expect(after.body.fields[0]).not.toHaveProperty('recipientId');

      const document = await request(t.http).get(api(token, '/document')).expect(200);
      expect(document.headers['content-type']).toBe('application/pdf');
      expect(document.headers['cache-control']).toBe('no-store');
      expect(
        Buffer.from(document.body as Buffer)
          .subarray(0, 5)
          .toString(),
      ).toBe('%PDF-');
    });

    it('keeps one adopted image per kind, and refuses anything but a transparent PNG', async () => {
      const { envelope, team } = await sent([{ name: 'Image Adopter' }]);
      const token = await linkFor(worker.mailbox, team[0]?.email ?? '');
      await consent(token);

      const jpeg = await post(token, '/adopt', {
        kind: 'SIGNATURE',
        method: 'DRAWN',
        image: 'data:image/jpeg;base64,/9j/4AAQ',
      }).expect(400);
      expect(jpeg.body.code).toBe('VALIDATION_FAILED');
      const opaque = await post(token, '/adopt', {
        kind: 'SIGNATURE',
        method: 'DRAWN',
        image: pngDataUrl(makePng(200, 80, 2)),
      }).expect(422);
      expect(opaque.body.code).toBe('INVALID_SIGNATURE_IMAGE');

      const png = makePng(240, 80);
      await post(token, '/adopt', {
        kind: 'SIGNATURE',
        method: 'DRAWN',
        image: pngDataUrl(png),
      }).expect(200);
      const { rows } = await ownerQuery<{ signatureImageKey: string }>(
        `SELECT "signatureImageKey" FROM "Recipient" WHERE id = $1`,
        [envelope.recipients[0]?.id],
      );
      const key = rows[0]?.signatureImageKey ?? '';
      expect(key).toMatch(/\/signatures\/.+\/signature-.+\.png$/);
      expect((await readStoredObject(key)).equals(png)).toBe(true);

      // Adopting again replaces the image, and the unused one is removed.
      await post(token, '/adopt', {
        kind: 'SIGNATURE',
        method: 'TYPED',
        image: pngDataUrl(makePng(300, 90)),
      }).expect(200);
      await expect(readStoredObject(key)).rejects.toThrow();
      expect((await open(token).expect(200)).body.adopted).toEqual({ SIGNATURE: 'TYPED' });
      expect(
        (await auditActions(envelope.id)).filter((a) => a === 'SIGNATURE_ADOPTED'),
      ).toHaveLength(2);
    });

    it('signs: fills every field, spends the link, and moves the envelope on', async () => {
      const { envelope, team } = await sent([{ name: 'Finisher' }, { name: 'Still Waiting' }]);
      const [finisher] = envelope.recipients;
      const token = await linkFor(worker.mailbox, team[0]?.email ?? '');
      await consent(token);
      await post(token, '/adopt', {
        kind: 'SIGNATURE',
        method: 'DRAWN',
        image: pngDataUrl(),
      }).expect(200);

      const box = checkboxOf(envelope, finisher?.id);
      const incomplete = await post(token, '/submit', {
        fields: [{ id: box.id, value: 'false' }],
      }).expect(422);
      expect(incomplete.body.code).toBe('REQUIRED_FIELDS_INCOMPLETE');
      expect(incomplete.body.errors).toHaveLength(2); // the initials and the tick box

      const theirs = envelope.fields.find((f) => f.recipientId !== finisher?.id);
      const foreign = await post(token, '/submit', { fields: [{ id: theirs?.id }] }).expect(400);
      expect(foreign.body.code).toBe('VALIDATION_FAILED');

      await post(token, '/adopt', {
        kind: 'INITIALS',
        method: 'TYPED',
        image: pngDataUrl(makePng(120, 60)),
      }).expect(200);
      const date = envelope.fields.find(
        (f) => f.type === 'DATE_SIGNED' && f.recipientId === finisher?.id,
      );
      const done = await post(token, '/submit', {
        fields: [
          { id: box.id, value: 'true' },
          { id: date?.id, value: '1999-01-01' },
        ],
      }).expect(202);
      expect(done.body).toMatchObject({ status: 'SIGNED' });

      const { rows: recipient } = await ownerQuery<{
        status: string;
        tokenUsedAt: Date | null;
        signedFromUa: string;
      }>(`SELECT status, "tokenUsedAt", "signedFromUa" FROM "Recipient" WHERE id = $1`, [
        finisher?.id,
      ]);
      expect(recipient[0]).toMatchObject({ status: 'SIGNED', signedFromUa: UA });
      expect(recipient[0]?.tokenUsedAt).not.toBeNull();

      const { rows: values } = await ownerQuery<{
        type: string;
        value: string | null;
        isCompleted: boolean;
      }>(
        `SELECT type, value, "isCompleted" FROM "DocumentField"
          WHERE "recipientId" = $1 ORDER BY "ratioY"`,
        [finisher?.id],
      );
      const byType = Object.fromEntries(values.map((v) => [v.type, v]));
      expect(byType.SIGNATURE?.value).toMatch(/signature-.+\.png$/);
      expect(byType.INITIALS?.value).toMatch(/initials-.+\.png$/);
      expect(byType.DATE_SIGNED?.value).toBe(new Date().toISOString().slice(0, 10));
      expect(byType.CHECKBOX).toMatchObject({ value: 'true', isCompleted: true });
      expect(byType.TEXT_INPUT).toMatchObject({ value: null, isCompleted: false });

      const { rows: env } = await ownerQuery<{ status: string }>(
        `SELECT status FROM "Envelope" WHERE id = $1`,
        [envelope.id],
      );
      expect(env[0]?.status).toBe('PARTIALLY_SIGNED');

      // The link is spent: every route now says so.
      expect((await post(token, '/submit', { fields: [] }).expect(410)).body.code).toBe(
        'TOKEN_ALREADY_USED',
      );
      expect((await open(token).expect(410)).body.code).toBe('TOKEN_ALREADY_USED');
      expect((await t.app.get(AuditService).verify(envelope.id)).valid).toBe(true);
    });

    it('emails the next person only once the one before has signed', async () => {
      const { envelope, team } = await sent([{ name: 'Goes First' }, { name: 'Goes Second' }], {
        sequential: true,
      });
      const [first, second] = team;
      if (!first || !second) throw new Error('missing people');
      const token = await linkFor(worker.mailbox, first.email);
      expect(emailsTo(worker.mailbox, second.email)).toEqual([]);

      await consent(token);
      await adoptBoth(token);
      await post(token, '/submit', {
        fields: [{ id: checkboxOf(envelope, envelope.recipients[0]?.id).id, value: 'true' }],
      }).expect(202);

      const next = await linkFor(worker.mailbox, second.email);
      expect((await open(next).expect(200)).body.recipientName).toBe('Goes Second');
      expect((await recipientRows(envelope.id)).map((row) => row.status)).toEqual([
        'SIGNED',
        'VIEWED',
      ]);
    });

    it('ends the envelope for everyone when one person declines', async () => {
      const { envelope, team } = await sent([{ name: 'Says No' }, { name: 'Left Waiting' }]);
      const [no, waiting] = team;
      const noToken = await linkFor(worker.mailbox, no?.email ?? '');
      const waitingToken = await linkFor(worker.mailbox, waiting?.email ?? '');

      const blank = await post(noToken, '/decline', { reason: '  ' }).expect(400);
      expect(blank.body.code).toBe('VALIDATION_FAILED');
      // Declining needs no consent first.
      await post(noToken, '/decline', { reason: 'The fee is wrong.' }).expect(200);

      const mine = await open(noToken).expect(409);
      expect(mine.body).toMatchObject({ code: 'ENVELOPE_TERMINAL', reason: 'YOU_DECLINED' });
      const theirs = await open(waitingToken).expect(409);
      expect(theirs.body).toMatchObject({ code: 'ENVELOPE_TERMINAL', reason: 'DECLINED' });

      const { rows } = await ownerQuery<{ status: string; declinedReason: string | null }>(
        `SELECT e.status, r."declinedReason" FROM "Envelope" e
           JOIN "Recipient" r ON r."envelopeId" = e.id
          WHERE e.id = $1 AND r.id = $2`,
        [envelope.id, envelope.recipients[0]?.id],
      );
      expect(rows[0]).toEqual({ status: 'DECLINED', declinedReason: 'The fee is wrong.' });
      expect(await auditActions(envelope.id)).toContain('RECIPIENT_DECLINED');
    });

    it('turns away links that are unknown, malformed or expired', async () => {
      const unknown = await open('0'.repeat(64)).expect(401);
      expect(unknown.body.code).toBe('TOKEN_INVALID');
      expect((await open('not-a-token').expect(401)).body.code).toBe('TOKEN_INVALID');
      // The problem details never echo the token back.
      expect(unknown.body.instance).toBe('/api/v1/sign/[redacted]');

      const { envelope, team } = await sent([{ name: 'Too Late' }]);
      const token = await linkFor(worker.mailbox, team[0]?.email ?? '');
      await ownerQuery(
        `UPDATE "Envelope" SET "expiresAt" = now() - interval '1 minute' WHERE id = $1`,
        [envelope.id],
      );
      expect((await open(token).expect(401)).body.code).toBe('TOKEN_EXPIRED');
    });

    it('limits each link to 10 changes a minute, whatever the address', async () => {
      const { team } = await sent([{ name: 'Rate Limited' }]);
      const token = await linkFor(worker.mailbox, team[0]?.email ?? '');
      const wrong = { agreed: true, consentTextHash: 'e'.repeat(64) };
      for (let i = 0; i < 10; i += 1) await post(token, '/consent', wrong).expect(409);
      const limited = await post(token, '/consent', wrong).expect(429);
      expect(limited.body.code).toBe('RATE_LIMITED');
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      // Reading is counted separately.
      await open(token).expect(200);
    });

    it('never logs a signing token', async () => {
      const { envelope, team } = await sent([{ name: 'Quiet Signer' }]);
      const token = await linkFor(worker.mailbox, team[0]?.email ?? '');
      await consent(token);
      await adoptBoth(token);
      await post(token, '/submit', {
        fields: [{ id: checkboxOf(envelope, envelope.recipients[0]?.id).id, value: 'true' }],
      }).expect(202);
      await open(token).expect(410);
      expect(logs.text()).not.toContain(token);
    });
  });

  describe('reminders and progress', () => {
    const remind = (envelopeId: string, body: Record<string, unknown> = {}, user = owner) =>
      request(t.http)
        .post(`/api/v1/envelopes/${envelopeId}/remind`)
        .set('Authorization', bearer(user))
        .send(body);
    const detail = async (envelopeId: string) =>
      (
        await request(t.http)
          .get(`/api/v1/envelopes/${envelopeId}`)
          .set('Authorization', bearer(owner))
          .expect(200)
      ).body as EnvelopeDetail;

    it('reminds with a new link, and the old one stops working', async () => {
      const team = people({ name: 'Slow Signer' });
      const envelope = await prepareEnvelope(t.http, owner, team);
      await sendEnvelope(t.http, owner, envelope.id).expect(200);
      const email = team[0]?.email ?? '';
      const first = await linkFor(worker.mailbox, email);
      await waitFor(async () =>
        (await recipientRows(envelope.id))[0]?.notifiedAt ? true : undefined,
      );

      const res = await remind(envelope.id).expect(200);
      expect(res.body).toEqual({ reminded: [envelope.recipients[0]?.id], skipped: [] });

      const reminder = await waitFor(() => emailsTo(worker.mailbox, email, 'reminder')[0]);
      expect(reminder.subject).toBe('Reminder: Agreement under test awaits your signature');
      const second = await linkFor(worker.mailbox, email);
      expect(second).not.toBe(first);
      await waitFor(async () =>
        (await recipientRows(envelope.id))[0]?.tokenHash === hmac(second) ? true : undefined,
      );
      expect((await request(t.http).get(`/api/v1/sign/${first}`).expect(401)).body.code).toBe(
        'TOKEN_INVALID',
      );
      await request(t.http).get(`/api/v1/sign/${second}`).expect(200);

      const soon = await remind(envelope.id).expect(429);
      expect(soon.body.code).toBe('REMINDER_TOO_SOON');
      expect(Number(soon.headers['retry-after'])).toBeGreaterThan(23 * 3600);
      expect(await auditActions(envelope.id)).toContain('REMINDER_REQUESTED');
    });

    it('does not remind people whose turn has not come or who have finished', async () => {
      const team = people({ name: 'Turn One' }, { name: 'Turn Two' });
      const envelope = await prepareEnvelope(t.http, owner, team, { sequential: true });
      await sendEnvelope(t.http, owner, envelope.id).expect(200);
      await linkFor(worker.mailbox, team[0]?.email ?? '');

      const res = await remind(envelope.id, { recipientIds: [envelope.recipients[1]?.id] }).expect(
        200,
      );
      expect(res.body).toEqual({
        reminded: [],
        skipped: [{ recipientId: envelope.recipients[1]?.id, reason: 'NOT_THEIR_TURN' }],
      });
      expect((await remind(envelope.id, { recipientIds: [randomUUID()] })).status).toBe(404);
      expect((await remind(envelope.id, {}, outsider)).status).toBe(404);

      const draft = await prepareEnvelope(t.http, owner, people({ name: 'Not Sent' }));
      expect((await remind(draft.id).expect(409)).body.code).toBe('CONFLICT');
    });

    it("shows the sender each person's progress, and tells them about a decline", async () => {
      const team = people({ name: 'Progress One' }, { name: 'Progress Two' });
      const envelope = await prepareEnvelope(t.http, owner, team);
      await sendEnvelope(t.http, owner, envelope.id).expect(200);
      const one = await linkFor(worker.mailbox, team[0]?.email ?? '');
      await linkFor(worker.mailbox, team[1]?.email ?? '');
      await request(t.http).get(`/api/v1/sign/${one}`).expect(200);

      const sentView = await detail(envelope.id);
      expect(sentView.status).toBe('SENT');
      expect(sentView.sentAt).not.toBeNull();
      expect(sentView.expiresAt).not.toBeNull();
      const [first, second] = sentView.recipients;
      expect(first).toMatchObject({ status: 'VIEWED', declinedAt: null });
      expect(first?.viewedAt).not.toBeNull();
      expect(second).toMatchObject({ status: 'SENT', viewedAt: null });

      await request(t.http)
        .post(`/api/v1/sign/${one}/decline`)
        .send({ reason: 'Not my department.' })
        .expect(200);
      const declinedView = await detail(envelope.id);
      expect(declinedView.status).toBe('DECLINED');
      expect(declinedView.recipients[0]).toMatchObject({
        status: 'DECLINED',
        declinedReason: 'Not my department.',
      });

      // The owner has had other decline notices in this suite; find this one.
      const notice = await waitFor(() =>
        emailsTo(worker.mailbox, owner.email, 'declined').find((m) =>
          m.subject.startsWith('Progress One'),
        ),
      );
      expect(notice.subject).toBe('Progress One declined Agreement under test');
      expect(notice.text).toContain('Not my department.');
      expect(notice.text).toContain(`/dashboard/envelopes/${envelope.id}`);
    });
  });

  describe('database rules', () => {
    it('refuses a sent envelope without a send time', async () => {
      const envelope = await prepareEnvelope(t.http, owner, people({ name: 'Rule Check' }));
      await expect(
        ownerQuery(`UPDATE "Envelope" SET status = 'SENT' WHERE id = $1`, [envelope.id]),
      ).rejects.toThrow(/Envelope_sent_has_time/);
    });

    it('refuses signed, declined or consented recipients without their evidence', async () => {
      const envelope = await prepareEnvelope(t.http, owner, people({ name: 'Evidence Check' }));
      const id = envelope.recipients[0]?.id;
      await expect(
        ownerQuery(`UPDATE "Recipient" SET status = 'SIGNED', "signedAt" = now() WHERE id = $1`, [
          id,
        ]),
      ).rejects.toThrow(/Recipient_signed_has_evidence/);
      await expect(
        ownerQuery(
          `UPDATE "Recipient" SET status = 'DECLINED', "declinedAt" = now() WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/Recipient_declined_has_reason/);
      await expect(
        ownerQuery(`UPDATE "Recipient" SET "consentGivenAt" = now() WHERE id = $1`, [id]),
      ).rejects.toThrow(/Recipient_consent_has_text/);
      await expect(
        ownerQuery(`UPDATE "Recipient" SET "signatureImageKey" = 'k' WHERE id = $1`, [id]),
      ).rejects.toThrow(/Recipient_signature_has_method/);
    });
  });
});
