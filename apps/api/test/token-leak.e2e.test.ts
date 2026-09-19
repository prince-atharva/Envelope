import { createHmac, randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EmailJobData } from '../src/mail/mail.types';
import { EMAIL_QUEUE } from '../src/queue/queue.module';
import { RedisService } from '../src/redis/redis.service';
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
  tokenIn,
} from './helpers/signing';
import { TEST_ENV } from './test-env';

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
 * The token-leak audit (docs/14, step 10): one full signing flow through every
 * route that handles a signing link, then a search for every link ever emailed
 * in everything the system keeps or returns. Verified, not assumed.
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
  /** Every raw token emailed during the flow, including replaced ones. */
  let tokens: string[] = [];
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
    expect(found, `a signing link was found in ${where}`).toEqual([]);
  }

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    await t.app.get<Queue<EmailJobData>>(getQueueToken(EMAIL_QUEUE)).obliterate({ force: true });
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

    logged = logs.calls();
    loggedText = logs.text();
    tokens = [
      ...new Set(
        worker.mailbox.messages.flatMap((message) =>
          [...`${message.text}\n${message.html}`.matchAll(/\/sign\/([0-9a-f]{64})/g)].map(
            (match) => match[1] ?? '',
          ),
        ),
      ),
    ];
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
    logs.restore();
  });

  it('found every link it is looking for', () => {
    // Invitation to each signer, and the reminder's replacement.
    expect(tokens).toHaveLength(3);
    expect(tokens).toContain(rotated);
    for (const token of tokens) expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hands no link to a logger', () => {
    // The signing code did log, by reference.
    expect(logged.some((call) => typeof call.fields.tokenRef === 'string')).toBe(true);
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
    expectNoToken('Redis', text);
  });
});
