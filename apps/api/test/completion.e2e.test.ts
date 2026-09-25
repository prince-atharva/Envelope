import { createHash } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CompletionMailer } from '../src/mail/completion.mailer';
import { EMAIL_QUEUE, SEAL_QUEUE } from '../src/queue/queue.module';
import { hashDownloadToken, hashSigningToken } from '../src/signing/signing-token';
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
import {
  linkFor,
  type PersonSpec,
  type PreparedEnvelope,
  prepareEnvelope,
  sendEnvelope,
} from './helpers/signing';

// Every sealed test document is larger than this, so every completion email
// carries a download link instead of the file. Set before the app reads its
// configuration; test files run in their own workers, so no other file sees it.
process.env.COMPLETION_ATTACHMENT_MAX_BYTES = '1000';

const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
// The web app's download page (docs/17 step 10), not the API route directly.
const LINK = /https?:\/\/\S+\/download\/([0-9a-f]{64})/;

let counter = 0;
function people(...names: string[]): PersonSpec[] {
  return names.map((name) => {
    counter += 1;
    return { name, email: `${name.toLowerCase().replaceAll(' ', '.')}.${counter}@example.com` };
  });
}

/**
 * Completion emails for documents too large to attach (docs/15 step 6): a
 * private link, valid for COMPLETION_LINK_DAYS, whose token only the email
 * holds.
 */
describe('completion download links (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;

  const api = (token: string, path = '') => `/api/v1/sign/${token}${path}`;
  const post = (token: string, path: string, body: object) =>
    request(t.http).post(api(token, path)).send(body);
  const download = (token: string) =>
    request(t.http)
      .get(`/api/v1/download/${token}`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });

  async function sign(token: string, envelope: PreparedEnvelope, recipientId: string) {
    const session = await request(t.http).get(api(token)).expect(200);
    await post(token, '/consent', {
      agreed: true,
      consentTextHash: session.body.consentTextHash,
    }).expect(200);
    await request(t.http).get(api(token, '/document')).expect(200);
    await post(token, '/adopt', { kind: 'SIGNATURE', method: 'DRAWN', image: pngDataUrl() });
    await post(token, '/adopt', {
      kind: 'INITIALS',
      method: 'TYPED',
      image: pngDataUrl(makePng(120, 60)),
    });
    const box = envelope.fields.find((f) => f.type === 'CHECKBOX' && f.recipientId === recipientId);
    await post(token, '/submit', { fields: [{ id: box?.id, value: 'true' }] }).expect(202);
  }

  /** Signs everything and returns each person's completion email, by address. */
  async function complete(team: PersonSpec[], envelope: PreparedEnvelope, extra: string[] = []) {
    await sendEnvelope(t.http, owner, envelope.id).expect(200);
    for (const [index, person] of team.entries()) {
      const recipient = envelope.recipients[index];
      if (recipient?.role !== 'SIGNER') continue;
      await sign(await linkFor(worker.mailbox, person.email), envelope, recipient.id);
    }
    const addresses = [...team.map((person) => person.email), ...extra];
    return waitFor(async () => {
      // The owner is sent every envelope's copy: only this one's carries its fingerprint.
      const hash = await finalHash(envelope.id);
      if (!hash) return undefined;
      const found = worker.mailbox.messages.filter(
        (m) => m.template === 'completed' && addresses.includes(m.to) && m.text.includes(hash),
      );
      return found.length === addresses.length ? new Map(found.map((m) => [m.to, m])) : undefined;
    }, 30_000);
  }

  async function finalHash(envelopeId: string): Promise<string> {
    const { rows } = await ownerQuery<{ finalHash: string }>(
      `SELECT "finalHash" FROM "Envelope" WHERE id = $1`,
      [envelopeId],
    );
    return rows[0]?.finalHash ?? '';
  }

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    for (const name of [EMAIL_QUEUE, SEAL_QUEUE]) {
      await t.app.get<Queue>(getQueueToken(name)).obliterate({ force: true });
    }
    worker = await createTestWorker();
    owner = await registerUser(t.http, {
      fullName: 'Download Owner',
      organization: 'Download Clinic',
    });
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
  });

  it('sends each person their own link to the sealed file, and stores only its HMAC', async () => {
    const team = people('Link Signer', 'Link Copy');
    const [signer, copy] = team;
    if (!signer || !copy) throw new Error('people');
    const envelope = await prepareEnvelope(t.http, owner, [signer, { ...copy, role: 'CC' }]);
    const mail = await complete(team, envelope, [owner.email]);
    const hash = await finalHash(envelope.id);

    const tokens = new Map<string, string>();
    for (const [to, message] of mail) {
      expect(message.attachments ?? []).toHaveLength(0);
      expect(message.text).toContain(hash);
      const token = LINK.exec(message.text)?.[1];
      // The web app's download page, not the API route directly (docs/17 step 10).
      expect(message.html).toContain(`/download/${token}`);
      expect(message.html).not.toContain(`/api/v1/download/${token}`);
      if (!token) throw new Error(`no link for ${to}`);
      tokens.set(to, token);
    }
    // One link per person.
    expect(new Set(tokens.values()).size).toBe(3);

    const { rows: links } = await ownerQuery<{
      recipientId: string | null;
      tokenHash: string;
      expiresAt: Date;
      createdAt: Date;
    }>(
      `SELECT "recipientId", "tokenHash", "expiresAt", "createdAt" FROM "CompletionDownload"
         WHERE "envelopeId" = $1`,
      [envelope.id],
    );
    expect(links).toHaveLength(3);
    expect(links.filter((link) => link.recipientId === null)).toHaveLength(1);
    const stored = JSON.stringify(links);
    for (const token of tokens.values()) expect(stored).not.toContain(token);
    for (const link of links) {
      // Both columns are read the same way, so the difference is exact.
      const days = (link.expiresAt.getTime() - link.createdAt.getTime()) / 86_400_000;
      expect(days).toBeCloseTo(30, 3);
    }

    // The link gives exactly the sealed file, privately.
    const res = await download(tokens.get(copy.email) ?? '').expect(200);
    expect(sha256(res.body as Buffer)).toBe(hash);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain(
      'attachment; filename="agreement (signed).pdf"',
    );
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    // It can be used again, and each use is counted.
    await download(tokens.get(copy.email) ?? '').expect(200);
    const { rows: counted } = await ownerQuery<{ downloadCount: number }>(
      `SELECT "downloadCount" FROM "CompletionDownload" WHERE "tokenHash" = $1`,
      [links.find((link) => link.recipientId === envelope.recipients[1]?.id)?.tokenHash],
    );
    expect(counted[0]?.downloadCount).toBe(2);

    const { rows: sent } = await ownerQuery<{ metadata: { delivery: string } }>(
      `SELECT metadata FROM "AuditTrail" WHERE "envelopeId" = $1 AND action = 'COMPLETION_SENT'`,
      [envelope.id],
    );
    expect(sent.map((row) => row.metadata.delivery)).toEqual(['link', 'link', 'link']);

    // A second job for someone already sent their copy sends nothing.
    const mailer = worker.module.get(CompletionMailer);
    expect(
      await mailer.send({
        template: 'completed',
        envelopeId: envelope.id,
        recipientId: envelope.recipients[0]?.id ?? null,
      }),
    ).toEqual({ skipped: 'already sent' });
  });

  it('refuses unknown, malformed, signing and expired tokens', async () => {
    const [signer] = people('Expiry Signer');
    if (!signer) throw new Error('people');
    const envelope = await prepareEnvelope(t.http, owner, [signer]);
    const mail = await complete([signer], envelope);
    const token = LINK.exec(mail.get(signer.email)?.text ?? '')?.[1] ?? '';

    const unknown = await request(t.http)
      .get(`/api/v1/download/${'0'.repeat(64)}`)
      .expect(404);
    expect(unknown.body.code).toBe('NOT_FOUND');
    expect(unknown.headers['cache-control']).toBe('no-store');
    await request(t.http).get('/api/v1/download/not-a-token').expect(404);

    // A token whose *signing* HMAC is on record is still not a download token.
    const signingOnly = 'e'.repeat(64);
    const signerId = envelope.recipients[0]?.id;
    await ownerQuery(`UPDATE "CompletionDownload" SET "tokenHash" = $1 WHERE "recipientId" = $2`, [
      hashSigningToken(process.env.SIGNING_TOKEN_SECRET ?? '', signingOnly),
      signerId,
    ]);
    await request(t.http).get(`/api/v1/download/${signingOnly}`).expect(404);
    await request(t.http).get(`/api/v1/download/${token}`).expect(404);

    // Put the real hash back, then let the link run out.
    await ownerQuery(
      `UPDATE "CompletionDownload" SET "tokenHash" = $1, "expiresAt" = now() - interval '1 minute'
        WHERE "recipientId" = $2`,
      [hashDownloadToken(process.env.SIGNING_TOKEN_SECRET ?? '', token), signerId],
    );
    const expired = await request(t.http).get(`/api/v1/download/${token}`).expect(410);
    expect(expired.body.code).toBe('DOWNLOAD_LINK_EXPIRED');
    // The problem details never echo the token.
    expect(expired.body.instance).toBe('/api/v1/download/[redacted]');
    expect(JSON.stringify(expired.body)).not.toContain(token);
  });

  it('sends a sender who is also a recipient one copy, not two', async () => {
    const [signer] = people('Owner Signs Too');
    if (!signer) throw new Error('people');
    const envelope = await prepareEnvelope(t.http, owner, [
      signer,
      { name: 'Download Owner', email: owner.email, role: 'CC' },
    ]);
    const mail = await complete([signer, { name: 'Download Owner', email: owner.email }], envelope);
    const hash = await finalHash(envelope.id);
    expect(mail.size).toBe(2);
    // Their one copy is the recipient's: no link to the envelope page.
    expect(mail.get(owner.email)?.text).not.toContain('/dashboard/envelopes/');
    await new Promise((resolve) => setTimeout(resolve, 300));
    const toOwner = worker.mailbox.messages.filter(
      (m) => m.template === 'completed' && m.to === owner.email && m.text.includes(hash),
    );
    expect(toOwner).toHaveLength(1);
    const { rows } = await ownerQuery<{ n: string }>(
      `SELECT count(*) AS n FROM "AuditTrail"
        WHERE "envelopeId" = $1 AND action = 'COMPLETION_SENT' AND "recipientId" IS NULL`,
      [envelope.id],
    );
    expect(rows[0]?.n).toBe('0');
  });
});
