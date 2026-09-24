import { createHash } from 'node:crypto';
import type { VerifyResponse } from '@envelope/shared';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMAIL_QUEUE, SEAL_QUEUE } from '../src/queue/queue.module';
import { makePdf } from './fixtures/pdfs';
import {
  createTestApp,
  createTestWorker,
  type TestApp,
  type TestWorker,
  waitFor,
} from './helpers/app';
import { registerUser, type SignedInUser } from './helpers/auth';
import { ownerQuery, truncateAll } from './helpers/db';
import { linkFor, prepareEnvelope, sendEnvelope, signAs } from './helpers/signing';
import { readSealedObject, readStoredObject } from './helpers/storage';

const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

interface VersionRow {
  versionNumber: number;
  fileUrl: string;
  hash: string;
  isFinal: boolean;
  storageVersionId: string | null;
}

/**
 * Public verification (docs/15 step 7, docs/08): anyone uploads a PDF and is
 * told whether it is exactly a document signed here.
 */
describe('verify (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;

  const check = (file: Buffer, filename = 'copy.pdf') =>
    request(t.http)
      .post('/api/v1/verify')
      .attach('file', file, { filename, contentType: 'application/pdf' });

  async function versions(envelopeId: string): Promise<VersionRow[]> {
    const { rows } = await ownerQuery<VersionRow>(
      `SELECT "versionNumber", "fileUrl", hash, "isFinal", "storageVersionId"
         FROM "DocumentVersion" WHERE "envelopeId" = $1 ORDER BY "versionNumber"`,
      [envelopeId],
    );
    return rows;
  }
  const untilVersions = (envelopeId: string, count: number) =>
    waitFor(async () => ((await versions(envelopeId)).length >= count ? true : undefined), 20_000);

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    for (const name of [EMAIL_QUEUE, SEAL_QUEUE]) {
      await t.app.get<Queue>(getQueueToken(name)).obliterate({ force: true });
    }
    worker = await createTestWorker();
    owner = await registerUser(t.http, { fullName: 'Verify Owner', organization: 'Verify Clinic' });
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
  });

  it('confirms the sealed file and every signed version, and nothing else', async () => {
    const team = [
      { name: 'Verify First', email: 'verify.first@example.com' },
      { name: 'Verify Second', email: 'verify.second@example.com' },
    ];
    const envelope = await prepareEnvelope(t.http, owner, team, { sequential: true });
    await sendEnvelope(t.http, owner, envelope.id).expect(200);
    for (const [index, person] of team.entries()) {
      const token = await linkFor(worker.mailbox, person.email);
      await signAs(t.http, token, envelope, envelope.recipients[index]?.id ?? '');
      await untilVersions(envelope.id, index + 2);
    }
    await untilVersions(envelope.id, 4);
    const [v0, v1, , final] = await versions(envelope.id);
    if (!v0 || !v1 || !final?.storageVersionId) throw new Error('no chain');

    // The sealed file, byte for byte.
    const sealed = (await readSealedObject(final.fileUrl, final.storageVersionId)).body;
    const res = await check(sealed).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.body as Extract<VerifyResponse, { verified: true }>;
    expect(body).toMatchObject({
      verified: true,
      documentHash: final.hash,
      envelopeId: envelope.id,
      title: 'Agreement under test',
      status: 'COMPLETED',
      matched: { versionNumber: 3, isFinal: true },
    });
    expect(body.completedAt).not.toBeNull();
    // Masked, and with no IP at all: this endpoint is public and
    // unauthenticated (docs/16 step 14).
    expect(body.signers.map((s) => [s.name, s.maskedEmail, s.role])).toEqual([
      ['Verify First', 'v***@example.com', 'SIGNER'],
      ['Verify Second', 'v***@example.com', 'SIGNER'],
    ]);
    expect(body.signers.every((s) => s.signedAt)).toBe(true);
    expect(body.signers.every((s) => !('ipAddress' in s) && !('email' in s))).toBe(true);
    expect(body.versionChain.map((v) => [v.versionNumber, v.signedBy, v.isFinal])).toEqual([
      [0, null, false],
      [1, 'Verify First', false],
      [2, 'Verify Second', false],
      [3, null, true],
    ]);
    expect(body.versionChain.map((v) => v.sha256)).toEqual(
      (await versions(envelope.id)).map((v) => v.hash),
    );
    expect(body.events.map((e) => e.action)).toContain('ENVELOPE_COMPLETED');
    expect(body.events.find((e) => e.action === 'RECIPIENT_SIGNED')?.actor).toBe('Verify First');

    // One byte changed: honestly, no match.
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 10] = (tampered[tampered.length - 10] ?? 0) ^ 1;
    const changed = await check(tampered).expect(200);
    expect(changed.body).toEqual({
      verified: false,
      documentHash: sha256(tampered),
      reason: 'NO_MATCHING_DOCUMENT',
      detail: expect.stringContaining('or it has been changed since it was sealed'),
    });

    // A copy made while signing was under way is found as that version.
    const inProgress = await check(await readStoredObject(v1.fileUrl)).expect(200);
    expect(inProgress.body).toMatchObject({
      verified: true,
      envelopeId: envelope.id,
      matched: { versionNumber: 1, isFinal: false },
    });

    // The unsigned original says so, and nothing about the envelope.
    const original = await check(await readStoredObject(v0.fileUrl)).expect(200);
    expect(original.body).toEqual({
      verified: false,
      documentHash: v0.hash,
      reason: 'UNSIGNED_ORIGINAL',
      detail: expect.stringContaining('before anyone signed it'),
    });
    expect(JSON.stringify(original.body)).not.toContain(envelope.id);
  });

  it('says so plainly when a PDF was never signed here', async () => {
    const pdf = await makePdf(1);
    const res = await check(pdf).expect(200);
    expect(res.body).toMatchObject({
      verified: false,
      documentHash: sha256(pdf),
      reason: 'NO_MATCHING_DOCUMENT',
    });
  });

  it('refuses what it cannot check', async () => {
    const notPdf = await check(Buffer.from('just some text'), 'notes.txt').expect(415);
    expect(notPdf.body.code).toBe('UNSUPPORTED_FILE_TYPE');

    const missing = await request(t.http).post('/api/v1/verify').field('x', 'y').expect(400);
    expect(['FILE_REQUIRED', 'BAD_REQUEST']).toContain(missing.body.code);
    await request(t.http).post('/api/v1/verify').expect(400);

    const tooBig = await request(t.http)
      .post('/api/v1/verify')
      .set('Content-Type', 'multipart/form-data; boundary=x')
      .set('Content-Length', String(26 * 1024 * 1024 + 70_000))
      .send('--x--');
    expect(tooBig.status).toBe(413);
  });

  it('allows 30 checks a minute from one address', async () => {
    const pdf = await makePdf(1);
    const ip = '198.51.100.77';
    let last = 0;
    for (let n = 0; n < 31; n += 1) {
      last = (await check(pdf).set('X-Forwarded-For', ip)).status;
    }
    expect(last).toBe(429);
  });
});
