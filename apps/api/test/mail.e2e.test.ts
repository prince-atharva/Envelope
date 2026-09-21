import { getQueueToken } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import request from 'supertest';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest';
import type { EmailJobData } from '../src/mail/mail.types';
import { MailTransportService } from '../src/mail/mail-transport.service';
import { EMAIL_MAX_ATTEMPTS, EMAIL_QUEUE } from '../src/queue/queue.module';
import {
  captureLogs,
  createTestApp,
  createTestWorker,
  type TestApp,
  type TestWorker,
  waitFor,
} from './helpers/app';
import { nextClientIp, TEST_PASSWORD, uniqueEmail } from './helpers/auth';
import { truncateAll } from './helpers/db';

describe('email (e2e)', () => {
  let api: TestApp;
  let worker: TestWorker;
  let queue: Queue<EmailJobData>;
  const logs = captureLogs();
  // Only these test-specific spies are restored; the log capture stays in place.
  const spies: MockInstance[] = [];

  const register = (email: string, requestId: string, fullName = 'Asha Rao') =>
    request(api.http)
      .post('/api/v1/auth/register')
      .set('X-Forwarded-For', nextClientIp())
      .set('X-Request-Id', requestId)
      .send({ fullName, email, password: TEST_PASSWORD, organization: 'Lotus Clinic' })
      .expect(201);

  beforeAll(async () => {
    await truncateAll();
    api = await createTestApp();
    queue = api.app.get<Queue<EmailJobData>>(getQueueToken(EMAIL_QUEUE));
    await queue.obliterate({ force: true });
    worker = await createTestWorker();
  });

  afterAll(async () => {
    await worker.close();
    await api.close();
    logs.restore();
  });

  beforeEach(() => {
    worker.mailbox.clear();
    logs.clear();
  });

  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
  });

  it('sends a welcome email through the worker after sign-up', async () => {
    const email = uniqueEmail('welcome');
    const res = await register(email, 'mail-e2e-request-0001', 'Asha <b>Rao</b>');
    const userId = (res.body as { user: { id: string } }).user.id;

    const message = await waitFor(() => worker.mailbox.messages.find((m) => m.to === email));
    expect(message).toMatchObject({
      template: 'welcome',
      from: 'Envelope powered by HealthProHub <no-reply@test.local>',
      subject: 'Welcome to Envelope powered by HealthProHub',
    });
    expect(message.text).toContain('Hi Asha <b>Rao</b>,');
    expect(message.html).toContain('Asha &lt;b&gt;Rao&lt;/b&gt;');
    expect(message.html).toContain('Lotus Clinic');

    // The job remembers which API request queued it, so worker logs can be joined up.
    const job = (await queue.getJob(`welcome-${userId}`)) as Job<EmailJobData>;
    expect(job.data.requestId).toBe('mail-e2e-request-0001');
    await waitFor(async () => ((await job.isCompleted()) ? true : undefined));

    expect(logs.find('Email job enqueued', 'info')[0]?.fields).toMatchObject({
      jobId: `welcome-${userId}`,
      template: 'welcome',
      to: 'w***@example.test',
    });
    expect(logs.find('Email job started', 'info')).toHaveLength(1);
    expect(logs.find('Email sent', 'info')[0]?.fields).toMatchObject({
      template: 'welcome',
      to: 'w***@example.test',
      transport: 'memory',
      accepted: expect.any(Number),
    });
    expect(logs.find('Email job completed', 'info')).toHaveLength(1);
    // The full address only ever appears in the message itself, never in a log call.
    expect(logs.text()).not.toContain(email);
  });

  it('retries a failed send and logs each failure', async () => {
    spies.push(
      vi
        .spyOn(MailTransportService.prototype, 'send')
        .mockRejectedValueOnce(
          Object.assign(new Error('421 4.7.0 Try again later'), { responseCode: 421 }),
        ),
    );
    const email = uniqueEmail('retry');
    await register(email, 'mail-e2e-request-0002');

    await waitFor(() => worker.mailbox.messages.find((m) => m.to === email));
    const retried = logs.find('Email job failed; it will be retried', 'warn');
    expect(retried).toHaveLength(1);
    expect(retried[0]?.fields).toMatchObject({
      attemptsMade: 1,
      maxAttempts: EMAIL_MAX_ATTEMPTS,
      requestId: 'mail-e2e-request-0002',
    });
  });

  it('raises an alert when an email fails on every attempt', async () => {
    spies.push(
      vi
        .spyOn(MailTransportService.prototype, 'send')
        .mockRejectedValue(new Error('535 5.7.8 Username and Password not accepted')),
    );
    await register(uniqueEmail('broken'), 'mail-e2e-request-0003');

    const permanent = await waitFor(() => {
      const found = logs.find('Email job failed permanently', 'error');
      return found.length > 0 ? found : undefined;
    });
    expect(permanent[0]?.fields).toMatchObject({
      alert: true,
      attemptsMade: EMAIL_MAX_ATTEMPTS,
      requestId: 'mail-e2e-request-0003',
    });
    expect(logs.find('Email job failed; it will be retried', 'warn')).toHaveLength(
      EMAIL_MAX_ATTEMPTS - 1,
    );
  });

  it('still creates the account if the queue is unavailable', async () => {
    spies.push(vi.spyOn(queue, 'add').mockRejectedValueOnce(new Error('Redis connection lost')));
    await register(uniqueEmail('noqueue'), 'mail-e2e-request-0004');
    expect(logs.find('Welcome email could not be queued', 'error')).toHaveLength(1);
  });
});
