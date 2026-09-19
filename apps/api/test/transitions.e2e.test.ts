import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { type AuditAction, AuditService } from '../src/audit/audit.service';
import { ExpirySweepService } from '../src/maintenance/expiry-sweep.service';
import { EMAIL_QUEUE, MAINTENANCE_QUEUE, SEAL_QUEUE } from '../src/queue/queue.module';
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
  bearer,
  linkFor,
  type PersonSpec,
  type PreparedEnvelope,
  prepareEnvelope,
  sendEnvelope,
  signAs,
} from './helpers/signing';

let counter = 0;
function person(name: string): PersonSpec {
  counter += 1;
  return { name, email: `${name.toLowerCase().replaceAll(' ', '.')}.${counter}@example.com` };
}

/**
 * Every change of status (docs/16 step 15): each writes exactly one event of
 * the expected action, in the same transaction, so when that write fails the
 * status does not change either.
 */
describe('status transitions (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;

  async function status(id: string) {
    const { rows } = await ownerQuery<{ status: string }>(
      `SELECT status FROM "Envelope" WHERE id = $1`,
      [id],
    );
    return rows[0]?.status;
  }

  async function count(id: string, action: AuditAction) {
    const { rows } = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM "AuditTrail" WHERE "envelopeId" = $1 AND action = $2`,
      [id, action],
    );
    return rows[0]?.n ?? 0;
  }

  /** Makes the audit write of one action fail, as a database error would. */
  function failAuditOf(action: AuditAction) {
    const original = AuditService.prototype.record;
    vi.spyOn(AuditService.prototype, 'record').mockImplementation(async function (
      this: AuditService,
      tx,
      input,
    ) {
      if (input.action === action) throw new Error(`audit write refused for ${action} (test)`);
      return original.call(this, tx, input);
    });
  }

  /**
   * Runs one transition twice: first with its audit write failing, which must
   * leave the status alone and write nothing; then for real, which must change
   * the status and write exactly one event.
   */
  async function transition(
    id: string,
    action: AuditAction,
    from: string,
    to: string,
    act: (failing: boolean) => Promise<unknown>,
  ) {
    expect(await status(id)).toBe(from);
    const before = await count(id, action);

    failAuditOf(action);
    await act(true);
    vi.restoreAllMocks();
    expect(await status(id)).toBe(from);
    expect(await count(id, action)).toBe(before);

    await act(false);
    expect(await status(id)).toBe(to);
    expect(await count(id, action)).toBe(before + 1);
  }

  const post = (path: string, body?: object, headers: Record<string, string> = {}) => {
    const req = request(t.http).post(`/api/v1${path}`).set('Authorization', bearer(owner));
    for (const [name, value] of Object.entries(headers)) req.set(name, value);
    return body ? req.send(body) : req;
  };
  const expectStatus = (failing: boolean, ok: number) => (failing ? 500 : ok);

  async function sentTo(...people: PersonSpec[]): Promise<PreparedEnvelope> {
    const envelope = await prepareEnvelope(t.http, owner, people);
    await sendEnvelope(t.http, owner, envelope.id).expect(200);
    return envelope;
  }

  async function expire(id: string, failing: boolean) {
    await ownerQuery(
      `UPDATE "Envelope" SET "expiresAt" = now() AT TIME ZONE 'UTC' - interval '1 minute'
        WHERE id = $1`,
      [id],
    );
    const result = await worker.module.get(ExpirySweepService).run();
    expect(result.failed).toBe(failing ? 1 : 0);
  }

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    for (const name of [EMAIL_QUEUE, SEAL_QUEUE, MAINTENANCE_QUEUE]) {
      await t.app.get<Queue>(getQueueToken(name)).obliterate({ force: true });
    }
    worker = await createTestWorker();
    owner = await registerUser(t.http, { fullName: 'Transition Owner' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
  });

  it('DRAFT to SENT: send', async () => {
    const envelope = await prepareEnvelope(t.http, owner, [person('Send Me')]);
    await transition(envelope.id, 'ENVELOPE_SENT', 'DRAFT', 'SENT', async (failing) => {
      await sendEnvelope(t.http, owner, envelope.id, {}, randomUUID()).expect(
        expectStatus(failing, 200),
      );
    });
  });

  it('DRAFT to VOIDED: discard', async () => {
    const envelope = await prepareEnvelope(t.http, owner, [person('Discard Me')]);
    await transition(envelope.id, 'ENVELOPE_VOIDED', 'DRAFT', 'VOIDED', async (failing) => {
      await post(`/envelopes/${envelope.id}/void`).expect(expectStatus(failing, 200));
    });
  });

  it('SENT to VOIDED: cancel', async () => {
    const envelope = await sentTo(person('Cancel Me'));
    await transition(envelope.id, 'ENVELOPE_VOIDED', 'SENT', 'VOIDED', async (failing) => {
      await post(`/envelopes/${envelope.id}/void`, { reason: 'Replaced.' }).expect(
        expectStatus(failing, 200),
      );
    });
  });

  it('SENT to DECLINED: decline', async () => {
    const signer = person('Decline Me');
    const envelope = await sentTo(signer);
    const token = await linkFor(worker.mailbox, signer.email);
    await transition(envelope.id, 'RECIPIENT_DECLINED', 'SENT', 'DECLINED', async (failing) => {
      await request(t.http)
        .post(`/api/v1/sign/${token}/decline`)
        .send({ reason: 'Not mine.' })
        .expect(expectStatus(failing, 200));
    });
  });

  it('SENT to PARTIALLY_SIGNED: the first signature', async () => {
    const first = person('Sign First');
    const envelope = await sentTo(first, person('Sign Second'));
    const token = await linkFor(worker.mailbox, first.email);
    const sign = (path: string, body: object) =>
      request(t.http).post(`/api/v1/sign/${token}${path}`).send(body);
    const session = await request(t.http).get(`/api/v1/sign/${token}`).expect(200);
    await sign('/consent', { agreed: true, consentTextHash: session.body.consentTextHash }).expect(
      200,
    );
    await sign('/adopt', { kind: 'SIGNATURE', method: 'DRAWN', image: pngDataUrl() }).expect(200);
    await sign('/adopt', {
      kind: 'INITIALS',
      method: 'TYPED',
      image: pngDataUrl(makePng(120, 60)),
    }).expect(200);
    const box = envelope.fields.find(
      (f) => f.type === 'CHECKBOX' && f.recipientId === envelope.recipients[0]?.id,
    );
    await transition(
      envelope.id,
      'RECIPIENT_SIGNED',
      'SENT',
      'PARTIALLY_SIGNED',
      async (failing) => {
        await sign('/submit', { fields: [{ id: box?.id, value: 'true' }] }).expect(
          expectStatus(failing, 202),
        );
      },
    );
  });

  it('SENT to EXPIRED to SENT to EXPIRED to VOIDED: expire, extend, cancel', async () => {
    const envelope = await sentTo(person('Late Signer'));
    await transition(envelope.id, 'ENVELOPE_EXPIRED', 'SENT', 'EXPIRED', (failing) =>
      expire(envelope.id, failing),
    );
    await transition(envelope.id, 'ENVELOPE_EXTENDED', 'EXPIRED', 'SENT', async (failing) => {
      await post(
        `/envelopes/${envelope.id}/extend`,
        { expiresInDays: 7 },
        { 'Idempotency-Key': randomUUID() },
      ).expect(expectStatus(failing, 200));
    });
    await expire(envelope.id, false);
    await transition(envelope.id, 'ENVELOPE_VOIDED', 'EXPIRED', 'VOIDED', async (failing) => {
      await post(`/envelopes/${envelope.id}/void`, { reason: 'Gave up.' }).expect(
        expectStatus(failing, 200),
      );
    });
  });

  it('PARTIALLY_SIGNED to COMPLETED: the seal, once', async () => {
    const signer = person('Only Signer');
    const envelope = await sentTo(signer);
    await signAs(
      t.http,
      await linkFor(worker.mailbox, signer.email),
      envelope,
      envelope.recipients[0]?.id ?? '',
    );
    await waitFor(
      async () => ((await status(envelope.id)) === 'COMPLETED' ? true : undefined),
      30_000,
    );
    expect(await count(envelope.id, 'ENVELOPE_COMPLETED')).toBe(1);
    expect(await count(envelope.id, 'RECIPIENT_SIGNED')).toBe(1);
  });
});
