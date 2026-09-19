import { createHash } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../src/audit/audit.service';
import { EMAIL_QUEUE, SEAL_QUEUE } from '../src/queue/queue.module';
import { SealingService } from '../src/sealing/sealing.service';
import { makePng, pngDataUrl } from './fixtures/png';
import {
  createTestApp,
  createTestWorker,
  type TestApp,
  type TestWorker,
  waitFor,
} from './helpers/app';
import { registerUser, type SignedInUser } from './helpers/auth';
import { ownerQuery, truncateAll } from './helpers/db';
import { placementsOnPage } from './helpers/pdf-placements';
import { pdfPageTexts } from './helpers/pdf-text';
import {
  linkFor,
  type PersonSpec,
  type PreparedEnvelope,
  prepareEnvelope,
  sendEnvelope,
} from './helpers/signing';
import { readSealedObject, readStoredObject } from './helpers/storage';

const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

let counter = 0;
function people(...names: string[]): PersonSpec[] {
  return names.map((name) => {
    counter += 1;
    return { name, email: `${name.toLowerCase().replaceAll(' ', '.')}.${counter}@example.com` };
  });
}

interface VersionRow {
  versionNumber: number;
  fileUrl: string;
  hash: string;
  createdByRecipientId: string | null;
  isFinal: boolean;
  storageVersionId: string | null;
  pageCount: number;
  createdAt: Date;
}

interface EnvelopeRow {
  status: string;
  finalHash: string | null;
  completedFileUrl: string | null;
  completedAt: Date | null;
}

/**
 * One document version per signature (docs/15 step 4, ADR 0003, ADR 0006):
 * the worker stamps each signature onto the newest version, one at a time, and
 * the next signer is invited only once their predecessor's version exists.
 */
describe('sealing: one version per signature (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;

  const api = (token: string, path = '') => `/api/v1/sign/${token}${path}`;
  const post = (token: string, path: string, body: object) =>
    request(t.http).post(api(token, path)).send(body);

  async function versions(envelopeId: string): Promise<VersionRow[]> {
    const { rows } = await ownerQuery<VersionRow>(
      `SELECT "versionNumber", "fileUrl", hash, "createdByRecipientId", "isFinal",
              "storageVersionId", "pageCount", "createdAt"
         FROM "DocumentVersion" WHERE "envelopeId" = $1 ORDER BY "versionNumber"`,
      [envelopeId],
    );
    return rows;
  }

  const untilVersions = (envelopeId: string, count: number) =>
    waitFor(async () => ((await versions(envelopeId)).length >= count ? true : undefined), 20_000);

  /** The versions made by signatures: the original and one per signer, not the sealed file. */
  const stampedVersions = async (envelopeId: string) =>
    (await versions(envelopeId)).filter((v) => !v.isFinal);

  async function envelopeRow(envelopeId: string): Promise<EnvelopeRow | undefined> {
    const { rows } = await ownerQuery<EnvelopeRow>(
      `SELECT status, "finalHash", "completedFileUrl", "completedAt" FROM "Envelope" WHERE id = $1`,
      [envelopeId],
    );
    return rows[0];
  }

  /** Agree, open the document, adopt, tick the box and finish. Returns the document served. */
  async function sign(token: string, envelope: PreparedEnvelope, recipientId: string) {
    const session = await request(t.http).get(api(token)).expect(200);
    await post(token, '/consent', {
      agreed: true,
      consentTextHash: session.body.consentTextHash,
    }).expect(200);
    const served = await request(t.http).get(api(token, '/document')).expect(200);
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
    const box = envelope.fields.find((f) => f.type === 'CHECKBOX' && f.recipientId === recipientId);
    await post(token, '/submit', { fields: [{ id: box?.id, value: 'true' }] }).expect(202);
    return Buffer.from(served.body as Buffer);
  }

  async function signedMetadata(envelopeId: string, recipientId: string) {
    const { rows } = await ownerQuery<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM "AuditTrail"
        WHERE "envelopeId" = $1 AND "recipientId" = $2 AND action = 'RECIPIENT_SIGNED'`,
      [envelopeId, recipientId],
    );
    return rows[0]?.metadata ?? {};
  }

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    for (const name of [EMAIL_QUEUE, SEAL_QUEUE]) {
      await t.app.get<Queue>(getQueueToken(name)).obliterate({ force: true });
    }
    worker = await createTestWorker();
    owner = await registerUser(t.http, { fullName: 'Seal Owner', organization: 'Seal Clinic' });
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
  });

  it('three people one after another: each sees the signatures before theirs, and the chain has no gaps', async () => {
    const team = people('Seal First', 'Seal Second', 'Seal Third');
    const envelope = await prepareEnvelope(t.http, owner, team, { sequential: true });
    await sendEnvelope(t.http, owner, envelope.id).expect(200);
    const [v0] = await versions(envelope.id);
    if (!v0) throw new Error('no version 0');

    const served: Buffer[] = [];
    for (const [index, person] of team.entries()) {
      const recipientId = envelope.recipients[index]?.id ?? '';
      const token = await linkFor(worker.mailbox, person.email);
      served.push(await sign(token, envelope, recipientId));
      await untilVersions(envelope.id, index + 2);
    }
    // After the third signature: v3, then the sealed v4.
    await untilVersions(envelope.id, 5);

    const chain = await stampedVersions(envelope.id);
    expect(chain.map((v) => v.versionNumber)).toEqual([0, 1, 2, 3]);
    expect(chain.map((v) => v.createdByRecipientId)).toEqual([
      null,
      ...envelope.recipients.map((r) => r.id),
    ]);
    expect(chain.every((v) => !v.isFinal)).toBe(true);

    for (const [n, version] of chain.entries()) {
      // Each stored file is exactly what its hash says.
      const file = await readStoredObject(version.fileUrl);
      expect(sha256(file)).toBe(version.hash);
      // And carries one more signature than the one before (each signer's box is on page 1).
      const { placements } = await placementsOnPage(file, 1);
      expect(placements.filter((p) => p.kind === 'image').length).toBe(n * 2);
    }

    // Signer n was shown version n-1, and their signature says so.
    for (const [index, recipient] of envelope.recipients.entries()) {
      const version = chain[index];
      expect(sha256(served[index] ?? Buffer.alloc(0))).toBe(version?.hash);
      expect(await signedMetadata(envelope.id, recipient.id)).toMatchObject({
        documentVersion: index,
        documentSha256: version?.hash,
      });
    }

    // The next person was invited only once the version before them existed.
    const { rows: invited } = await ownerQuery<{ id: string; invitedAt: Date }>(
      `SELECT id, "invitedAt" FROM "Recipient" WHERE "envelopeId" = $1`,
      [envelope.id],
    );
    for (const [index, recipient] of envelope.recipients.entries()) {
      if (index === 0) continue;
      const at = invited.find((row) => row.id === recipient.id)?.invitedAt;
      expect(at?.getTime()).toBeGreaterThanOrEqual(chain[index]?.createdAt.getTime() ?? Infinity);
    }

    const { rows: events } = await ownerQuery<{
      metadata: { versionNumber: number; basedOn: number };
    }>(
      `SELECT metadata FROM "AuditTrail"
        WHERE "envelopeId" = $1 AND action = 'VERSION_CREATED' ORDER BY sequence`,
      [envelope.id],
    );
    expect(events.map((e) => [e.metadata.versionNumber, e.metadata.basedOn])).toEqual([
      [1, 0],
      [2, 1],
      [3, 2],
    ]);
    expect((await t.app.get(AuditService).verify(envelope.id)).valid).toBe(true);

    // ── The Phase 4 finish line (docs/15, doc 11 sprint 8 gate) ──
    // After the third signature: the sealed v4, with nothing missing in between.
    const all = await waitFor(async () => {
      const rows = await versions(envelope.id);
      return rows.length === 5 ? rows : undefined;
    }, 20_000);
    const final = all[4];
    if (!final?.storageVersionId) throw new Error('not sealed');
    expect(all.map((v) => [v.versionNumber, v.isFinal])).toEqual([
      [0, false],
      [1, false],
      [2, false],
      [3, false],
      [4, true],
    ]);
    const sealedFile = (await readSealedObject(final.fileUrl, final.storageVersionId)).body;
    expect(sha256(sealedFile)).toBe(final.hash);

    // The sender's download is the file on record: `sha256sum` agrees with finalHash.
    const downloaded = await request(t.http)
      .get(`/api/v1/envelopes/${envelope.id}/file?version=4`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(sha256(downloaded.body as Buffer)).toBe((await envelopeRow(envelope.id))?.finalHash);

    // Verify agrees, refuses a copy with one byte changed, and finds an in-progress copy.
    const verify = (file: Buffer) =>
      request(t.http)
        .post('/api/v1/verify')
        .attach('file', file, { filename: 'copy.pdf', contentType: 'application/pdf' })
        .expect(200);
    expect((await verify(sealedFile)).body).toMatchObject({
      verified: true,
      matched: { versionNumber: 4, isFinal: true },
    });
    const tampered = Buffer.from(sealedFile);
    tampered[200] = (tampered[200] ?? 0) ^ 1;
    expect((await verify(tampered)).body).toMatchObject({
      verified: false,
      reason: 'NO_MATCHING_DOCUMENT',
    });
    expect((await verify(await readStoredObject(all[2]?.fileUrl ?? ''))).body).toMatchObject({
      verified: true,
      matched: { versionNumber: 2, isFinal: false },
    });

    // The certificate lists every version and every event, read as a PDF reader reads it.
    const pages = await pdfPageTexts(sealedFile);
    const certificate = pages.slice(2).join('\n');
    expect(pages[2]).toContain('Certificate of Completion');
    for (const version of all.slice(0, 4)) expect(certificate).toContain(version.hash);
    // Not its own fingerprint: that would change the bytes it describes.
    expect(certificate).not.toContain(final.hash);
    const { rows: history } = await ownerQuery<{ sequence: number; action: string }>(
      `SELECT sequence, action FROM "AuditTrail" WHERE "envelopeId" = $1
         AND action <> 'ENVELOPE_COMPLETED' AND action <> 'COMPLETION_SENT' ORDER BY sequence`,
      [envelope.id],
    );
    const eventRows = certificate.match(/^\d+$/gm)?.map(Number) ?? [];
    for (const event of history) expect(eventRows).toContain(event.sequence);
    for (const person of team) {
      expect(certificate).toContain(person.name);
      expect(certificate).toContain(person.email);
    }
  });

  it('seals once everyone has signed: certificate appended, file locked, envelope completed', async () => {
    const team = people('Sealed One', 'Sealed Two');
    const envelope = await prepareEnvelope(t.http, owner, team, { sequential: true });
    await sendEnvelope(t.http, owner, envelope.id).expect(200);
    for (const [index, person] of team.entries()) {
      const token = await linkFor(worker.mailbox, person.email);
      await sign(token, envelope, envelope.recipients[index]?.id ?? '');
      await untilVersions(envelope.id, index + 2);
    }
    await untilVersions(envelope.id, 4);

    const all = await versions(envelope.id);
    const last = all[2];
    const final = all[3];
    expect(all.map((v) => [v.versionNumber, v.isFinal])).toEqual([
      [0, false],
      [1, false],
      [2, false],
      [3, true],
    ]);
    if (!last || !final?.storageVersionId) throw new Error('no sealed version');
    expect(final.createdByRecipientId).toBeNull();
    expect(final.fileUrl).toBe(
      `tenants/${owner.body.user.tenant.id}/envelopes/${envelope.id}/sealed.pdf`,
    );
    // The certificate adds at least one page after the signed document's two.
    expect(final.pageCount).toBeGreaterThan(last.pageCount);

    // The envelope records the seal, and the locked file is exactly what it says.
    const row = await envelopeRow(envelope.id);
    expect(row).toMatchObject({
      status: 'COMPLETED',
      finalHash: final.hash,
      completedFileUrl: final.fileUrl,
    });
    expect(row?.completedAt?.getTime()).toBeGreaterThanOrEqual(last.createdAt.getTime());
    const sealed = await readSealedObject(final.fileUrl, final.storageVersionId);
    expect(sha256(sealed.body)).toBe(final.hash);
    expect(sealed.mode).toBe('GOVERNANCE');
    expect(sealed.retainUntil?.getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
    // The signed pages are carried over unchanged: v2's signatures are all there.
    const { placements } = await placementsOnPage(sealed.body, 1);
    expect(placements.filter((p) => p.kind === 'image')).toHaveLength(4);

    // The sender downloads the sealed file through the API.
    const download = await request(t.http)
      .get(`/api/v1/envelopes/${envelope.id}/file?version=3`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(sha256(download.body as Buffer)).toBe(final.hash);

    const { rows: completed } = await ownerQuery<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM "AuditTrail" WHERE "envelopeId" = $1 AND action = 'ENVELOPE_COMPLETED'`,
      [envelope.id],
    );
    expect(completed).toHaveLength(1);
    expect(completed[0]?.metadata).toMatchObject({
      versionNumber: 3,
      sha256: final.hash,
      basedOn: 2,
    });
    expect((await t.app.get(AuditService).verify(envelope.id)).valid).toBe(true);

    // Everyone, and the sender, is emailed the sealed file itself (docs/15 step 6).
    const everyone = [...team.map((person) => person.email), owner.email];
    const completedMail = await waitFor(() => {
      // The owner is sent every envelope's copy: only this one's carries this fingerprint.
      const found = worker.mailbox.messages.filter(
        (m) => m.template === 'completed' && everyone.includes(m.to) && m.text.includes(final.hash),
      );
      return found.length === everyone.length ? found : undefined;
    }, 20_000);
    for (const message of completedMail) {
      expect(message.subject).toBe('Completed: Agreement under test');
      expect(message.text).toContain(final.hash);
      const [file] = message.attachments ?? [];
      expect(file?.filename).toBe('agreement (signed).pdf');
      expect(sha256(file?.content ?? Buffer.alloc(0))).toBe(final.hash);
    }
    expect(completedMail.find((m) => m.to === owner.email)?.text).toContain(
      `/dashboard/envelopes/${envelope.id}`,
    );
    const { rows: sent } = await waitFor(async () => {
      const result = await ownerQuery<{ recipientId: string | null; metadata: { to: string } }>(
        `SELECT "recipientId", metadata FROM "AuditTrail"
          WHERE "envelopeId" = $1 AND action = 'COMPLETION_SENT'`,
        [envelope.id],
      );
      return result.rows.length === everyone.length ? result : undefined;
    });
    expect(sent.map((row) => row.metadata)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ to: 'recipient', delivery: 'attachment' }),
        expect.objectContaining({ to: 'sender', delivery: 'attachment' }),
      ]),
    );

    // The sender's envelope page has all of it (docs/15 step 8).
    const detail = await request(t.http)
      .get(`/api/v1/envelopes/${envelope.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(detail.body).toMatchObject({
      status: 'COMPLETED',
      finalHash: final.hash,
      completedAt: expect.stringMatching(/Z$/),
      senderCopySentAt: expect.any(String),
    });
    expect(
      detail.body.versions.map(
        (v: { createdByRecipientId: string | null }) => v.createdByRecipientId,
      ),
    ).toEqual([null, ...envelope.recipients.map((r) => r.id), null]);
    expect(
      detail.body.recipients.every((r: { copySentAt: string | null }) => r.copySentAt !== null),
    ).toBe(true);

    // Running again changes nothing.
    const sealing = worker.module.get(SealingService);
    expect(await sealing.catchUp(envelope.id)).toEqual({
      stamped: 0,
      reason: 'envelope completed',
    });
    expect(await sealing.sealFinal(envelope.id)).toEqual({
      kind: 'idle',
      reason: 'envelope completed',
    });
    expect(await versions(envelope.id)).toHaveLength(4);
    // And sends nobody a second copy.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(
      worker.mailbox.messages.filter(
        (m) => m.template === 'completed' && everyone.includes(m.to) && m.text.includes(final.hash),
      ),
    ).toHaveLength(everyone.length);
  });

  it('waits for an approver, and leaves people who only get a copy out of it', async () => {
    const [signer, approver, copy] = people('Needs Approval', 'The Approver', 'Just Copied');
    if (!signer || !approver || !copy) throw new Error('people');
    const envelope = await prepareEnvelope(t.http, owner, [
      signer,
      { ...approver, role: 'APPROVER' },
      { ...copy, role: 'CC' },
    ]);
    await sendEnvelope(t.http, owner, envelope.id).expect(200);
    const [signerId, approverId] = envelope.recipients.map((r) => r.id);

    await sign(await linkFor(worker.mailbox, signer.email), envelope, signerId ?? '');
    await untilVersions(envelope.id, 2);
    const sealing = worker.module.get(SealingService);
    expect(await sealing.sealFinal(envelope.id)).toEqual({
      kind: 'idle',
      reason: 'waiting for signatures',
    });
    expect((await envelopeRow(envelope.id))?.status).toBe('PARTIALLY_SIGNED');

    await sign(await linkFor(worker.mailbox, approver.email), envelope, approverId ?? '');
    await untilVersions(envelope.id, 4);
    const all = await versions(envelope.id);
    expect(all.map((v) => v.createdByRecipientId)).toEqual([null, signerId, approverId, null]);
    expect(all.at(-1)?.isFinal).toBe(true);
    expect((await envelopeRow(envelope.id))?.status).toBe('COMPLETED');
  });

  it('two people finishing at the same moment are stamped one after the other', async () => {
    const team = people('Parallel One', 'Parallel Two');
    const envelope = await prepareEnvelope(t.http, owner, team);
    await sendEnvelope(t.http, owner, envelope.id).expect(200);
    const tokens = await Promise.all(team.map((person) => linkFor(worker.mailbox, person.email)));

    await Promise.all(
      tokens.map((token, index) => sign(token, envelope, envelope.recipients[index]?.id ?? '')),
    );
    await untilVersions(envelope.id, 3);

    const chain = await stampedVersions(envelope.id);
    expect(chain.map((v) => v.versionNumber)).toEqual([0, 1, 2]);
    expect(new Set(chain.map((v) => v.createdByRecipientId))).toEqual(
      new Set([null, ...envelope.recipients.map((r) => r.id)]),
    );
    // Version 2 was built on version 1: both signatures are in it.
    const last = await readStoredObject(chain[2]?.fileUrl ?? '');
    const { placements } = await placementsOnPage(last, 1);
    expect(placements.filter((p) => p.kind === 'image')).toHaveLength(4);
  });

  it('running again finds nothing to do, and a declined envelope is not stamped further', async () => {
    const sealing = worker.module.get(SealingService);
    const team = people('Once Only', 'Says No');
    const envelope = await prepareEnvelope(t.http, owner, team);
    await sendEnvelope(t.http, owner, envelope.id).expect(200);
    const [first, second] = await Promise.all(
      team.map((person) => linkFor(worker.mailbox, person.email)),
    );

    await sign(first ?? '', envelope, envelope.recipients[0]?.id ?? '');
    await untilVersions(envelope.id, 2);
    expect(await sealing.catchUp(envelope.id)).toEqual({ stamped: 0, reason: 'nothing to stamp' });
    expect(await versions(envelope.id)).toHaveLength(2);

    await post(second ?? '', '/decline', { reason: 'Not today.' }).expect(200);
    expect(await sealing.catchUp(envelope.id)).toEqual({ stamped: 0, reason: 'envelope declined' });
    expect(await versions(envelope.id)).toHaveLength(2);
  });
});
