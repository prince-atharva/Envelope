import type { Readable } from 'node:stream';
import { SIGNING_TOKEN_PATTERN } from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppException } from '../common/errors/app-exception';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { hashDownloadToken, tokenRef } from '../signing/signing-token';
import { StorageService } from '../storage/storage.service';

export interface CompletedDocument {
  body: Readable;
  sizeBytes: number;
  filename: string;
}

/**
 * GET /download/:token: the finished document behind a completion email's
 * private link (docs/15 step 6). The token is the only credential; only its
 * HMAC is stored, and only a short reference to that is logged. The link can
 * be used again until it expires, so a mail scanner that opens it first does
 * no harm.
 */
@Injectable()
export class CompletionDownloadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: AppConfig,
    @InjectPinoLogger(CompletionDownloadService.name) private readonly logger: PinoLogger,
  ) {}

  async open(rawToken: string): Promise<CompletedDocument> {
    // Anything that is not the right shape cannot be a token: no lookup.
    if (!SIGNING_TOKEN_PATTERN.test(rawToken)) {
      this.logger.info('Download link rejected: malformed');
      throw notFound();
    }
    const tokenHash = hashDownloadToken(this.config.SIGNING_TOKEN_SECRET, rawToken);
    const ref = tokenRef(tokenHash);

    const link = await this.prisma.completionDownload.findUnique({
      where: { tokenHash },
      include: {
        envelope: {
          select: {
            id: true,
            status: true,
            originalFilename: true,
            versions: {
              where: { isFinal: true },
              select: { fileUrl: true, storageVersionId: true, sizeBytes: true },
            },
          },
        },
      },
    });
    const final = link?.envelope.versions[0];
    if (link?.envelope.status !== 'COMPLETED' || !final?.storageVersionId) {
      this.logger.info({ tokenRef: ref }, 'Download link rejected: unknown');
      throw notFound();
    }
    const context = { tokenRef: ref, envelopeId: link.envelopeId, recipientId: link.recipientId };
    if (link.expiresAt <= new Date()) {
      this.logger.info(
        { ...context, expiredAt: link.expiresAt.toISOString() },
        'Download link rejected: expired',
      );
      throw new AppException(
        'DOWNLOAD_LINK_EXPIRED',
        'This download link has expired. Ask the sender for a copy of the document.',
      );
    }

    const object = await this.storage.getSealed(final.fileUrl, final.storageVersionId);
    const updated = await this.prisma.completionDownload.update({
      where: { id: link.id },
      data: { downloadCount: { increment: 1 }, lastDownloadedAt: new Date() },
      select: { downloadCount: true },
    });
    this.logger.info(
      { ...context, sizeBytes: final.sizeBytes, downloads: updated.downloadCount },
      'Finished document downloaded',
    );
    return {
      body: object.body,
      sizeBytes: final.sizeBytes,
      filename: link.envelope.originalFilename,
    };
  }
}

function notFound(): AppException {
  return new AppException('NOT_FOUND', 'This download link is not valid.');
}
