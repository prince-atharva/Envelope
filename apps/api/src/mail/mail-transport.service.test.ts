import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PinoLogger } from 'nestjs-pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config/app-config';
import type { PrismaService } from '../prisma/prisma.service';
import { MailTransportService, MemoryMailbox } from './mail-transport.service';

const prisma = { mailDelivery: { create: vi.fn() } } as unknown as PrismaService;
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
    service = new MailTransportService(config, new MemoryMailbox(), prisma, logger);
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

  it('labels a mail to someone on an envelope with our own reference, and remembers it', async () => {
    const create = vi.mocked(prisma.mailDelivery.create);
    create.mockClear();
    const { messageId } = await service.send(
      { to: 'signer@example.com', subject: 'Please sign', html: '<p>Hi</p>', text: 'Hi' },
      'invitation',
      { envelopeId: 'env-1', recipientId: 'rec-1' },
    );

    // The Message-ID header is ours, on the From address's domain, and is what is remembered.
    expect(messageId).toMatch(/^<[0-9a-f-]{36}@test\.local>$/);
    const ref = messageId.slice(1, -1);
    expect(create).toHaveBeenCalledWith({
      data: { envelopeId: 'env-1', recipientId: 'rec-1', messageId: ref, template: 'invitation' },
    });
    const directory = path.join(root, 'outbox');
    const [name] = await readdir(directory);
    const written = JSON.parse(await readFile(path.join(directory, name as string), 'utf8')) as {
      messageId: string;
    };
    expect(written.messageId).toBe(messageId);
  });

  it('remembers nothing for a mail that is not about an envelope', async () => {
    const create = vi.mocked(prisma.mailDelivery.create);
    create.mockClear();
    await service.send(
      { to: 'raj@example.com', subject: 'Welcome', html: '<p>Hi</p>', text: 'Hi' },
      'welcome',
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('still counts the mail as sent when remembering it fails', async () => {
    vi.mocked(prisma.mailDelivery.create).mockRejectedValueOnce(new Error('database is down'));
    const sent = await service.send(
      { to: 'signer@example.com', subject: 'Please sign', html: '<p>Hi</p>', text: 'Hi' },
      'invitation',
      { envelopeId: 'env-1', recipientId: 'rec-1' },
    );
    expect(sent.messageId).toContain('@test.local');
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ envelopeId: 'env-1' }),
      expect.stringContaining('cannot be matched'),
    );
  });
});
