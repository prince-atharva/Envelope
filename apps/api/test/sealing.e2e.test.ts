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
import {
  linkFor,
  type PersonSpec,
  type PreparedEnvelope,
  prepareEnvelope,
  sendEnvelope,
} from './helpers/signing';
import { readStoredObject } from './helpers/storage';

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
  createdAt: Date;
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
      `SELECT "versionNumber", "fileUrl", hash, "createdByRecipientId", "isFinal", "createdAt"
         FROM "DocumentVersion" WHERE "envelopeId" = $1 ORDER BY "versionNumber"`,
      [envelopeId],
    );
    return rows;
  }

  const untilVersions = (envelopeId: string, count: number) =>
    waitFor(async () => ((await versions(envelopeId)).length >= count ? true : undefined), 20_000);

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

    const chain = await versions(envelope.id);
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

    const chain = await versions(envelope.id);
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
