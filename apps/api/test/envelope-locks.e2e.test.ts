import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MailQueueService } from '../src/mail/mail-queue.service';
import { EMAIL_QUEUE, SEAL_QUEUE } from '../src/queue/queue.module';
import { PdfSealingService } from '../src/sealing/pdf-sealing.service';
import { TokenGuardianService } from '../src/signing/token-guardian.service';
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
  linkFor,
  type PersonSpec,
  type PreparedEnvelope,
  prepareEnvelope,
  sendEnvelope,
  signAs,
} from './helpers/signing';

/** Cancels as step 4 will, until it exists: the database insists on when and why. */
const CANCEL = `UPDATE "Envelope"
  SET status = 'VOIDED', "voidedAt" = now(), "voidReason" = 'Cancelled by the test'
  WHERE id = $1`;

let counter = 0;
function person(name: string): PersonSpec {
  counter += 1;
  return { name, email: `${name.toLowerCase().replaceAll(' ', '.')}.${counter}@example.com` };
}

/**
 * A signature, decline or link must not commit against an envelope that closed,
 * or passed its deadline, after the link was checked; and a seal must not
 * complete an envelope cancelled while it was being sealed (docs/16 step 2).
 */
describe('envelope row locks (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;

  const api = (token: string, path = '') => `/api/v1/sign/${token}${path}`;

  async function envelopeStatus(id: string): Promise<string | undefined> {
    const { rows } = await ownerQuery<{ status: string }>(
      `SELECT status FROM "Envelope" WHERE id = $1`,
      [id],
    );
    return rows[0]?.status;
  }

  async function events(id: string, action: string): Promise<number> {
    const { rows } = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM "AuditTrail" WHERE "envelopeId" = $1 AND action = $2`,
      [id, action],
    );
    return rows[0]?.n ?? 0;
  }

  /** Sends to one signer and takes them to the point of finishing. */
  async function readyToFinish(): Promise<{ envelope: PreparedEnvelope; token: string }> {
    const signer = person('Lock Signer');
    const envelope = await prepareEnvelope(t.http, owner, [signer]);
    await sendEnvelope(t.http, owner, envelope.id).expect(200);
    const token = await linkFor(worker.mailbox, signer.email);
    const session = await request(t.http).get(api(token)).expect(200);
    await request(t.http)
      .post(api(token, '/consent'))
      .send({ agreed: true, consentTextHash: session.body.consentTextHash })
      .expect(200);
    for (const [kind, image] of [
      ['SIGNATURE', pngDataUrl()],
      ['INITIALS', pngDataUrl(makePng(120, 60))],
    ] as const) {
      await request(t.http)
        .post(api(token, '/adopt'))
        .send({ kind, method: 'TYPED', image })
        .expect(200);
    }
    return { envelope, token };
  }

  /** Runs `change` right after the link is checked, as if it committed in between. */
  function afterNextCheck(change: () => Promise<unknown>) {
    const original = TokenGuardianService.prototype.resolve;
    let done = false;
    return vi.spyOn(TokenGuardianService.prototype, 'resolve').mockImplementation(async function (
      this: TokenGuardianService,
      ...args
    ) {
      const context = await original.apply(this, args);
      if (!done) {
        done = true;
        await change();
      }
      return context;
    });
  }

  const finish = (token: string, envelope: PreparedEnvelope) => {
    const box = envelope.fields.find((f) => f.type === 'CHECKBOX');
    return request(t.http)
      .post(api(token, '/submit'))
      .send({ fields: [{ id: box?.id, value: 'true' }] });
  };

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    for (const name of [EMAIL_QUEUE, SEAL_QUEUE]) {
      await t.app.get<Queue>(getQueueToken(name)).obliterate({ force: true });
    }
    worker = await createTestWorker();
    owner = await registerUser(t.http, { fullName: 'Lock Owner', organization: 'Lock Clinic' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
  });

  it('refuses a signature when the deadline passes after the link was checked', async () => {
    const { envelope, token } = await readyToFinish();
    afterNextCheck(() =>
      ownerQuery(`UPDATE "Envelope" SET "expiresAt" = now() - interval '1 second' WHERE id = $1`, [
        envelope.id,
      ]),
    );

    const res = await finish(token, envelope).expect(401);
    expect(res.body.code).toBe('TOKEN_EXPIRED');
    expect(await events(envelope.id, 'RECIPIENT_SIGNED')).toBe(0);
    const { rows } = await ownerQuery<{ status: string; tokenUsedAt: Date | null }>(
      `SELECT status, "tokenUsedAt" FROM "Recipient" WHERE "envelopeId" = $1`,
      [envelope.id],
    );
    expect(rows[0]).toMatchObject({ status: 'VIEWED', tokenUsedAt: null });
  });

  it('refuses a signature when the envelope is cancelled after the link was checked', async () => {
    const { envelope, token } = await readyToFinish();
    afterNextCheck(() => ownerQuery(CANCEL, [envelope.id]));

    const res = await finish(token, envelope).expect(409);
    expect(res.body).toMatchObject({ code: 'ENVELOPE_TERMINAL', reason: 'VOIDED' });
    expect(await events(envelope.id, 'RECIPIENT_SIGNED')).toBe(0);
    expect(await envelopeStatus(envelope.id)).toBe('VOIDED');
  });

  it('refuses a decline when the envelope is cancelled after the link was checked', async () => {
    const { envelope, token } = await readyToFinish();
    afterNextCheck(() => ownerQuery(CANCEL, [envelope.id]));

    await request(t.http)
      .post(api(token, '/decline'))
      .send({ reason: 'Changed my mind' })
      .expect(409);
    expect(await events(envelope.id, 'RECIPIENT_DECLINED')).toBe(0);
    expect(await envelopeStatus(envelope.id)).toBe('VOIDED');
  });

  it('does not create a version for an envelope cancelled while the signature was stamped', async () => {
    const logs = captureLogs();
    const { envelope, token } = await readyToFinish();
    const burn = PdfSealingService.prototype.burnFields;
    vi.spyOn(PdfSealingService.prototype, 'burnFields').mockImplementation(async function (
      this: PdfSealingService,
      ...args
    ) {
      const result = await burn.apply(this, args);
      await ownerQuery(CANCEL, [envelope.id]);
      return result;
    });

    await finish(token, envelope).expect(202);
    await waitFor(
      () => logs.find('Envelope closed while stamping; version not created')[0],
      20_000,
    );
    const { rows } = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM "DocumentVersion" WHERE "envelopeId" = $1`,
      [envelope.id],
    );
    expect(rows[0]?.n).toBe(1); // only the original
    expect(await events(envelope.id, 'VERSION_CREATED')).toBe(0);
    logs.restore();
  });

  it('does not complete an envelope cancelled while it was being sealed', async () => {
    const logs = captureLogs();
    const signer = person('Seal Race');
    const envelope = await prepareEnvelope(t.http, owner, [signer]);
    await sendEnvelope(t.http, owner, envelope.id).expect(200);
    const token = await linkFor(worker.mailbox, signer.email);

    const append = PdfSealingService.prototype.appendCertificate;
    vi.spyOn(PdfSealingService.prototype, 'appendCertificate').mockImplementation(async function (
      this: PdfSealingService,
      ...args
    ) {
      const result = await append.apply(this, args);
      await ownerQuery(CANCEL, [envelope.id]);
      return result;
    });

    await signAs(t.http, token, envelope, envelope.recipients[0]?.id ?? '');
    await waitFor(
      () => logs.find('Envelope closed while building the certificate; not sealed', 'warn')[0],
      20_000,
    );
    expect(await envelopeStatus(envelope.id)).toBe('VOIDED');
    expect(await events(envelope.id, 'ENVELOPE_COMPLETED')).toBe(0);
    const { rows } = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM "DocumentVersion" WHERE "envelopeId" = $1 AND "isFinal"`,
      [envelope.id],
    );
    expect(rows[0]?.n).toBe(0);
    logs.restore();
  });

  it('queues a new invitation when someone is invited again, but not twice for one invitation', async () => {
    const mail = t.app.get(MailQueueService);
    const envelopeId = crypto.randomUUID();
    const recipientId = crypto.randomUUID();
    const first = new Date('2026-09-20T10:00:00Z');

    const a = await mail.enqueueSigningLink('invitation', envelopeId, recipientId, first);
    const b = await mail.enqueueSigningLink('invitation', envelopeId, recipientId, first);
    const c = await mail.enqueueSigningLink(
      'invitation',
      envelopeId,
      recipientId,
      new Date(first.getTime() + 60_000),
    );
    expect(a).toBe(b);
    expect(c).not.toBe(a);
    // The worker skips both: the recipient does not exist.
  });
});
