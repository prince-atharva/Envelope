import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AlertService } from '../src/alert/alert.service';
import { AuditService } from '../src/audit/audit.service';
import { EMAIL_QUEUE } from '../src/queue/queue.module';
import { RedisService } from '../src/redis/redis.service';
import {
  createTestApp,
  createTestWorker,
  type TestApp,
  type TestWorker,
  waitFor,
} from './helpers/app';
import { registerUser, type SignedInUser } from './helpers/auth';
import { ownerQuery, truncateAll } from './helpers/db';
import { prepareEnvelope } from './helpers/signing';
import { TEST_ENV } from './test-env';

const ALERTS_TO = TEST_ENV.ALERT_EMAIL ?? '';

/** Alerts: always logged, emailed at most once per key per interval (docs/16 step 11). */
describe('alerts (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;

  const alertEmails = (key: string) =>
    worker.mailbox.messages.filter(
      (m) => m.to === ALERTS_TO && m.template === 'alert' && m.text.includes(`Alert: ${key}`),
    );

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    await t.app.get<Queue>(getQueueToken(EMAIL_QUEUE)).obliterate({ force: true });
    worker = await createTestWorker();
    // The gate outlives a run; start each run with none held.
    const redis = t.app.get(RedisService).client;
    const held = await redis.keys(`${TEST_ENV.QUEUE_PREFIX}:alert-gate:*`);
    if (held.length > 0) await redis.del(...held);
    owner = await registerUser(t.http, { fullName: 'Alert Owner' });
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
  });

  it('the worker emails directly, once per key per interval', async () => {
    const alerts = worker.module.get(AlertService);
    await alerts.raise('e2e-worker-alert', 'Worker alert under test', { envelopeId: 'e-1' });
    await alerts.raise('e2e-worker-alert', 'Worker alert under test', { envelopeId: 'e-2' });
    const sent = alertEmails('e2e-worker-alert');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain('Service: worker');
    expect(sent[0]?.text).toContain('envelopeId: e-1');
  });

  it('the API queues it for the worker to send', async () => {
    await t.app.get(AlertService).raise('e2e-api-alert', 'API alert under test', { count: 3 });
    const email = await waitFor(() => alertEmails('e2e-api-alert').at(0));
    expect(email.text).toContain('Service: api');
    expect(email.text).toContain('count: 3');
  });

  it('a broken audit chain raises one', async () => {
    const envelope = await prepareEnvelope(t.http, owner, [
      { name: 'Chain Check', email: 'chain.check@example.com' },
    ]);
    // Only the owner role can change an event; the application role cannot.
    await ownerQuery(
      `UPDATE "AuditTrail" SET "ipAddress" = '203.0.113.9'
        WHERE "envelopeId" = $1 AND sequence = 1`,
      [envelope.id],
    );
    const result = await worker.module.get(AuditService).verify(envelope.id);
    expect(result.valid).toBe(false);
    const email = await waitFor(() => alertEmails('audit-chain-broken').at(0));
    expect(email.text).toContain(`envelopeId: ${envelope.id}`);
    expect(email.text).toContain('brokenAtSequence: 1');
  });
});
