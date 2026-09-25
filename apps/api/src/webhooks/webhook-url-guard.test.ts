import { describe, expect, it } from 'vitest';
import { AppException } from '../common/errors/app-exception';
import { assertWebhookUrlIsSafe, assertWebhookUrlShape } from './webhook-url-guard';

describe('assertWebhookUrlShape', () => {
  it('accepts a plain https hostname', () => {
    expect(() => assertWebhookUrlShape('https://hooks.example.com/receive')).not.toThrow();
  });

  it('refuses http', () => {
    expect(() => assertWebhookUrlShape('http://hooks.example.com/receive')).toThrow(AppException);
  });

  it('refuses a malformed URL', () => {
    expect(() => assertWebhookUrlShape('not a url')).toThrow(AppException);
  });

  it('refuses localhost and its subdomains', () => {
    expect(() => assertWebhookUrlShape('https://localhost/receive')).toThrow(AppException);
    expect(() => assertWebhookUrlShape('https://api.localhost/receive')).toThrow(AppException);
  });

  it.each([
    '127.0.0.1',
    '10.0.0.5',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    'fe80::1',
    'fc00::1',
    'ff02::1',
  ])('refuses a literal private/reserved address %s', (ip) => {
    const host = ip.includes(':') ? `[${ip}]` : ip;
    expect(() => assertWebhookUrlShape(`https://${host}/receive`)).toThrow(AppException);
  });

  it('accepts a literal public address', () => {
    expect(() => assertWebhookUrlShape('https://93.184.216.34/receive')).not.toThrow();
  });
});

describe('assertWebhookUrlIsSafe', () => {
  it('refuses a hostname that resolves to loopback', async () => {
    await expect(assertWebhookUrlIsSafe('https://localhost/receive')).rejects.toThrow(AppException);
  });

  it('accepts a literal public address without a DNS lookup', async () => {
    await expect(assertWebhookUrlIsSafe('https://93.184.216.34/receive')).resolves.toBeUndefined();
  });
});
