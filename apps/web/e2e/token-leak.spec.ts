import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Browser, expect, type Request, type TestInfo, test } from '@playwright/test';
import { Redis } from 'ioredis';
import pg from 'pg';
import {
  agreeToSign,
  allSigningTokens,
  completedCopyFor,
  outboxMessages,
  prepareToSend,
  sendFromReview,
  signingLinkFor,
  signOnlyBoxes,
  signUp,
  uniqueEmail,
} from './helpers';
import { LOG_DIR, OUTBOX_DIR, STACK_ENV } from './stack/stack.mjs';

/**
 * The token-leak audit on the real stack (docs/14, step 10). The API and worker
 * run as real processes here, so this is where their log files, including the
 * one line per HTTP request, are searched. The API e2e suite
 * (apps/api/test/token-leak.e2e.test.ts) covers response bodies in detail.
 */

/** A browser of the same kind as the test's project, with nothing of the sender's in it. */
function signerContext(browser: Browser, testInfo: TestInfo) {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL, extraHTTPHeaders } =
    testInfo.project.use;
  return browser.newContext({
    viewport,
    userAgent,
    deviceScaleFactor,
    isMobile,
    hasTouch,
    baseURL,
    extraHTTPHeaders,
  });
}

async function outboxHas(to: string, template: string): Promise<boolean> {
  for (const file of await outboxMessages()) {
    const message = JSON.parse(await readFile(join(OUTBOX_DIR, file), 'utf8')) as {
      to: string;
      template: string;
    };
    if (message.to === to && message.template === template) return true;
  }
  return false;
}

async function readLogFiles(): Promise<string> {
  const files = await readdir(LOG_DIR);
  const contents = await Promise.all(files.map((file) => readFile(join(LOG_DIR, file), 'utf8')));
  return contents.join('\n');
}

async function dumpDatabase(): Promise<string> {
  const client = new pg.Client({ connectionString: STACK_ENV.DIRECT_DATABASE_URL });
  await client.connect();
  try {
    const { rows: tables } = await client.query<{ name: string }>(
      `SELECT table_name AS name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    const dump: string[] = [];
    for (const { name } of tables) {
      const { rows } = await client.query<{ row: string }>(
        `SELECT row_to_json(t)::text AS row FROM "${name.replaceAll('"', '""')}" t`,
      );
      dump.push(...rows.map((r) => r.row));
    }
    return dump.join('\n');
  } finally {
    await client.end();
  }
}

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

/** Every key and value in the stack's Redis database. */
async function dumpRedis(): Promise<string> {
  const redis = new Redis(STACK_ENV.REDIS_URL, { lazyConnect: true });
  await redis.connect();
  try {
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
    return entries.join('\n');
  } finally {
    redis.disconnect();
  }
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/**
 * Stores a completion download link for the envelope, the way the email
 * worker does for a file too large to attach: only the token's HMAC, taken
 * under the download label (apps/api/src/signing/signing-token.ts). The
 * browser stack attaches files instead, so the link is made here to put a
 * real download request through the real API and its log files.
 */
async function insertDownloadLink(envelopeId: string, rawToken: string): Promise<string> {
  const tokenHash = createHmac('sha256', STACK_ENV.SIGNING_TOKEN_SECRET)
    .update('completion-download\0')
    .update(rawToken)
    .digest('hex');
  const client = new pg.Client({ connectionString: STACK_ENV.DIRECT_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO "CompletionDownload" (id, "envelopeId", "tokenHash", "expiresAt")
       VALUES ($1, $2, $3, now() + interval '1 day')`,
      [randomUUID(), envelopeId, tokenHash],
    );
  } finally {
    await client.end();
  }
  return tokenHash;
}

/** On failure, shows where each link was found, with the link itself masked. */
function expectNoToken(tokens: string[], where: string, haystack: string) {
  const found = tokens
    .filter((token) => haystack.includes(token))
    .map((token) => {
      const at = haystack.indexOf(token);
      return haystack.slice(Math.max(0, at - 100), at + 164).replaceAll(token, '<TOKEN>');
    });
  expect(found, `a signing or download link was found in ${where}`).toEqual([]);
}

test('no signing or download link reaches a log file, the database, Redis or a Referer header', async ({
  browser,
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const signer = await signerContext(browser, testInfo);
  const requests: Request[] = [];
  signer.on('request', (request) => requests.push(request));
  const signerPage = await signer.newPage();

  const senderEmail = await signUp(page, 'sender');
  const first = { name: 'Leak First', email: uniqueEmail('leak.first') };
  const second = { name: 'Leak Second', email: uniqueEmail('leak.second') };
  const envelopeId = await prepareToSend(page, [first, second], { oneAfterAnother: true });
  await sendFromReview(page);

  // The first person signs.
  const firstLink = await signingLinkFor(first.email);
  await signerPage.goto(firstLink);
  await agreeToSign(signerPage);
  await signerPage
    .getByRole('button', { name: /^Signature field, required, page 1 of 12/ })
    .click();
  const sheet = signerPage.getByRole('dialog', { name: 'Adopt your signature' });
  await sheet.getByRole('button', { name: 'Adopt and sign' }).click();
  await expect(sheet).toBeHidden();
  await signerPage
    .getByRole('checkbox', { name: 'Tick box field, required, page 1 of 12' })
    .check();
  await signerPage.getByRole('button', { name: 'Finish' }).click();
  await expect(signerPage.getByRole('heading', { name: 'Signed' })).toBeVisible();

  // Now it is the second person's turn. The sender reminds them, which replaces their link.
  const invitation = await signingLinkFor(second.email);
  await page.goto(`/dashboard/envelopes/${envelopeId}`);
  const remind = page.getByRole('button', { name: `Send a reminder to ${second.name}` });
  await expect(async () => {
    await page.reload();
    await expect(remind).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await remind.click();
  await expect(page.getByText('Reminder sent')).toBeVisible();
  await expect.poll(() => signingLinkFor(second.email), { timeout: 20_000 }).not.toBe(invitation);
  const replacement = await signingLinkFor(second.email);

  // The old link no longer works; the new one is used to decline.
  await signerPage.goto(invitation);
  await expect(signerPage.getByRole('heading', { name: 'This link does not work' })).toBeVisible();
  await signerPage.goto(replacement);
  await signerPage.getByRole('button', { name: 'Decline to sign' }).click();
  const dialog = signerPage.getByRole('dialog', { name: 'Decline to sign?' });
  await dialog.getByLabel('Reason for declining').fill('The dates in clause 4 are wrong.');
  await dialog.getByRole('button', { name: 'Decline to sign' }).click();
  await expect(
    signerPage.getByRole('heading', { name: 'You declined this document' }),
  ).toBeVisible();

  // A link that was never issued.
  await signerPage.goto('/sign/not-a-real-link');
  await expect(signerPage.getByRole('heading', { name: 'This link does not work' })).toBeVisible();

  // A second envelope goes all the way: sealed by the real worker, and the
  // finished copy emailed (docs/15 step 9).
  const closer = { name: 'Leak Closer', email: uniqueEmail('leak.closer') };
  const sealedId = await prepareToSend(page, [closer]);
  await sendFromReview(page);
  await signOnlyBoxes(signerPage, await signingLinkFor(closer.email));
  const copy = await completedCopyFor(closer.email);

  // Its finished copy, through a download link.
  const downloadToken = randomBytes(32).toString('hex');
  const downloadHash = await insertDownloadLink(sealedId, downloadToken);
  const downloaded = await signer.request.get(`/api/v1/download/${downloadToken}`);
  expect(downloaded.status()).toBe(200);
  expect(sha256(await downloaded.body())).toBe(copy.sha256);

  // A PDF nobody signed, checked on Verify: its fingerprint must not be logged.
  const privatePdf = Buffer.from(`%PDF-1.7\n% private ${randomUUID()}\n%%EOF\n`);
  const checked = await signer.request.post('/api/v1/verify', {
    multipart: { file: { name: 'private.pdf', mimeType: 'application/pdf', buffer: privatePdf } },
  });
  expect(((await checked.json()) as { verified: boolean }).verified).toBe(false);

  // No request from the signing pages told anyone where it came from.
  const headers = await Promise.all(requests.map((request) => request.allHeaders()));
  await signer.close();

  // The worker has finished: the sender has been told about the decline.
  await expect.poll(() => outboxHas(senderEmail, 'declined'), { timeout: 20_000 }).toBe(true);

  const tokens = [...(await allSigningTokens()), downloadToken];
  for (const link of [firstLink, invitation, replacement]) {
    expect(tokens).toContain(link.split('/sign/')[1]);
  }

  expect(requests.length).toBeGreaterThan(10);
  expectNoToken(
    tokens,
    'a Referer header',
    headers.map((header) => header.referer ?? '').join('\n'),
  );

  // Log writes are buffered: wait until this run's last request lines are in the files,
  // which also shows the search covers the per-request lines.
  await expect
    .poll(readLogFiles, { timeout: 20_000 })
    .toContain('"url":"/api/v1/sign/[redacted]/decline"');
  await expect
    .poll(readLogFiles, { timeout: 20_000 })
    .toContain('"url":"/api/v1/download/[redacted]"');
  const logs = await readLogFiles();
  expect(logs).toContain('Signing link emailed');
  // The worker's sealing and the download were logged, by reference only.
  expect(logs).toContain('Envelope sealed');
  expect(logs).toContain('Finished document downloaded');
  expectNoToken(tokens, 'the log files', logs);
  expect(logs).toContain('Document verified');
  expect(logs, 'the fingerprint of an unmatched file was logged').not.toContain(sha256(privatePdf));

  const database = await dumpDatabase();
  expect(database).toContain(envelopeId);
  expect(database).toContain('RECIPIENT_DECLINED');
  expect(database).toContain('ENVELOPE_COMPLETED');
  expect(database).toContain(downloadHash);
  expectNoToken(tokens, 'the database', database);

  const redis = await dumpRedis();
  expect(redis).toContain(`${STACK_ENV.QUEUE_PREFIX}:idempotency:`);
  expect(redis).toContain(`${STACK_ENV.QUEUE_PREFIX}:email:`);
  expect(redis).toContain(`${STACK_ENV.QUEUE_PREFIX}:seal:`);
  expectNoToken(tokens, 'Redis', redis);
});
