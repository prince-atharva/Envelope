import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type {
  CreateWebhookEndpointResponse,
  EnvelopeDetail,
  WebhookDeliverySummary,
} from '@envelope/shared';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EmailJobData } from '../src/mail/mail.types';
import { ExpirySweepService } from '../src/maintenance/expiry-sweep.service';
import { EMAIL_QUEUE, WEBHOOK_DELIVERY_QUEUE } from '../src/queue/queue.module';
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

let counter = 0;
function person(name: string, extra: Partial<PersonSpec> = {}): PersonSpec {
  counter += 1;
  return {
    name,
    email: `${name.toLowerCase().replaceAll(' ', '.')}.${counter}@example.com`,
    ...extra,
  };
}

/** Passing a part to someone else (docs/22, ADR 0032). */
describe('delegation (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;
  let outsider: SignedInUser;
  let receiver: http.Server;
  let endpointId: string;

  beforeAll(async () => {
    process.env.WEBHOOK_ALLOW_INSECURE_LOCAL_URLS = 'true';
    await truncateAll();
    t = await createTestApp();
    await t.app.get<Queue<EmailJobData>>(getQueueToken(EMAIL_QUEUE)).obliterate({ force: true });
    await t.app.get<Queue>(getQueueToken(WEBHOOK_DELIVERY_QUEUE)).obliterate({ force: true });
    worker = await createTestWorker();
    owner = await registerUser(t.http, {
      fullName: 'Dana Owner',
      organization: 'Delegation Clinic',
    });
    outsider = await registerUser(t.http, { organization: 'Elsewhere Clinic' });

    receiver = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => res.writeHead(200).end('{}'));
    });
    await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', () => resolve()));
    const created = await request(t.http)
      .post('/api/v1/webhooks')
      .set('Authorization', bearer(owner))
      .send({
        url: `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`,
        subscribedEvents: ['recipient.delegated'],
      })
      .expect(201);
    endpointId = (created.body as CreateWebhookEndpointResponse).endpoint.id;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => receiver.close(() => resolve()));
    delete process.env.WEBHOOK_ALLOW_INSECURE_LOCAL_URLS;
    await worker.close();
    await t.close();
  });

  const api = (token: string, path = '') => `/api/v1/sign/${token}${path}`;
  const delegate = (token: string, body: object) =>
    request(t.http).post(api(token, '/delegate')).send(body);

  async function detail(id: string): Promise<EnvelopeDetail> {
    const res = await request(t.http)
      .get(`/api/v1/envelopes/${id}`)
      .set('Authorization', bearer(owner))
      .expect(200);
    return res.body as EnvelopeDetail;
  }

  async function sent(
    people: PersonSpec[],
    options: { allow?: boolean; sequential?: boolean } = {},
  ) {
    const envelope = await prepareEnvelope(t.http, owner, people, {
      sequential: options.sequential,
    });
    await sendEnvelope(
      t.http,
      owner,
      envelope.id,
      options.allow === false ? {} : { allowDelegation: true },
    ).expect(200);
    return envelope;
  }

  it('is off unless the sender allows it, and says so', async () => {
    const asha = person('Asha Rao');
    const envelope = await sent([asha], { allow: false });
    const token = await linkFor(worker.mailbox, asha.email);

    expect((await request(t.http).get(api(token)).expect(200)).body.allowDelegation).toBe(false);
    const res = await delegate(token, { name: 'Sam Lee', email: 'sam.off@example.com' }).expect(
      403,
    );
    expect(res.body.code).toBe('DELEGATION_NOT_ALLOWED');
    expect((await detail(envelope.id)).allowDelegation).toBe(false);
  });

  it('hands the part over: new link, old link explained, fields moved, everyone told', async () => {
    const asha = person('Asha Rao');
    const sam = person('Sam Lee');
    const envelope = await sent([asha]);
    const oldToken = await linkFor(worker.mailbox, asha.email);
    await request(t.http).get(api(oldToken, '/')).expect(200);

    const res = await delegate(oldToken, { name: sam.name, email: sam.email }).expect(200);
    expect(res.body).toMatchObject({ status: 'DELEGATED', delegateName: 'Sam Lee' });

    // The old link now says what happened, instead of opening the document.
    const refused = await request(t.http).get(api(oldToken)).expect(410);
    expect(refused.body.code).toBe('TOKEN_DELEGATED');
    await request(t.http)
      .post(api(oldToken, '/delegate'))
      .send({ name: 'Eve', email: 'eve@example.com' })
      .expect(410);

    const newToken = await linkFor(worker.mailbox, sam.email);
    expect(newToken).not.toBe(oldToken);
    const session = (await request(t.http).get(api(newToken)).expect(200)).body;
    expect(session.recipientName).toBe('Sam Lee');
    // A delegate cannot pass it on again.
    expect(session.allowDelegation).toBe(false);
    const again = await delegate(newToken, { name: 'Eve', email: 'eve@example.com' }).expect(403);
    expect(again.body.code).toBe('DELEGATION_NOT_ALLOWED');

    const view = await detail(envelope.id);
    const from = view.recipients.find((r) => r.email === asha.email);
    const to = view.recipients.find((r) => r.email === sam.email);
    expect(from).toMatchObject({ status: 'DELEGATED' });
    expect(from?.delegatedAt).toBeTruthy();
    // Opening their session above marked them as having viewed it.
    expect(to).toMatchObject({ status: 'VIEWED', role: 'SIGNER', delegatedFromId: from?.id });
    expect(view.fields.every((f) => f.recipientId === to?.id)).toBe(true);
    expect(view.fields.length).toBe(envelope.fields.length);
    // Counts follow the part, not the person: still one to sign, nobody signed.
    expect(view.progress).toMatchObject({ signed: 0, total: 1, waitingOn: ['Sam Lee'] });

    // The sender and the person who passed it on are told, with no signing link.
    const toSender = await waitFor(() =>
      emailsTo(worker.mailbox, owner.body.user.email, 'delegation-notice').at(-1),
    );
    expect(toSender.subject).toContain('Asha Rao passed');
    const toDelegator = await waitFor(() =>
      emailsTo(worker.mailbox, asha.email, 'delegation-notice').at(-1),
    );
    expect(toDelegator.text).not.toMatch(/\/sign\/[0-9a-f]{64}/);
    expect(emailsTo(worker.mailbox, sam.email, 'delegated')).toHaveLength(1);

    // One audit row, ids only: no address is written into the permanent record.
    const { rows } = await ownerQuery<{ recipientId: string; metadata: Record<string, unknown> }>(
      `SELECT "recipientId", metadata FROM "AuditTrail"
        WHERE "envelopeId" = $1 AND action = 'RECIPIENT_DELEGATED'`,
      [envelope.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.recipientId).toBe(from?.id);
    expect(rows[0]?.metadata).toEqual({ toRecipientId: to?.id });
    expect(JSON.stringify(rows[0]?.metadata)).not.toContain('@');
  });

  it('lets the delegate sign, completes the envelope and says so on the certificate', async () => {
    const asha = person('Asha Rao');
    const sam = person('Sam Lee');
    const envelope = await sent([asha]);
    const oldToken = await linkFor(worker.mailbox, asha.email);
    await delegate(oldToken, { name: sam.name, email: sam.email }).expect(200);
    const token = await linkFor(worker.mailbox, sam.email);
    const view = await detail(envelope.id);
    const to = view.recipients.find((r) => r.email === sam.email);
    await signAs(t.http, token, { ...envelope, fields: view.fields }, to?.id ?? '');

    const final = await waitFor(async () => {
      const { rows } = await ownerQuery<{ fileUrl: string; storageVersionId: string }>(
        `SELECT "fileUrl", "storageVersionId" FROM "DocumentVersion"
          WHERE "envelopeId" = $1 AND "isFinal"`,
        [envelope.id],
      );
      return rows[0];
    });
    expect((await detail(envelope.id)).status).toBe('COMPLETED');
    const sealed = await readSealedObject(final.fileUrl, final.storageVersionId);
    const text = (await pdfPageTexts(sealed.body)).join('\n');
    expect(text).toContain('Delegated by');
    expect(text).toContain('Asha Rao');
    expect(text).toContain('Passed to someone else');
    // Only the person who signed is listed as a signer.
    expect(text.match(/Signed version/g)).toHaveLength(1);

    // The finished copy goes to the person who holds the part, the sender and no one else:
    // not to the person who passed it on.
    await waitFor(() => emailsTo(worker.mailbox, sam.email, 'completed').at(-1));
    await waitFor(() => emailsTo(worker.mailbox, owner.body.user.email, 'completed').at(-1));
    expect(emailsTo(worker.mailbox, asha.email, 'completed')).toHaveLength(0);
  });

  it('refuses an address already on the document, including their own', async () => {
    const asha = person('Asha Rao');
    const ben = person('Ben Ito');
    await sent([asha, ben]);
    const token = await linkFor(worker.mailbox, asha.email);
    for (const email of [ben.email, asha.email]) {
      const res = await delegate(token, { name: 'Someone', email }).expect(409);
      expect(res.body.code).toBe('RECIPIENT_EMAIL_TAKEN');
    }
    expect((await request(t.http).get(api(token)).expect(200)).body.recipientName).toBe('Asha Rao');
  });

  it('keeps the signing order: the next group waits for the delegate', async () => {
    const first = person('First Person');
    const second = person('Second Person');
    const sam = person('Sam Lee');
    const envelope = await sent([first, { ...second, routingOrder: 2 }], { sequential: true });
    const token = await linkFor(worker.mailbox, first.email);
    await delegate(token, { name: sam.name, email: sam.email }).expect(200);
    const samToken = await linkFor(worker.mailbox, sam.email);
    expect(emailsTo(worker.mailbox, second.email)).toHaveLength(0);

    const view = await detail(envelope.id);
    const to = view.recipients.find((r) => r.email === sam.email);
    await signAs(t.http, samToken, { ...envelope, fields: view.fields }, to?.id ?? '');
    // Now it is the second person's turn.
    await linkFor(worker.mailbox, second.email);
  });

  it('does not remind, cancel-notify or wait for someone who passed their part on', async () => {
    const asha = person('Asha Rao');
    const envelope = await sent([asha]);
    const token = await linkFor(worker.mailbox, asha.email);
    const sam = person('Sam Lee');
    await delegate(token, { name: sam.name, email: sam.email }).expect(200);
    await linkFor(worker.mailbox, sam.email);
    await waitFor(() => emailsTo(worker.mailbox, asha.email, 'delegation-notice').at(-1));

    const view = await detail(envelope.id);
    const from = view.recipients.find((r) => r.email === asha.email);
    const reminded = await request(t.http)
      .post(`/api/v1/envelopes/${envelope.id}/remind`)
      .set('Authorization', bearer(owner))
      .send({ recipientIds: [from?.id] })
      .expect(200);
    expect(reminded.body.skipped).toEqual([{ recipientId: from?.id, reason: 'FINISHED' }]);

    await request(t.http)
      .post(`/api/v1/envelopes/${envelope.id}/void`)
      .set('Authorization', bearer(owner))
      .send({ reason: 'Wrong document' })
      .expect(200);
    await waitFor(() => emailsTo(worker.mailbox, sam.email, 'voided').at(-1));
    expect(emailsTo(worker.mailbox, asha.email, 'voided')).toHaveLength(0);
  });

  it('keeps a delegated document inside its workspace', async () => {
    const asha = person('Asha Rao');
    const sam = person('Sam Lee');
    const envelope = await sent([asha]);
    await delegate(await linkFor(worker.mailbox, asha.email), {
      name: sam.name,
      email: sam.email,
    }).expect(200);
    await linkFor(worker.mailbox, sam.email);
    await request(t.http)
      .get(`/api/v1/envelopes/${envelope.id}`)
      .set('Authorization', bearer(outsider))
      .expect(404);
  });

  it('saves a delegated envelope as a template with one role, not a ghost for the delegator', async () => {
    const asha = person('Asha Rao');
    const sam = person('Sam Lee');
    const envelope = await sent([asha]);
    await delegate(await linkFor(worker.mailbox, asha.email), {
      name: sam.name,
      email: sam.email,
    }).expect(200);
    await linkFor(worker.mailbox, sam.email);

    const saved = await request(t.http)
      .post('/api/v1/templates')
      .set('Authorization', bearer(owner))
      .send({ name: 'After delegation', envelopeId: envelope.id })
      .expect(201);
    expect(saved.body.roles).toHaveLength(1);
    expect(saved.body.roles[0].name).toBe('Sam Lee');
  });

  it('fires recipient.delegated with both people, and the audit chain stays valid', async () => {
    const asha = person('Asha Rao');
    const sam = person('Sam Lee');
    const envelope = await sent([asha]);
    const token = await linkFor(worker.mailbox, asha.email);
    await delegate(token, { name: sam.name, email: sam.email }).expect(200);

    const delivery = await waitFor(async () => {
      const res = await request(t.http)
        .get(`/api/v1/webhooks/${endpointId}/deliveries`)
        .set('Authorization', bearer(owner))
        .expect(200);
      return (res.body as WebhookDeliverySummary[]).find(
        (d) => d.eventType === 'recipient.delegated' && d.data.envelopeId === envelope.id,
      );
    });
    expect(delivery.data).toMatchObject({
      fromRecipientEmail: asha.email,
      toRecipientEmail: sam.email,
      envelopeStatus: 'SENT',
    });

    // Every audit row still hashes onto the one before it.
    const { rows } = await ownerQuery<{
      sequence: number;
      prevHash: string | null;
      eventHash: string;
    }>(
      `SELECT sequence, "prevHash", "eventHash" FROM "AuditTrail"
        WHERE "envelopeId" = $1 ORDER BY sequence`,
      [envelope.id],
    );
    rows.forEach((row, index) => {
      expect(row.sequence).toBe(index + 1);
      expect(row.prevHash).toBe(index === 0 ? null : (rows[index - 1]?.eventHash ?? 'x'));
    });
  });

  it('does not count the person who passed their part on as still to sign when it expires', async () => {
    const asha = person('Asha Rao');
    const sam = person('Sam Lee');
    const envelope = await sent([asha]);
    await delegate(await linkFor(worker.mailbox, asha.email), {
      name: sam.name,
      email: sam.email,
    }).expect(200);
    await linkFor(worker.mailbox, sam.email);
    await waitFor(() => emailsTo(worker.mailbox, asha.email, 'delegation-notice').at(-1));

    await ownerQuery(
      `UPDATE "Envelope" SET "expiresAt" = now() - interval '1 minute' WHERE id = $1`,
      [envelope.id],
    );
    await worker.module.get(ExpirySweepService).run(new Date());
    expect((await detail(envelope.id)).status).toBe('EXPIRED');

    const { rows } = await ownerQuery<{ metadata: { unsigned: number } }>(
      `SELECT metadata FROM "AuditTrail" WHERE "envelopeId" = $1 AND action = 'ENVELOPE_EXPIRED'`,
      [envelope.id],
    );
    expect(rows[0]?.metadata.unsigned).toBe(1);
    // The sender is told who is still to sign: the person who holds the part, not the one who passed it on.
    const notice = await waitFor(() =>
      emailsTo(worker.mailbox, owner.body.user.email, 'expired').find((m) =>
        m.text.includes('Sam Lee'),
      ),
    );
    expect(notice.text).not.toContain('Asha Rao');
  });
});
