import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { WORKFLOW_EXAMPLE } from '@envelope/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makePdf } from './fixtures/pdfs';
import { createTestApp, createTestWorker, type TestApp, type TestWorker } from './helpers/app';
import { registerUser, type SignedInUser } from './helpers/auth';
import { truncateAll } from './helpers/db';
import { bearer, linkFor } from './helpers/signing';

const run = promisify(execFile);

/** The quick-start script the guides print, run for real (docs/18 workstream 13). */
describe('quick-start workflow script (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;
  let directory = '';

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    worker = await createTestWorker();
    owner = await registerUser(t.http, { organization: 'Script Clinic' });
    directory = mkdtempSync(path.join(tmpdir(), 'workflow-'));
    writeFileSync(path.join(directory, 'agreement.pdf'), await makePdf(1));
    writeFileSync(path.join(directory, 'workflow.sh'), WORKFLOW_EXAMPLE);
  });
  afterAll(async () => {
    rmSync(directory, { recursive: true, force: true });
    await worker.close();
    await t.close();
  });

  it('uploads, prepares and sends a document without hand-editing any id', async () => {
    const created = await request(t.http)
      .post('/api/v1/api-keys')
      .set('Authorization', bearer(owner))
      .send({ label: 'Script' })
      .expect(201);
    await new Promise<void>((resolve) => t.http.listen(0, '127.0.0.1', resolve));
    const { port } = t.http.address() as AddressInfo;

    const { stdout } = await run('bash', ['workflow.sh'], {
      cwd: directory,
      env: {
        PATH: process.env.PATH ?? '',
        ENVELOPE_URL: `http://127.0.0.1:${port}`,
        ENVELOPE_API_KEY: created.body.rawKey,
      },
    });
    const sent = JSON.parse(stdout) as { id: string; status: string };
    expect(sent.status).toBe('SENT');

    // The worker records EMAIL_SENT after send returns (AGENTS.md §6).
    await linkFor(worker.mailbox, 'alex@example.com');
    const detail = await request(t.http)
      .get(`/api/v1/envelopes/${sent.id}`)
      .set('Authorization', bearer(owner))
      .expect(200);
    expect(detail.body.status).toBe('SENT');
    expect(detail.body.recipients).toHaveLength(1);
    expect(detail.body.fields).toHaveLength(1);
    expect(detail.body.title).toBe('Consulting agreement');
  });
});
