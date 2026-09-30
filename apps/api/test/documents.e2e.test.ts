import { createHash } from 'node:crypto';
import type { CreateApiKeyResponse } from '@envelope/shared';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMAIL_QUEUE, SEAL_QUEUE } from '../src/queue/queue.module';
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
import { pdfPageTexts } from './helpers/pdf-text';
import { linkFor, prepareEnvelope, sendEnvelope, signAs } from './helpers/signing';

const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

/**
 * The three named documents of an envelope (docs/18, workstream 11): callers
 * ask for the upload, the sealed result or its certificate pages by name,
 * without knowing the final version number.
 */
describe('named documents (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;
  let readOnlyKey: string;
  const logs = captureLogs();

  const documents = (id: string, name: string, token: string, etag?: string) => {
    const req = request(t.http)
      .get(`/api/v1/envelopes/${id}/documents/${name}`)
      .set('Authorization', `Bearer ${token}`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });
    return etag ? req.set('If-None-Match', etag) : req;
  };

  async function completedEnvelope(email: string) {
    const envelope = await prepareEnvelope(t.http, owner, [{ name: 'Named Signer', email }]);
    await sendEnvelope(t.http, owner, envelope.id).expect(200);
    const token = await linkFor(worker.mailbox, email);
    await signAs(t.http, token, envelope, envelope.recipients[0]?.id ?? '');
    await waitFor(async () => {
      const { rows } = await ownerQuery<{ status: string }>(
        `SELECT status FROM "Envelope" WHERE id = $1`,
        [envelope.id],
      );
      return rows[0]?.status === 'COMPLETED' ? true : undefined;
    }, 20_000);
    const { rows } = await ownerQuery<{ versionNumber: number; hash: string; pageCount: number }>(
      `SELECT "versionNumber", hash, "pageCount" FROM "DocumentVersion"
        WHERE "envelopeId" = $1 ORDER BY "versionNumber"`,
      [envelope.id],
    );
    return { id: envelope.id, versions: rows };
  }

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    for (const name of [EMAIL_QUEUE, SEAL_QUEUE]) {
      await t.app.get<Queue>(getQueueToken(name)).obliterate({ force: true });
    }
    worker = await createTestWorker();
    owner = await registerUser(t.http, { fullName: 'Docs Owner', organization: 'Docs Clinic' });
    const key = await request(t.http)
      .post('/api/v1/api-keys')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ label: 'read only', readOnly: true })
      .expect(201);
    readOnlyKey = (key.body as CreateApiKeyResponse).rawKey;
  });

  afterAll(async () => {
    logs.restore();
    await worker.close();
    await t.close();
  });

  it('serves the original at once and says the rest do not exist until completion', async () => {
    const draft = await prepareEnvelope(t.http, owner, [
      { name: 'Draft Signer', email: 'draft-docs@example.test' },
    ]);
    const { rows } = await ownerQuery<{ hash: string }>(
      `SELECT hash FROM "DocumentVersion" WHERE "envelopeId" = $1 AND "versionNumber" = 0`,
      [draft.id],
    );

    const original = await documents(draft.id, 'original', owner.accessToken).expect(200);
    expect(original.headers['content-type']).toContain('application/pdf');
    expect(sha256(original.body as Buffer)).toBe(rows[0]?.hash);

    for (const name of ['completed', 'certificate']) {
      const res = await request(t.http)
        .get(`/api/v1/envelopes/${draft.id}/documents/${name}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CONFLICT');
    }
  });

  it('serves the completed file and only its certificate pages, to a read-only key', async () => {
    const done = await completedEnvelope('done-docs@example.test');
    const final = done.versions.at(-1);
    const before = done.versions.at(-2);
    if (!final || !before) throw new Error('no sealed version');

    const original = await documents(done.id, 'original', readOnlyKey).expect(200);
    expect(sha256(original.body as Buffer)).toBe(done.versions[0]?.hash);

    const completed = await documents(done.id, 'completed', readOnlyKey).expect(200);
    expect(sha256(completed.body as Buffer)).toBe(final.hash);
    expect(completed.headers['content-disposition']).toContain('(signed).pdf');
    expect(completed.headers.etag).toBe(`"${final.hash}"`);

    const certificate = await documents(done.id, 'certificate', readOnlyKey).expect(200);
    const certificatePages = final.pageCount - before.pageCount;
    expect(certificatePages).toBeGreaterThan(0);
    const cut = await PDFDocument.load(certificate.body as Buffer);
    expect(cut.getPageCount()).toBe(certificatePages);
    expect(certificate.headers['content-disposition']).toContain('(certificate).pdf');
    expect(certificate.headers['content-length']).toBe(String((certificate.body as Buffer).length));
    // The certificate's own text, not a signed page of the document.
    const texts = await pdfPageTexts(certificate.body as Buffer);
    expect(texts.join(' ')).toMatch(/certificate/i);
    expect(logs.find('Certificate extracted', 'info').length).toBeGreaterThan(0);
  });

  it('answers a matching If-None-Match with 304 and no body, without an error', async () => {
    const done = await completedEnvelope('etag-docs@example.test');
    for (const name of ['original', 'completed', 'certificate']) {
      const first = await documents(done.id, name, owner.accessToken).expect(200);
      const etag = first.headers.etag as string;
      expect(etag).toEqual(expect.any(String));
      expect(first.headers['cache-control']).toBe('private, max-age=31536000, immutable');
      const again = await documents(done.id, name, owner.accessToken, etag).expect(304);
      expect((again.body as Buffer).length).toBe(0);
    }
    expect(logs.find('Unhandled error while processing request')).toHaveLength(0);
  });

  it('hides another workspace’s envelope behind not found, ETag or not', async () => {
    const done = await completedEnvelope('tenant-docs@example.test');
    const first = await documents(done.id, 'completed', owner.accessToken).expect(200);
    const other = await registerUser(t.http, { fullName: 'Other Docs', organization: 'Other Co' });
    for (const name of ['original', 'completed', 'certificate']) {
      await documents(done.id, name, other.accessToken).expect(404);
      await documents(done.id, name, other.accessToken, first.headers.etag as string).expect(404);
    }
  });

  it('answers not found for an id that does not exist', async () => {
    await documents('0195f3a0-0000-7000-8000-000000000000', 'original', owner.accessToken).expect(
      404,
    );
  });
});
