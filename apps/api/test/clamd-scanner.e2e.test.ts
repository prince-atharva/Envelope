import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import type { PinoLogger } from 'nestjs-pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlertService } from '../src/alert/alert.service';
import type { AppConfig } from '../src/config/app-config';
import { ClamdMalwareScanner, parseReply } from '../src/uploads/clamd-malware-scanner';
import { FakeClamd, INFECTED_MARKER } from './helpers/fake-clamd';

/**
 * The clamd client against a real local TCP server that speaks its protocol
 * (docs/19, ADR 0026). Nothing here needs ClamAV, its signatures or the internet.
 */
describe('ClamdMalwareScanner (against a local clamd protocol server)', () => {
  const clamd = new FakeClamd();
  let port: number;
  const alerts = { raise: vi.fn(async () => undefined) };
  const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() };

  const scannerFor = (overrides: Partial<Record<string, unknown>> = {}) =>
    new ClamdMalwareScanner(
      {
        MALWARE_SCANNER: 'clamav',
        CLAMAV_HOST: '127.0.0.1',
        CLAMAV_PORT: port,
        CLAMAV_TIMEOUT_MS: 400,
        ...overrides,
      } as unknown as AppConfig,
      alerts as unknown as AlertService,
      logger as unknown as PinoLogger,
    );

  beforeAll(async () => {
    port = await clamd.start();
  });

  afterAll(async () => {
    await clamd.stop();
  });

  beforeEach(() => {
    clamd.mode = 'normal';
    clamd.scans.length = 0;
    vi.clearAllMocks();
  });

  it('sends the whole file, in chunks, and reads a clean reply', async () => {
    // Bigger than one 64 KiB chunk, and not a multiple of it.
    const file = randomBytes(300_001);
    const result = await scannerFor().scan(file);
    expect(result).toEqual({ clean: true });
    expect(clamd.scans).toHaveLength(1);
    expect(clamd.scans[0]?.equals(file)).toBe(true);
    expect(alerts.raise).not.toHaveBeenCalled();
  });

  it('reads a detection and names the signature', async () => {
    const result = await scannerFor().scan(Buffer.from(`%PDF-1.4\n${INFECTED_MARKER}\n`));
    expect(result).toEqual({ clean: false, signature: 'Eicar-Test-Signature' });
    expect(alerts.raise).not.toHaveBeenCalled();
  });

  it('scans an empty file without hanging', async () => {
    expect(await scannerFor().scan(Buffer.alloc(0))).toEqual({ clean: true });
  });

  it.each([
    ['an ERROR reply', 'error', 'scanner-error'],
    ['a server that never answers', 'hang', 'timeout'],
    ['a server that hangs up', 'close', 'connection-closed'],
  ] as const)('accepts the file and alerts, on %s', async (_name, mode, reason) => {
    clamd.mode = mode;
    const result = await scannerFor().scan(Buffer.from('%PDF-1.4 a file'));
    expect(result).toEqual({ clean: true, unavailable: true, reason });
    expect(alerts.raise).toHaveBeenCalledTimes(1);
    const [key, summary, fields] = alerts.raise.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(key).toBe('malware-scanner-unavailable');
    expect(summary).toContain('accepted unscanned');
    // Codes only: never a file name, its contents or an address.
    expect(fields).toEqual({ engine: 'clamav', reason });
    expect(logger.warn).toHaveBeenCalledWith(
      { engine: 'clamav', reason },
      'Malware scanner unavailable',
    );
  });

  it('accepts the file and alerts when nothing is listening', async () => {
    // A port that was free a moment ago and has nothing on it now.
    const closed = await new Promise<number>((resolve) => {
      const probe = createServer();
      probe.listen(0, '127.0.0.1', () => {
        const { port: free } = probe.address() as { port: number };
        probe.close(() => resolve(free));
      });
    });
    const result = await scannerFor({ CLAMAV_PORT: closed }).scan(Buffer.from('%PDF-1.4'));
    expect(result).toEqual({ clean: true, unavailable: true, reason: 'ECONNREFUSED' });
    expect(alerts.raise).toHaveBeenCalledTimes(1);
  });
});

describe('parseReply', () => {
  it('reads OK, FOUND (with or without the stream prefix) and refuses anything else', () => {
    expect(parseReply('stream: OK\0')).toEqual({ clean: true });
    expect(parseReply('stream: Win.Test.EICAR_HDB-1 FOUND\0')).toEqual({
      clean: false,
      signature: 'Win.Test.EICAR_HDB-1',
    });
    expect(parseReply('Eicar-Test-Signature FOUND')).toEqual({
      clean: false,
      signature: 'Eicar-Test-Signature',
    });
    expect(() => parseReply('INSTREAM size limit exceeded. ERROR\0')).toThrow('scanner-error');
    expect(() => parseReply('')).toThrow('scanner-error');
  });
});
