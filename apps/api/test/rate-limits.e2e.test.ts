import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { RedisThrottlerStorage } from '../src/common/throttling/redis-throttler.storage';
import { RedisService } from '../src/redis/redis.service';
import {
  captureLogs,
  createTestApp,
  createTestWorker,
  type TestApp,
  type TestWorker,
} from './helpers/app';
import { nextClientIp, registerUser, type SignedInUser } from './helpers/auth';
import { truncateAll } from './helpers/db';
import { bearer, linkFor, prepareEnvelope, sendEnvelope } from './helpers/signing';

/** Request limits in Redis, shared by every API server (docs/16 step 13). */
describe('request limits (e2e)', () => {
  let a: TestApp;
  let b: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;

  const login = (app: TestApp, email: string) =>
    request(app.http)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', nextClientIp())
      .send({ email, password: 'not the password' });

  beforeAll(async () => {
    await truncateAll();
    // Two API servers, as in production behind a load balancer.
    a = await createTestApp();
    b = await createTestApp();
    worker = await createTestWorker();
    owner = await registerUser(a.http, { fullName: 'Limit Owner' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await worker.close();
    await Promise.all([a.close(), b.close()]);
  });

  it('holds a limit across two servers, with the rate-limit headers', async () => {
    const email = owner.body.user.email;
    for (let i = 0; i < 5; i += 1) {
      const res = await login(i % 2 === 0 ? a : b, email).expect(401);
      expect(res.headers['x-ratelimit-limit']).toBe('5');
      expect(res.headers['x-ratelimit-remaining']).toBe(String(4 - i));
    }
    // Five failures from five addresses on two servers: the account is held.
    const refused = await login(b, email).expect(429);
    expect(refused.body.code).toBe('RATE_LIMITED');
    const retryAfter = Number(refused.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it('limits cancel, extend, remind and reminder settings per workspace', async () => {
    const envelope = await prepareEnvelope(a.http, owner, [
      { name: 'Limited', email: 'limited@example.com' },
    ]);
    await sendEnvelope(a.http, owner, envelope.id).expect(200);
    const settings = (app: TestApp, as: SignedInUser, id: string) =>
      request(app.http)
        .patch(`/api/v1/envelopes/${id}/reminders`)
        .set('Authorization', bearer(as))
        .send({ intervalDays: 3 });

    for (let i = 0; i < 30; i += 1) await settings(i % 2 ? a : b, owner, envelope.id).expect(200);
    const refused = await settings(a, owner, envelope.id).expect(429);
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(1);

    // Another workspace has its own count.
    const other = await registerUser(a.http, { fullName: 'Other Workspace' });
    const theirs = await prepareEnvelope(a.http, other, [
      { name: 'Theirs', email: 'theirs@example.com' },
    ]);
    await sendEnvelope(a.http, other, theirs.id).expect(200);
    await settings(b, other, theirs.id).expect(200);
  });

  it('tells a signer how long to wait, in seconds', async () => {
    const envelope = await prepareEnvelope(a.http, owner, [
      { name: 'Hasty', email: 'hasty@example.com' },
    ]);
    await sendEnvelope(a.http, owner, envelope.id).expect(200);
    const token = await linkFor(worker.mailbox, 'hasty@example.com');
    const wrong = { agreed: true, consentTextHash: 'e'.repeat(64) };
    for (let i = 0; i < 10; i += 1) {
      await request(a.http).post(`/api/v1/sign/${token}/consent`).send(wrong).expect(409);
    }
    const refused = await request(b.http)
      .post(`/api/v1/sign/${token}/consent`)
      .send(wrong)
      .expect(429);
    // It used to divide seconds by 1000, and always said 1.
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(1);
  });

  it('stores no workspace id, email or link in the keys', async () => {
    const prefix = process.env.RATE_LIMIT_KEY_PREFIX;
    const keys = await a.app.get(RedisService).client.keys(`${prefix}:rl:*`);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).toMatch(/:rl:[a-z-]+:[0-9a-f]{32}$/);
      expect(key).not.toContain(owner.body.user.tenant.id);
      expect(key).not.toContain('@');
    }
  });

  it('keeps limiting in memory when Redis is down, with one alert', async () => {
    const logs = captureLogs();
    const storage = a.app.get(RedisThrottlerStorage);
    vi.spyOn(storage.client, 'eval').mockRejectedValue(new Error('Connection is closed.'));
    const victim = await registerUser(b.http, { fullName: 'Outage Victim' });

    for (let i = 0; i < 5; i += 1) await login(a, victim.body.user.email).expect(401);
    await login(a, victim.body.user.email).expect(429);
    expect(
      logs.find('Rate limits are counted per server: Redis is unavailable', 'error'),
    ).toHaveLength(1);

    vi.mocked(storage.client.eval).mockRestore();
    await login(a, 'recovered@example.com').expect(401);
    expect(logs.find('Rate limits counted in Redis again', 'info')).toHaveLength(1);
  });
});
