import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMAIL_QUEUE, SEAL_QUEUE } from '../src/queue/queue.module';
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

// Every sealed test document is larger than this, so completion always
// carries a download link (as in completion.e2e.test.ts).
process.env.COMPLETION_ATTACHMENT_MAX_BYTES = '1000';

const LINK = /https?:\/\/\S+\/download\/([0-9a-f]{64})/;

let counter = 0;
function people(...names: string[]): PersonSpec[] {
  return names.map((name) => {
    counter += 1;
    return { name, email: `${name.toLowerCase().replaceAll(' ', '.')}.${counter}@example.com` };
  });
}

/** Renewing an expired completion download link (docs/17 step 10). */
describe('download link renewal (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;

  const api = (token: string, path = '') => `/api/v1/sign/${token}${path}`;
  const post = (token: string, path: string, body: object) =>
    request(t.http).post(api(token, path)).send(body);

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

  /** Signs and waits for the sealed completion email with its download link. */
  async function completeWithDownloadLink(team: PersonSpec[], envelope: PreparedEnvelope) {
    await sendEnvelope(t.http, owner, envelope.id).expect(200);
    for (const [index, person] of team.entries()) {
      const recipient = envelope.recipients[index];
      if (recipient?.role !== 'SIGNER') continue;
      await sign(await linkFor(worker.mailbox, person.email), envelope, recipient.id);
    }
    const message = await waitFor(() =>
      worker.mailbox.messages
        .filter((m) => m.template === 'completed' && m.to === team[0]?.email)
        .at(-1),
    );
    const token = LINK.exec(message.text)?.[1];
    if (!token) throw new Error('no download link in the completion email');
    return token;
  }

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    for (const name of [EMAIL_QUEUE, SEAL_QUEUE]) {
      await t.app.get<Queue>(getQueueToken(name)).obliterate({ force: true });
    }
    worker = await createTestWorker();
    owner = await registerUser(t.http, { fullName: 'Renew Owner', organization: 'Renew Clinic' });
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
  });

  it('renews an expired link, and the old link still refuses', async () => {
    const team = people('Renew Signer');
    const [signer] = team;
    if (!signer) throw new Error('people');
    const envelope = await prepareEnvelope(t.http, owner, [signer]);
    const oldToken = await completeWithDownloadLink(team, envelope);

    await ownerQuery(
      `UPDATE "CompletionDownload" SET "expiresAt" = now() - interval '1 minute'
        WHERE "envelopeId" = $1`,
      [envelope.id],
    );
    await request(t.http).get(`/api/v1/download/${oldToken}`).expect(410);

    await request(t.http).post(`/api/v1/download/${oldToken}/renew`).expect(200);
    const renewedMessage = await waitFor(() =>
      worker.mailbox.messages
        .filter((m) => m.template === 'download-renewed' && m.to === signer.email)
        .at(-1),
    );
    const newToken = LINK.exec(renewedMessage.text)?.[1];
    if (!newToken) throw new Error('no link in the renewal email');
    expect(newToken).not.toBe(oldToken);

    // The old link is unaffected — renewal replaces the row's token, so the
    // old raw value simply no longer hashes to anything on record.
    await request(t.http).get(`/api/v1/download/${oldToken}`).expect(404);
    const downloaded = await request(t.http).get(`/api/v1/download/${newToken}`).expect(200);
    expect(downloaded.headers['content-type']).toBe('application/pdf');
  });

  it('renewal works on a link that has not expired yet, and updates lastRenewedAt', async () => {
    const team = people('Fresh Renew Signer');
    const [signer] = team;
    if (!signer) throw new Error('people');
    const envelope = await prepareEnvelope(t.http, owner, [signer]);
    const token = await completeWithDownloadLink(team, envelope);

    await request(t.http).post(`/api/v1/download/${token}/renew`).expect(200);
    await waitFor(() =>
      worker.mailbox.messages
        .filter((m) => m.template === 'download-renewed' && m.to === signer.email)
        .at(-1),
    );
    const { rows } = await ownerQuery<{ lastRenewedAt: Date | null }>(
      `SELECT "lastRenewedAt" FROM "CompletionDownload" cd
         JOIN "Recipient" r ON r.id = cd."recipientId"
        WHERE r.email = $1`,
      [signer.email],
    );
    expect(rows[0]?.lastRenewedAt).not.toBeNull();
  });

  it('refuses to renew an unknown token', async () => {
    const res = await request(t.http)
      .post(`/api/v1/download/${'0'.repeat(64)}/renew`)
      .expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('limits renewal to once per cooldown window', async () => {
    const team = people('Cooldown Signer');
    const [signer] = team;
    if (!signer) throw new Error('people');
    const envelope = await prepareEnvelope(t.http, owner, [signer]);
    const token = await completeWithDownloadLink(team, envelope);

    await request(t.http).post(`/api/v1/download/${token}/renew`).expect(200);
    const renewedMessage = await waitFor(() =>
      worker.mailbox.messages
        .filter((m) => m.template === 'download-renewed' && m.to === signer.email)
        .at(-1),
    );
    // Renewing replaces the row's active token (as the first test shows), so
    // the second attempt — still inside the cooldown — uses the new one.
    const newToken = LINK.exec(renewedMessage.text)?.[1];
    if (!newToken) throw new Error('no link in the renewal email');
    const tooSoon = await request(t.http).post(`/api/v1/download/${newToken}/renew`).expect(429);
    expect(tooSoon.body.code).toBe('DOWNLOAD_RENEW_TOO_SOON');
  });
});
