import { createHash } from 'node:crypto';
import { type ErrorCode, MAX_PDF_PAGES, MAX_UPLOAD_BYTES } from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PDFDocument } from 'pdf-lib';
import { AppException } from '../common/errors/app-exception';
import { stripActiveContent } from './active-content';
import { MalwareScanner } from './malware-scanner';

const PDF_MAGIC = Buffer.from('%PDF-');

export interface ValidatedPdf {
  /** The bytes to store: the upload itself, or its sanitised copy. */
  bytes: Buffer;
  sha256: string;
  pageCount: number;
  sanitized: boolean;
  /** Kinds of active content removed (empty when the upload was clean). */
  removed: string[];
  /** Hash and size of the upload as received, before any sanitising. */
  original: { sha256: string; sizeBytes: number };
  scanEngine: string;
}

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

class Rejection extends AppException {
  constructor(
    readonly step: string,
    code: ErrorCode,
    detail: string,
  ) {
    super(code, detail);
  }
}

/**
 * The upload-hardening pipeline from docs/10:
 *   1 size  2 magic bytes  3 parse (reject encrypted)  4 page count
 *   5 malware scan  6 strip active content  (7 random storage key: EnvelopesService)
 *
 * Each step is logged at debug level; the outcome at info (accepted) or warn
 * (rejected, with the step and error code). File names and titles are never
 * logged: they can contain patient data.
 */
@Injectable()
export class PdfValidatorService {
  constructor(
    private readonly scanner: MalwareScanner,
    @InjectPinoLogger(PdfValidatorService.name) private readonly logger: PinoLogger,
  ) {}

  async validate(upload: Buffer): Promise<ValidatedPdf> {
    const started = performance.now();
    const originalSha256 = sha256Hex(upload);
    const summary = { sizeBytes: upload.length, originalSha256 };
    try {
      const result = await this.run(upload, originalSha256);
      this.logger.info(
        {
          ...summary,
          sha256: result.sha256,
          pageCount: result.pageCount,
          sanitized: result.sanitized,
          removed: result.removed,
          scanEngine: result.scanEngine,
          durationMs: Math.round(performance.now() - started),
        },
        'PDF accepted',
      );
      return result;
    } catch (error) {
      if (error instanceof Rejection) {
        this.logger.warn(
          {
            ...summary,
            step: error.step,
            errorCode: error.code,
            durationMs: Math.round(performance.now() - started),
          },
          'PDF rejected',
        );
      }
      throw error;
    }
  }

  private async run(upload: Buffer, originalSha256: string): Promise<ValidatedPdf> {
    // 1. Size
    if (upload.length === 0) {
      throw new Rejection('size', 'FILE_REQUIRED', 'The uploaded file is empty.');
    }
    if (upload.length > MAX_UPLOAD_BYTES) {
      throw new Rejection('size', 'FILE_TOO_LARGE', 'PDFs are limited to 25 MB.');
    }
    this.logger.debug({ step: 'size', sizeBytes: upload.length }, 'Upload check passed');

    // 2. Magic bytes: the content decides, never the file name or Content-Type.
    if (!upload.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
      throw new Rejection('magic-bytes', 'UNSUPPORTED_FILE_TYPE', 'The file is not a PDF.');
    }
    this.logger.debug({ step: 'magic-bytes' }, 'Upload check passed');

    // 3. Structure. Encryption is checked explicitly: pdf-lib's own error class
    // cannot be detected with instanceof.
    let doc: PDFDocument;
    let pageCount: number;
    try {
      doc = await PDFDocument.load(upload, { ignoreEncryption: true, updateMetadata: false });
      if (doc.isEncrypted) {
        throw new Rejection(
          'parse',
          'ENCRYPTED_PDF',
          'Remove the password from the PDF and upload it again.',
        );
      }
      // A document without a readable page tree fails here rather than in load().
      pageCount = doc.getPageCount();
    } catch (error) {
      if (error instanceof Rejection) throw error;
      this.logger.debug({ err: error }, 'PDF could not be parsed');
      throw new Rejection('parse', 'INVALID_PDF', 'The PDF is damaged or could not be read.');
    }
    this.logger.debug({ step: 'parse' }, 'Upload check passed');

    // 4. Page count
    if (pageCount < 1) {
      throw new Rejection('page-count', 'INVALID_PDF', 'The PDF has no pages.');
    }
    if (pageCount > MAX_PDF_PAGES) {
      throw new Rejection(
        'page-count',
        'PAGE_LIMIT_EXCEEDED',
        `PDFs are limited to ${MAX_PDF_PAGES} pages; this one has ${pageCount}.`,
      );
    }
    this.logger.debug({ step: 'page-count', pageCount }, 'Upload check passed');

    // 5. Malware scan
    const scan = await this.scanner.scan(upload);
    if (!scan.clean) {
      this.logger.warn(
        { engine: this.scanner.engine, signature: scan.signature },
        'Malware detected in upload',
      );
      throw new Rejection('malware-scan', 'MALWARE_DETECTED', 'The file failed the security scan.');
    }
    this.logger.debug({ step: 'malware-scan', engine: this.scanner.engine }, 'Upload check passed');

    // 6. Active content. Clean files are stored byte-for-byte as uploaded.
    let removed: string[];
    let bytes = upload;
    try {
      removed = stripActiveContent(doc);
      if (removed.length > 0) bytes = Buffer.from(await doc.save());
    } catch (error) {
      this.logger.debug({ err: error }, 'PDF could not be sanitised');
      throw new Rejection(
        'active-content',
        'INVALID_PDF',
        'The PDF is damaged or could not be read.',
      );
    }
    if (removed.length > 0) {
      this.logger.info({ removed, sizeBytes: bytes.length }, 'Removed active content from PDF');
    }
    this.logger.debug({ step: 'active-content', removed }, 'Upload check passed');

    return {
      bytes,
      sha256: removed.length > 0 ? sha256Hex(bytes) : originalSha256,
      pageCount,
      sanitized: removed.length > 0,
      removed,
      original: { sha256: originalSha256, sizeBytes: upload.length },
      scanEngine: this.scanner.engine,
    };
  }
}
