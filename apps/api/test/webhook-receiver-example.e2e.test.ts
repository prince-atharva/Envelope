import { type ChildProcess, spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WEBHOOK_RECEIVER } from '@envelope/shared';
import { afterEach, describe, expect, it } from 'vitest';

describe('webhook receiver example', () => {
  const secret = 'example-only-secret';
  let directory = '';
  let child: ChildProcess | undefined;

  afterEach(() => {
    child?.kill();
    if (directory) rmSync(directory, { recursive: true, force: true });
    child = undefined;
    directory = '';
  });

  async function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const probe = createServer();
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const address = probe.address();
        probe.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
      });
    });
  }

  async function start() {
    directory = mkdtempSync(path.join(tmpdir(), 'receiver-'));
    const file = path.join(directory, 'receiver.mjs');
    const inbox = path.join(directory, 'inbox.ndjson');
    writeFileSync(file, WEBHOOK_RECEIVER);
    const port = await freePort();
    child = spawn(process.execPath, [file], {
      env: {
        PATH: process.env.PATH ?? '',
        ENVELOPE_WEBHOOK_SECRET: secret,
        INBOX_FILE: inbox,
        PORT: String(port),
      },
      stdio: 'ignore',
    });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        await post(`http://127.0.0.1:${port}/health`, {}, '');
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    return { url: `http://127.0.0.1:${port}/webhooks/envelope`, inbox };
  }

  function post(url: string, headers: Record<string, string>, body: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const outgoing = request(url, { method: 'POST', headers }, (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode ?? 0));
      });
      outgoing.once('error', reject);
      outgoing.end(body);
    });
  }

  function signed(body: string, signingSecret = secret) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const digest = createHmac('sha256', signingSecret).update(`${timestamp}.${body}`).digest('hex');
    return { 'X-Signature-Timestamp': timestamp, 'X-Signature': `sha256=${digest}` };
  }

  it('runs as published, stores each event once and refuses a bad signature', async () => {
    const { url, inbox } = await start();
    const body = JSON.stringify({ id: 'evt_1', type: 'envelope.completed', data: { a: 1 } });

    expect(await post(url, signed(body, 'other'), body)).toBe(401);

    for (let delivery = 0; delivery < 2; delivery += 1) {
      expect(await post(url, signed(body), body)).toBe(204);
    }
    const lines = readFileSync(inbox, 'utf8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}').id).toBe('evt_1');

    const malformed = '{"id":1}';
    expect(await post(url, signed(malformed), malformed)).toBe(400);
  });
});
