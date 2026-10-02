import type { EnvelopeDetail } from '@envelope/shared';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EmailJobData } from '../src/mail/mail.types';
import { EMAIL_QUEUE } from '../src/queue/queue.module';
import {
  createTestApp,
  createTestWorker,
  type TestApp,
  type TestWorker,
  waitFor,
} from './helpers/app';
import { registerUser, type SignedInUser } from './helpers/auth';
import { ownerQuery, truncateAll } from './helpers/db';
import { pdfPageTexts } from './helpers/pdf-text';
import {
  bearer,
  emailsTo,
  linkFor,
  type PersonSpec,
  prepareEnvelope,
  sendEnvelope,
  signAs,
} from './helpers/signing';
import { readSealedObject } from './helpers/storage';
import { createApiKey, inviteUser } from './helpers/workspace';

let counter = 0;
function person(name: string, extra: Partial<PersonSpec> = {}): PersonSpec {
  counter += 1;
  return {
    name,
    email: `${name.toLowerCase().replaceAll(' ', '.')}.${counter}@example.com`,
    ...extra,
  };
}

const TOKEN_IN_PATH = /^\/sign\/([0-9a-f]{64})$/;

/** The sender hosts a signer on their own device (docs/22, ADR 0033). */
describe('in-person signing (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;
  let member: SignedInUser;
  let outsider: SignedInUser;

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    await t.app.get<Queue<EmailJobData>>(getQueueToken(EMAIL_QUEUE)).obliterate({ force: true });
    worker = await createTestWorker();
    owner = await registerUser(t.http, { fullName: 'Hana Host', organization: 'In-person Clinic' });
    member = await inviteUser(t.http, worker, owner, 'MEMBER');
    outsider = await registerUser(t.http, { organization: 'Elsewhere Clinic' });
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
  });

  const start = (envelopeId: string, recipientId: string, user: SignedInUser = owner) =>
    request(t.http)
      .post(`/api/v1/envelopes/${envelopeId}/recipients/${recipientId}/in-person`)
      .set('Authorization', bearer(user))
      .send();

  async function sent(people: PersonSpec[], options: { sequential?: boolean } = {}) {
    const envelope = await prepareEnvelope(t.http, owner, people, options);
    await sendEnvelope(t.http, owner, envelope.id).expect(200);
    return envelope;
  }

  async function detail(id: string): Promise<EnvelopeDetail> {
    const res = await request(t.http)
      .get(`/api/v1/envelopes/${id}`)
      .set('Authorization', bearer(owner))
      .expect(200);
    return res.body as EnvelopeDetail;
  }

  it('hands out a one-time link that replaces the emailed one and names the host', async () => {
    const pat = person('Pat Patient');
    const envelope = await sent([pat]);
    const emailed = await linkFor(worker.mailbox, pat.email);
    const patId = envelope.recipients[0]?.id ?? '';

    const res = await start(envelope.id, patId).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const token = TOKEN_IN_PATH.exec(res.body.signingPath)?.[1];
    expect(token).toBeTruthy();
    const ttl = new Date(res.body.expiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(28 * 60_000);
    expect(ttl).toBeLessThanOrEqual(30 * 60_000);

    // The emailed link was replaced; the new one says who is hosting.
    await request(t.http).get(`/api/v1/sign/${emailed}`).expect(401);
    const session = (await request(t.http).get(`/api/v1/sign/${token}`).expect(200)).body;
    expect(session.inPerson).toEqual({ hostName: 'Hana Host' });
    // Nothing was emailed for it.
    expect(emailsTo(worker.mailbox, pat.email, 'invitation')).toHaveLength(1);

    const { rows } = await ownerQuery<{ actorUserId: string; recipientId: string }>(
      `SELECT "actorUserId", "recipientId" FROM "AuditTrail"
        WHERE "envelopeId" = $1 AND action = 'IN_PERSON_STARTED'`,
      [envelope.id],
    );
    expect(rows).toEqual([{ actorUserId: owner.body.user.id, recipientId: patId }]);
  });

  it('records the signature as in person, and the certificate says so', async () => {
    const pat = person('Pat Patient');
    const envelope = await sent([pat]);
    await linkFor(worker.mailbox, pat.email);
    const patId = envelope.recipients[0]?.id ?? '';
    const token = TOKEN_IN_PATH.exec(
      (await start(envelope.id, patId).expect(200)).body.signingPath,
    )?.[1];
    await signAs(t.http, token ?? '', envelope, patId);

    const { rows } = await ownerQuery<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM "AuditTrail"
        WHERE "envelopeId" = $1 AND action = 'RECIPIENT_SIGNED'`,
      [envelope.id],
    );
    expect(rows[0]?.metadata).toMatchObject({
      inPerson: true,
      hostUserId: owner.body.user.id,
      hostName: 'Hana Host',
    });

    const final = await waitFor(async () => {
      const found = await ownerQuery<{ fileUrl: string; storageVersionId: string }>(
        `SELECT "fileUrl", "storageVersionId" FROM "DocumentVersion"
          WHERE "envelopeId" = $1 AND "isFinal"`,
        [envelope.id],
      );
      return found.rows[0];
    });
    const sealed = await readSealedObject(final.fileUrl, final.storageVersionId);
    const text = (await pdfPageTexts(sealed.body)).join('\n');
    expect(text).toContain('Signed in person');
    expect(text).toContain('Hosted by Hana Host');
    expect(text).toContain("IP address (host's device)");
  });

  it('can be a decline too, labelled the same way', async () => {
    const pat = person('Pat Patient');
    const envelope = await sent([pat]);
    await linkFor(worker.mailbox, pat.email);
    const patId = envelope.recipients[0]?.id ?? '';
    const token = TOKEN_IN_PATH.exec(
      (await start(envelope.id, patId).expect(200)).body.signingPath,
    )?.[1];
    await request(t.http)
      .post(`/api/v1/sign/${token}/decline`)
      .send({ reason: 'Changed my mind' })
      .expect(200);
    const { rows } = await ownerQuery<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM "AuditTrail"
        WHERE "envelopeId" = $1 AND action = 'RECIPIENT_DECLINED'`,
      [envelope.id],
    );
    expect(rows[0]?.metadata).toMatchObject({ inPerson: true, hostName: 'Hana Host' });
  });

  it('is replaced by a later emailed link, which is then not labelled in person', async () => {
    const pat = person('Pat Patient');
    const envelope = await sent([pat]);
    await linkFor(worker.mailbox, pat.email);
    const patId = envelope.recipients[0]?.id ?? '';
    const inPerson = TOKEN_IN_PATH.exec(
      (await start(envelope.id, patId).expect(200)).body.signingPath,
    )?.[1];

    await ownerQuery(`UPDATE "Recipient" SET "lastRemindedAt" = NULL WHERE id = $1`, [patId]);
    await request(t.http)
      .post(`/api/v1/envelopes/${envelope.id}/remind`)
      .set('Authorization', bearer(owner))
      .send({})
      .expect(200);
    await waitFor(() => emailsTo(worker.mailbox, pat.email, 'reminder').at(-1));

    await request(t.http).get(`/api/v1/sign/${inPerson}`).expect(401);
    const emailed = await linkFor(worker.mailbox, pat.email);
    expect(
      (await request(t.http).get(`/api/v1/sign/${emailed}`).expect(200)).body.inPerson,
    ).toBeNull();
    const { rows } = await ownerQuery<{ inPersonHostUserId: string | null }>(
      `SELECT "inPersonHostUserId" FROM "Recipient" WHERE id = $1`,
      [patId],
    );
    expect(rows[0]?.inPersonHostUserId).toBeNull();
  });

  it('is refused unless it is their turn, they have a link, and nobody has finished', async () => {
    const first = person('First Person');
    const second = person('Second Person');
    const viewer = person('View Only', { role: 'VIEWER' });
    const envelope = await sent(
      [first, { ...second, routingOrder: 2 }, { ...viewer, routingOrder: 3 }],
      {
        sequential: true,
      },
    );
    await linkFor(worker.mailbox, first.email);
    const [firstId, secondId, viewerId] = envelope.recipients.map((r) => r.id);

    expect((await start(envelope.id, secondId ?? '').expect(409)).body.detail).toContain('turn');
    await start(envelope.id, viewerId ?? '').expect(409);
    await start(envelope.id, '00000000-0000-4000-8000-000000000000').expect(404);

    const token = TOKEN_IN_PATH.exec(
      (await start(envelope.id, firstId ?? '').expect(200)).body.signingPath,
    )?.[1];
    await signAs(t.http, token ?? '', envelope, firstId ?? '');
    await waitFor(async () => (await detail(envelope.id)).recipients[0]?.status === 'SIGNED');
    await start(envelope.id, firstId ?? '').expect(409);
  });

  it('is refused on a draft and on a closed document', async () => {
    const pat = person('Pat Patient');
    const draft = await prepareEnvelope(t.http, owner, [pat]);
    await start(draft.id, draft.recipients[0]?.id ?? '').expect(409);

    const envelope = await sent([person('Cleo Closed')]);
    await linkFor(worker.mailbox, envelope.recipients[0]?.email ?? '');
    await request(t.http)
      .post(`/api/v1/envelopes/${envelope.id}/void`)
      .set('Authorization', bearer(owner))
      .send({ reason: 'Not needed' })
      .expect(200);
    await start(envelope.id, envelope.recipients[0]?.id ?? '').expect(409);
  });

  it('is for the sender or an admin only, and never across workspaces or for an API key', async () => {
    const pat = person('Pat Patient');
    const envelope = await sent([pat]);
    await linkFor(worker.mailbox, pat.email);
    const patId = envelope.recipients[0]?.id ?? '';

    // A member who did not send it.
    expect((await start(envelope.id, patId, member).expect(403)).body.code).toBe('FORBIDDEN_ROLE');
    // Another workspace cannot even see it.
    await start(envelope.id, patId, outsider).expect(404);
    // An API key is closed by default; so is anyone without a session.
    const key = await createApiKey(t.http, owner);
    const viaKey = await request(t.http)
      .post(`/api/v1/envelopes/${envelope.id}/recipients/${patId}/in-person`)
      .set('Authorization', key.authorization)
      .send()
      .expect(403);
    expect(viaKey.body.code).toBe('API_KEY_NOT_ALLOWED');
    await request(t.http)
      .post(`/api/v1/envelopes/${envelope.id}/recipients/${patId}/in-person`)
      .send()
      .expect(401);
    // None of the refusals touched the person's link.
    const { rows } = await ownerQuery<{ inPersonHostUserId: string | null }>(
      `SELECT "inPersonHostUserId" FROM "Recipient" WHERE id = $1`,
      [patId],
    );
    expect(rows[0]?.inPersonHostUserId).toBeNull();
  });

  it('stops working when its short life ends, and never outlives the document', async () => {
    const pat = person('Pat Patient');
    const envelope = await sent([pat]);
    await linkFor(worker.mailbox, pat.email);
    const patId = envelope.recipients[0]?.id ?? '';
    const token = TOKEN_IN_PATH.exec(
      (await start(envelope.id, patId).expect(200)).body.signingPath,
    )?.[1];
    await request(t.http).get(`/api/v1/sign/${token}`).expect(200);

    await ownerQuery(
      `UPDATE "Recipient" SET "tokenExpiresAt" = now() - interval '1 minute' WHERE id = $1`,
      [patId],
    );
    const expired = await request(t.http).get(`/api/v1/sign/${token}`).expect(401);
    expect(expired.body.code).toBe('TOKEN_EXPIRED');

    // A document closing within minutes caps the link at its own deadline.
    const soon = person('Soon Signer');
    const short = await sent([soon]);
    await linkFor(worker.mailbox, soon.email);
    await ownerQuery(
      `UPDATE "Envelope" SET "expiresAt" = now() + interval '5 minutes' WHERE id = $1`,
      [short.id],
    );
    const res = await start(short.id, short.recipients[0]?.id ?? '').expect(200);
    const left = new Date(res.body.expiresAt).getTime() - Date.now();
    expect(left).toBeGreaterThan(4 * 60_000);
    expect(left).toBeLessThanOrEqual(5 * 60_000);
  });
});
