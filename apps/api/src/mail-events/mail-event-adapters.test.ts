import type { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import { AppException } from '../common/errors/app-exception';
import type { AppConfig } from '../config/app-config';
import {
  adaptMailEvents,
  hasSecret,
  isMailEventAdapter,
  MAX_MAIL_EVENTS_PER_REQUEST,
  normaliseMessageId,
} from './mail-event-adapters';
import { MailEventsController } from './mail-events.controller';
import type { MailEventsService } from './mail-events.service';

const REF = '3f1c9b6e-0000-4000-8000-000000000001@mail.example.com';

describe('normaliseMessageId', () => {
  it('reads <id@host> and id@host as the same message', () => {
    expect(normaliseMessageId(`<${REF}>`)).toBe(REF);
    expect(normaliseMessageId(`  ${REF} `)).toBe(REF);
  });
});

describe('the generic adapter', () => {
  it('reads one event or a list of them, and strips the brackets', () => {
    expect(adaptMailEvents('generic', { messageId: `<${REF}>`, type: 'BOUNCED' })).toEqual([
      { messageId: REF, type: 'BOUNCED' },
    ]);
    expect(
      adaptMailEvents('generic', [
        { messageId: REF, type: 'BOUNCED' },
        { messageId: 'b@c.d', type: 'COMPLAINED' },
      ]),
    ).toEqual([
      { messageId: REF, type: 'BOUNCED' },
      { messageId: 'b@c.d', type: 'COMPLAINED' },
    ]);
  });

  it('refuses what it cannot read, so an integrator sees why', () => {
    for (const body of [
      {},
      { messageId: REF },
      { messageId: REF, type: 'OPENED' },
      { messageId: REF, type: 'BOUNCED', extra: 1 },
      [],
      Array.from({ length: MAX_MAIL_EVENTS_PER_REQUEST + 1 }, () => ({
        messageId: REF,
        type: 'BOUNCED',
      })),
      'text',
    ]) {
      expect(() => adaptMailEvents('generic', body)).toThrow();
    }
  });
});

describe('the Postmark adapter', () => {
  const metadata = { 'envelope-ref': REF };

  it('turns a bounce and a spam complaint into events, through our own metadata', () => {
    expect(
      adaptMailEvents('postmark', { RecordType: 'Bounce', Type: 'HardBounce', Metadata: metadata }),
    ).toEqual([{ messageId: REF, type: 'BOUNCED' }]);
    expect(
      adaptMailEvents('postmark', { RecordType: 'SpamComplaint', Metadata: metadata }),
    ).toEqual([{ messageId: REF, type: 'COMPLAINED' }]);
  });

  it('ignores bounces that are not a failure to deliver, other records, and messages that are not ours', () => {
    for (const body of [
      { RecordType: 'Bounce', Type: 'Transient', Metadata: metadata },
      { RecordType: 'Bounce', Type: 'AutoResponder', Metadata: metadata },
      { RecordType: 'Delivery', Metadata: metadata },
      { RecordType: 'Open', Metadata: metadata },
      { RecordType: 'Bounce', Type: 'HardBounce' },
      { RecordType: 'Bounce', Type: 'HardBounce', Metadata: { 'envelope-ref': 7 } },
      { nothing: true },
      null,
    ]) {
      expect(adaptMailEvents('postmark', body)).toEqual([]);
    }
  });
});

describe('isMailEventAdapter', () => {
  it('knows the adapters that exist', () => {
    expect(isMailEventAdapter('generic')).toBe(true);
    expect(isMailEventAdapter('postmark')).toBe(true);
    expect(isMailEventAdapter('ses')).toBe(false);
  });
});

describe('hasSecret', () => {
  const secret = 'a-long-shared-secret-0123456789abcdefghij';
  const basic = (user: string, pass: string) =>
    `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

  it('accepts the secret as a bearer token or as the password of basic auth', () => {
    expect(hasSecret(`Bearer ${secret}`, secret)).toBe(true);
    expect(hasSecret(`bearer ${secret}`, secret)).toBe(true);
    expect(hasSecret(basic('postmark', secret), secret)).toBe(true);
    expect(hasSecret(basic('', secret), secret)).toBe(true);
  });

  it('refuses a wrong, missing or differently shaped credential', () => {
    expect(hasSecret(undefined, secret)).toBe(false);
    expect(hasSecret('', secret)).toBe(false);
    expect(hasSecret('Bearer', secret)).toBe(false);
    expect(hasSecret(`Bearer ${secret}x`, secret)).toBe(false);
    expect(hasSecret(`Bearer ${secret.slice(1)}`, secret)).toBe(false);
    expect(hasSecret(basic('me', 'wrong'), secret)).toBe(false);
    expect(hasSecret(`Token ${secret}`, secret)).toBe(false);
    expect(hasSecret(secret, secret)).toBe(false);
  });
});

describe('MailEventsController', () => {
  const logger = { warn: vi.fn(), info: vi.fn() } as unknown as PinoLogger;
  const record = vi.fn().mockResolvedValue('recorded');
  const events = { record } as unknown as MailEventsService;
  const controller = (secret?: string) =>
    new MailEventsController({ MAIL_EVENTS_SECRET: secret } as AppConfig, events, logger);

  it('does not exist when no secret is configured', async () => {
    await expect(
      controller().receive('generic', { messageId: REF, type: 'BOUNCED' }, 'Bearer anything'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(record).not.toHaveBeenCalled();
  });

  it('refuses a wrong secret before reading the body, and never logs it', async () => {
    const promise = controller('the-real-secret-0123456789abcdefghijkl').receive(
      'generic',
      { messageId: REF, type: 'BOUNCED' },
      'Bearer not-the-secret-at-all',
    );
    await expect(promise).rejects.toBeInstanceOf(AppException);
    await expect(promise).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(record).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('not-the-secret');
  });

  it('answers an unknown adapter as not found, and records each event it reads', async () => {
    const secret = 'the-real-secret-0123456789abcdefghijkl';
    await expect(controller(secret).receive('ses', {}, `Bearer ${secret}`)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const result = await controller(secret).receive(
      'generic',
      [
        { messageId: REF, type: 'BOUNCED' },
        { messageId: 'b@c.d', type: 'COMPLAINED' },
      ],
      `Bearer ${secret}`,
    );
    expect(result).toEqual({ events: 2, recorded: 2 });
    expect(record).toHaveBeenCalledTimes(2);
  });
});
