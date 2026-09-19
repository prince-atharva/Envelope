import { createHash, createHmac, randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMAIL_QUEUE, SEAL_QUEUE } from '../src/queue/queue.module';
import { RedisService } from '../src/redis/redis.service';
import { hashDownloadToken } from '../src/signing/signing-token';
import { makePdf } from './fixtures/pdfs';
import { makePng, pngDataUrl } from './fixtures/png';
import {
  captureLogs,
  createTestApp,
  createTestWorker,
  type LogCall,
  type TestApp,
  type TestWorker,
  waitFor,
} from './helpers/app';
import { registerUser, type SignedInUser } from './helpers/auth';
import { ownerQuery, truncateAll } from './helpers/db';
import {
  bearer,
  emailsTo,
  linkFor,
  type PreparedEnvelope,
  prepareEnvelope,
  sendEnvelope,
  signAs,
  tokenIn,
} from './helpers/signing';
import { TEST_ENV } from './test-env';

// Every completion email in this file carries a download link, not the file,
// so the audit covers those tokens too (docs/15 step 9). Test files run in
// their own workers, so no other file sees this.
process.env.COMPLETION_ATTACHMENT_MAX_BYTES = '1000';

const DOWNLOAD_LINK = /\/download\/([0-9a-f]{64})/g;

const hmac = (token: string) =>
  createHmac('sha256', TEST_ENV.SIGNING_TOKEN_SECRET ?? '')
    .update(token)
    .digest('hex');

/** Everything a Redis key holds, whatever its type. */
function readRedisValue(redis: Redis, key: string, type: string): Promise<unknown> {
  switch (type) {
    case 'string':
      return redis.get(key);
    case 'hash':
      return redis.hgetall(key);
    case 'list':
      return redis.lrange(key, 0, -1);
    case 'set':
      return redis.smembers(key);
    case 'zset':
      return redis.zrange(key, '0', '-1');
    case 'stream':
      return redis.xrange(key, '-', '+');
    default:
      throw new Error(`Redis key ${key} has type ${type}, which the audit cannot read`);
  }
}

/**
 * The token-leak audit (docs/14, step 10; extended in docs/15 step 9): one
 * signing flow through every route that handles a signing link, ending in a
 * decline; a second that is signed, sealed and completed, whose completion
 * emails carry download links that are then used; then a search for every
 * signing and download token ever emailed in everything the system keeps or
 * returns. Verified, not assumed.
 *
 * The real log files are audited by the browser tests (apps/web/e2e/token-leak.spec.ts),
 * which run the API and worker as real processes that write them.
 */
describe('signing-link leak audit (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;
  let envelope: PreparedEnvelope;
  const logs = captureLogs();
  /** Every response of the flow: status, headers and body. */
  const responses: string[] = [];
  /** Every raw token emailed during the flows, signing and download, including replaced ones. */
  let tokens: string[] = [];
  let signingTokens: string[] = [];
  let downloadTokens: string[] = [];
  /** The fingerprint of a PDF checked on Verify that matches nothing: never logged. */
  let unknownFingerprint = '';
  let rotated = '';
  /** What the flow handed to loggers. Taken in beforeAll, since mocks are cleared per test. */
  let logged: LogCall[] = [];
  let loggedText = '';

  const UA = 'Mozilla/5.0 (token-leak audit)';
  const route = (token: string, path = '') => `/api/v1/sign/${token}${path}`;

  function keep(res: Response): Response {
    const body = Buffer.isBuffer(res.body) ? res.body.toString('latin1') : res.body;
    responses.push(JSON.stringify({ status: res.status, headers: res.headers, body }));
    return res;
  }
  const get = async (token: string, path = '') =>
    keep(await request(t.http).get(route(token, path)).set('User-Agent', UA));
  const post = async (token: string, path: string, body: object) =>
    keep(await request(t.http).post(route(token, path)).set('User-Agent', UA).send(body));

  /** On failure, shows where each link was found, with the link itself masked. */
  function expectNoToken(where: string, haystack: string) {
    const found = tokens
      .filter((token) => haystack.includes(token))
      .map((token) => {
        const at = haystack.indexOf(token);
        return haystack.slice(Math.max(0, at - 100), at + 164).replaceAll(token, '<TOKEN>');
      });
    expect(found, `a signing or download link was found in ${where}`).toEqual([]);
  }

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    for (const name of [EMAIL_QUEUE, SEAL_QUEUE]) {
      await t.app.get<Queue>(getQueueToken(name)).obliterate({ force: true });
    }
    worker = await createTestWorker();
    owner = await registerUser(t.http, { fullName: 'Audit Owner', organization: 'Audit Clinic' });

    const [first, second] = [
      { name: 'Audit First', email: 'audit.first@example.com' },
      { name: 'Audit Second', email: 'audit.second@example.com' },
    ];
    envelope = await prepareEnvelope(t.http, owner, [first, second], {
      sequential: true,
      upload: true,
    });

    // Send, then send again with the same key: the replay comes from Redis.
    const key = randomUUID();
    expect(keep(await sendEnvelope(t.http, owner, envelope.id, {}, key)).status).toBe(200);
    const replay = keep(await sendEnvelope(t.http, owner, envelope.id, {}, key));
    expect(replay.headers['idempotency-replayed']).toBe('true');

    // The first signer goes through every step, then comes back to a spent link.
    const one = await linkFor(worker.mailbox, first.email);
    const session = await get(one);
    expect(session.status).toBe(200);
    expect((await get(one, '/document')).status).toBe(403);
    const agreed = await post(one, '/consent', {
      agreed: true,
      consentTextHash: session.body.consentTextHash,
    });
    expect(agreed.status).toBe(200);
    expect((await get(one, '/document')).status).toBe(200);
    for (const [kind, method, png] of [
      ['SIGNATURE', 'DRAWN', makePng()],
      ['INITIALS', 'TYPED', makePng(120, 60)],
    ] as const) {
      expect((await post(one, '/adopt', { kind, method, image: pngDataUrl(png) })).status).toBe(
        200,
      );
    }
    const box = envelope.fields.find(
      (f) => f.type === 'CHECKBOX' && f.recipientId === envelope.recipients[0]?.id,
    );
    expect((await post(one, '/submit', { fields: [{ id: box?.id, value: 'true' }] })).status).toBe(
      202,
    );
    expect((await post(one, '/submit', { fields: [] })).status).toBe(410);
    expect((await get(one)).status).toBe(410);

    // The second signer is invited, then reminded with a new link.
    const two = await linkFor(worker.mailbox, second.email);
    const secondId = envelope.recipients[1]?.id;
    await waitFor(async () => {
      const { rows } = await ownerQuery<{ notifiedAt: Date | null }>(
        `SELECT "notifiedAt" FROM "Recipient" WHERE id = $1`,
        [secondId],
      );
      return rows[0]?.notifiedAt ? true : undefined;
    });
    const reminded = keep(
      await request(t.http)
        .post(`/api/v1/envelopes/${envelope.id}/remind`)
        .set('Authorization', bearer(owner))
        .send({}),
    );
    expect(reminded.status).toBe(200);
    rotated = tokenIn(await waitFor(() => emailsTo(worker.mailbox, second.email, 'reminder')[0]));
    await waitFor(async () => {
      const { rows } = await ownerQuery<{ tokenHash: string | null }>(
        `SELECT "tokenHash" FROM "Recipient" WHERE id = $1`,
        [secondId],
      );
      return rows[0]?.tokenHash === hmac(rotated) ? true : undefined;
    });

    // The replaced link is refused, and hammering it hits the per-link limit.
    expect((await get(two)).status).toBe(401);
    const wrong = { agreed: true, consentTextHash: 'e'.repeat(64) };
    for (let i = 0; i < 10; i += 1) expect((await post(two, '/consent', wrong)).status).toBe(401);
    expect((await post(two, '/consent', wrong)).status).toBe(429);

    // The new link works, and declining ends the envelope for everyone.
    expect((await get(rotated)).status).toBe(200);
    expect((await post(rotated, '/decline', { reason: 'Clause 4 is wrong.' })).status).toBe(200);
    expect((await get(rotated)).status).toBe(409);
    expect((await get(one)).status).toBe(409);

    // Links that were never issued.
    expect((await get('not-a-token')).status).toBe(401);
    expect((await get('0'.repeat(64))).status).toBe(401);

    // What the sender sees, once the worker has told them about the decline.
    await waitFor(() => emailsTo(worker.mailbox, owner.email, 'declined')[0]);
    keep(
      await request(t.http)
        .get(`/api/v1/envelopes/${envelope.id}`)
        .set('Authorization', bearer(owner)),
    );

    // A second envelope goes all the way: signed, sealed, and the finished
    // document sent to everyone as a download link.
    const closer = { name: 'Audit Closer', email: 'audit.closer@example.com' };
    const sealedEnvelope = await prepareEnvelope(t.http, owner, [closer], { upload: true });
    expect(keep(await sendEnvelope(t.http, owner, sealedEnvelope.id)).status).toBe(200);
    await signAs(
      t.http,
      await linkFor(worker.mailbox, closer.email),
      sealedEnvelope,
      sealedEnvelope.recipients[0]?.id ?? '',
    );
    const completed = await waitFor(() => {
      const found = [closer.email, owner.email].map(
        (to) => emailsTo(worker.mailbox, to, 'completed')[0],
      );
      return found.every(Boolean) ? found : undefined;
    }, 30_000);
    for (const message of completed) {
      const [, token] = /\/download\/([0-9a-f]{64})/.exec(message?.text ?? '') ?? [];
      const download = keep(
        await request(t.http).get(`/api/v1/download/${token}`).set('User-Agent', UA),
      );
      expect(download.status).toBe(200);
      // And Verify, with the file it gave.
      const verified = keep(
        await request(t.http)
          .post('/api/v1/verify')
          .attach('file', download.body as Buffer, {
            filename: 'finished.pdf',
            contentType: 'application/pdf',
          }),
      );
      expect(verified.body.verified).toBe(true);
    }
    expect(keep(await request(t.http).get(`/api/v1/download/${'1'.repeat(64)}`)).status).toBe(404);
    const unknown = await makePdf(1);
    unknownFingerprint = createHash('sha256').update(unknown).digest('hex');
    const noMatch = keep(
      await request(t.http)
        .post('/api/v1/verify')
        .attach('file', unknown, { filename: 'private.pdf', contentType: 'application/pdf' }),
    );
    expect(noMatch.body.verified).toBe(false);
    keep(
      await request(t.http)
        .get(`/api/v1/envelopes/${sealedEnvelope.id}`)
        .set('Authorization', bearer(owner)),
    );

    logged = logs.calls();
    loggedText = logs.text();
    const emailed = (pattern: RegExp) => [
      ...new Set(
        worker.mailbox.messages.flatMap((message) =>
          [...`${message.text}\n${message.html}`.matchAll(pattern)].map((match) => match[1] ?? ''),
        ),
      ),
    ];
    signingTokens = emailed(/\/sign\/([0-9a-f]{64})/g);
    downloadTokens = emailed(DOWNLOAD_LINK);
    tokens = [...signingTokens, ...downloadTokens];
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
    logs.restore();
  });

  it('found every link it is looking for', () => {
    // Invitation to each signer, the reminder's replacement, and the closer's invitation.
    expect(signingTokens).toHaveLength(4);
    expect(signingTokens).toContain(rotated);
    // A download link each for the closer and the sender.
    expect(downloadTokens).toHaveLength(2);
    for (const token of tokens) expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never logs the fingerprint of a file that matched nothing', () => {
    expect(loggedText).toContain('Document verified');
    expect(loggedText).not.toContain(unknownFingerprint);
  });

  it('hands no link to a logger', () => {
    // The signing and download code did log, by reference.
    expect(logged.some((call) => typeof call.fields.tokenRef === 'string')).toBe(true);
    expect(
      logged.some(
        (call) => call.message === 'Finished document downloaded' && call.fields.tokenRef,
      ),
    ).toBe(true);
    expectNoToken('the log calls', loggedText);
  });

  it('returns no link in any response body or header', () => {
    expect(responses.length).toBeGreaterThan(25);
    expectNoToken('the responses', responses.join('\n'));
  });

  it('stores no link in any table', async () => {
    const { rows: tables } = await ownerQuery<{ name: string }>(
      `SELECT table_name AS name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    const dump: string[] = [];
    for (const { name } of tables) {
      const { rows } = await ownerQuery<{ row: string }>(
        `SELECT row_to_json(t)::text AS row FROM "${name.replaceAll('"', '""')}" t`,
      );
      dump.push(...rows.map((r) => r.row));
    }
    const text = dump.join('\n');

    // The rows about this flow were really searched: the hash is kept, the token is not.
    expect(tables.map((table) => table.name)).toEqual(
      expect.arrayContaining(['Recipient', 'AuditTrail', 'Envelope', 'DocumentField']),
    );
    expect(text).toContain(hmac(rotated));
    expect(text).toContain('RECIPIENT_DECLINED');
    // The sealed envelope is there too, its download links kept only as HMACs.
    expect(text).toContain('ENVELOPE_COMPLETED');
    for (const token of downloadTokens) {
      expect(text).toContain(hashDownloadToken(TEST_ENV.SIGNING_TOKEN_SECRET ?? '', token));
    }
    expectNoToken('the database', text);
  });

  it('keeps no link in any Redis key or value', async () => {
    const redis = t.app.get(RedisService).client;
    const entries: string[] = [];
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'COUNT', '500');
      cursor = next;
      for (const key of keys) {
        const type = await redis.type(key);
        entries.push(JSON.stringify({ key, type, value: await readRedisValue(redis, key, type) }));
      }
    } while (cursor !== '0');
    const text = entries.join('\n');

    // The idempotency cache and the email queue were both there to search.
    expect(text).toContain(`${TEST_ENV.QUEUE_PREFIX}:idempotency:`);
    expect(text).toContain(`${TEST_ENV.QUEUE_PREFIX}:${EMAIL_QUEUE}:`);
    // Seal jobs too: they carry only ids.
    expect(text).toContain(`${TEST_ENV.QUEUE_PREFIX}:${SEAL_QUEUE}:`);
    expectNoToken('Redis', text);
  });
});
