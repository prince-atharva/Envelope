import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { downloadUrl, mintDownloadToken, tokenRef } from '../signing/signing-token';
import type { DownloadRenewedJob } from './mail.types';
import { MailTransportService } from './mail-transport.service';
import type { SigningLinkResult } from './signing-link.mailer';
import { renderDownloadRenewedEmail } from './templates';

/**
 * Renews an expired completion download link (docs/17 step 10). Updates the
 * same `CompletionDownload` row — its download count is history worth
 * keeping — rather than creating a second one. The token is minted here,
 * not in the API (ADR 0009), the same treatment as every other link.
 */
@Injectable()
export class DownloadRenewMailer {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transport: MailTransportService,
    private readonly config: AppConfig,
    @InjectPinoLogger(DownloadRenewMailer.name) private readonly logger: PinoLogger,
  ) {}

  async send(job: DownloadRenewedJob): Promise<SigningLinkResult> {
    const link = await this.prisma.completionDownload.findUnique({
      where: { id: job.downloadId },
      include: {
        envelope: {
          select: {
            title: true,
            status: true,
            owner: { select: { email: true, fullName: true } },
          },
        },
        recipient: { select: { name: true, email: true } },
      },
    });
    if (link?.envelope.status !== 'COMPLETED') {
      this.logger.info({ downloadId: job.downloadId }, 'Renewal not sent: link not found');
      return { skipped: 'link not found' };
    }

    const { rawToken, tokenHash } = mintDownloadToken(this.config.SIGNING_TOKEN_SECRET);
    const expiresAt = new Date(Date.now() + this.config.COMPLETION_LINK_DAYS * 24 * 3600_000);
    await this.prisma.completionDownload.update({
      where: { id: link.id },
      data: { tokenHash, expiresAt, lastRenewedAt: new Date() },
    });

    const person = link.recipient ?? {
      name: link.envelope.owner.fullName,
      email: link.envelope.owner.email,
    };
    const email = renderDownloadRenewedEmail({
      to: person.email,
      name: person.name,
      envelopeTitle: link.envelope.title,
      downloadUrl: downloadUrl(this.config.APP_URL, rawToken),
      expiresAt,
    });
    const { messageId } = await this.transport.send(email, job.template);

    this.logger.info(
      { envelopeId: job.envelopeId, tokenRef: tokenRef(tokenHash), messageId },
      'Download link renewed and emailed',
    );
    return { messageId };
  }
}
