import { MAX_PDF_PAGES, MAX_UPLOAD_BYTES } from '@digitalsign/shared';
import type { PinoLogger } from 'nestjs-pino';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  inspectPdf,
  makeActivePdf,
  makeBlankPdf,
  makeEncryptedPdf,
  makePdf,
  SAFE_LINK,
} from '../../test/fixtures/pdfs';
import { AppException } from '../common/errors/app-exception';
import type { MalwareScanner, ScanResult } from './malware-scanner';
import { PdfValidatorService, sha256Hex } from './pdf-validator.service';

function fakeLogger() {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  };
}

function validator(scan: ScanResult = { clean: true }) {
  const logger = fakeLogger();
  const scanner: MalwareScanner = { engine: 'test-engine', scan: vi.fn(async () => scan) };
  return {
    logger,
    scanner,
    service: new PdfValidatorService(scanner, logger as unknown as PinoLogger),
  };
}

async function rejection(promise: Promise<unknown>): Promise<AppException> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AppException);
  return error as AppException;
}

describe('PdfValidatorService', () => {
  let cleanPdf: Buffer;

  beforeAll(async () => {
    cleanPdf = await makePdf(3);
  });

  it('accepts a clean PDF and keeps its bytes exactly as uploaded', async () => {
    const { service, logger } = validator();
    const result = await service.validate(cleanPdf);

    expect(result.bytes.equals(cleanPdf)).toBe(true);
    expect(result).toMatchObject({
      pageCount: 3,
      sanitized: false,
      removed: [],
      sha256: sha256Hex(cleanPdf),
      original: { sha256: sha256Hex(cleanPdf), sizeBytes: cleanPdf.length },
      scanEngine: 'test-engine',
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ pageCount: 3, sanitized: false }),
      'PDF accepted',
    );
  });

  it.each([
    ['an empty upload', Buffer.alloc(0), 'FILE_REQUIRED', 'size'],
    [
      'a text file named .pdf',
      Buffer.from('hello, not a pdf'),
      'UNSUPPORTED_FILE_TYPE',
      'magic-bytes',
    ],
    [
      'a PNG',
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]),
      'UNSUPPORTED_FILE_TYPE',
      'magic-bytes',
    ],
    [
      'a PDF header with garbage',
      Buffer.from('%PDF-1.7\n this is not a document'),
      'INVALID_PDF',
      'parse',
    ],
  ])('rejects %s', async (_label, bytes, code, step) => {
    const { service, logger } = validator();
    const error = await rejection(service.validate(bytes));
    expect(error.code).toBe(code);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ step, errorCode: code, sizeBytes: bytes.length }),
      'PDF rejected',
    );
  });

  it('rejects files over 25 MB', async () => {
    const tooBig = Buffer.alloc(MAX_UPLOAD_BYTES + 1);
    tooBig.write('%PDF-1.7');
    const error = await rejection(validator().service.validate(tooBig));
    expect(error.code).toBe('FILE_TOO_LARGE');
    expect(error.status).toBe(413);
  });

  it('rejects password-protected PDFs', async () => {
    const error = await rejection(validator().service.validate(await makeEncryptedPdf()));
    expect(error.code).toBe('ENCRYPTED_PDF');
  });

  it(`rejects more than ${MAX_PDF_PAGES} pages`, async () => {
    const error = await rejection(
      validator().service.validate(await makeBlankPdf(MAX_PDF_PAGES + 1)),
    );
    expect(error.code).toBe('PAGE_LIMIT_EXCEEDED');
    expect(error.detail).toContain('501');
  });

  it('rejects files the malware scanner flags, and logs the signature', async () => {
    const { service, logger } = validator({ clean: false, signature: 'Eicar-Test-Signature' });
    const error = await rejection(service.validate(cleanPdf));
    expect(error.code).toBe('MALWARE_DETECTED');
    expect(logger.warn).toHaveBeenCalledWith(
      { engine: 'test-engine', signature: 'Eicar-Test-Signature' },
      'Malware detected in upload',
    );
  });

  it('removes active content and keeps ordinary links', async () => {
    const active = await makeActivePdf();
    const before = await inspectPdf(active);
    expect(before.findings).toEqual(
      expect.arrayContaining(['/AA', '/EmbeddedFiles', '/JS', '/JavaScript', '/S /Launch']),
    );

    const result = await validator().service.validate(active);

    expect(result.sanitized).toBe(true);
    expect(result.removed).toEqual(
      expect.arrayContaining([
        'action:JavaScript',
        'action:Launch',
        'additional-actions',
        'embedded-files',
        'javascript',
      ]),
    );
    expect(result.original.sha256).toBe(sha256Hex(active));
    expect(result.sha256).toBe(sha256Hex(result.bytes));
    expect(result.sha256).not.toBe(result.original.sha256);

    const after = await inspectPdf(result.bytes);
    expect(after.findings).toEqual([]);
    expect(after.links).toEqual([SAFE_LINK]);
  });
});
