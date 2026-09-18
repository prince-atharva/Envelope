import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PinoLogger } from 'nestjs-pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config/app-config';
import { MailTransportService, MemoryMailbox } from './mail-transport.service';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as PinoLogger;

describe('MailTransportService with MAIL_TRANSPORT=file', () => {
  let root: string;
  let service: MailTransportService;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'outbox-test-'));
    const config = {
      MAIL_TRANSPORT: 'file',
      MAIL_OUTBOX_DIR: 'outbox',
      APP_ROOT_DIR: root,
      SMTP_FROM: 'Envelope <no-reply@test.local>',
    } as AppConfig;
    service = new MailTransportService(config, new MemoryMailbox(), logger);
  });

  afterEach(async () => {
    service.onModuleDestroy();
    await rm(root, { recursive: true, force: true });
  });

  it('writes each message to the outbox as JSON, readable only by its owner', async () => {
    await service.send(
      {
        to: 'signer@example.com',
        subject: 'Please sign',
        html: '<p>Hi</p>',
        text: 'Hi',
      },
      'welcome',
    );

    const directory = path.join(root, 'outbox');
    const [name] = await readdir(directory);
    if (!name) throw new Error('no message written');
    const file = path.join(directory, name);
    const message = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;

    expect(message).toMatchObject({
      to: 'signer@example.com',
      subject: 'Please sign',
      text: 'Hi',
      template: 'welcome',
      from: 'Envelope <no-reply@test.local>',
    });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });
});
