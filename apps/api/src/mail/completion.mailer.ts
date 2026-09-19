import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditService, SYSTEM_ACTOR } from '../audit/audit.service';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { downloadUrl, mintDownloadToken, tokenRef } from '../signing/signing-token';
import { StorageService } from '../storage/storage.service';
import type { CompletedEmailJob } from './mail.types';
import { MailTransportService } from './mail-transport.service';
import type { SigningLinkResult } from './signing-link.mailer';
import { type CompletedDelivery, renderCompletedEmail, signedFilename } from './templates';

async function bytesOf(body: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

/**
 * Sends the finished document to one person (docs/15 step 6): every
 * recipient, whatever their role, and the sender. The sealed file is attached
 * when it fits, and otherwise sent as a private link valid for
 * COMPLETION_LINK_DAYS, whose token is minted here and stored only as an HMAC
 * (ADR 0009).
 *
 * A person is sent their copy once: a `COMPLETION_SENT` event for them makes
 * any later job for them a no-op, however it came to be queued.
 */
@Injectable()
export class CompletionMailer {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly transport: MailTransportService,
    private readonly config: AppConfig,
    @InjectPinoLogger(CompletionMailer.name) private readonly logger: PinoLogger,
  ) {}

  async send(job: CompletedEmailJob): Promise<SigningLinkResult> {
    const to = job.recipientId ? 'recipient' : 'sender';
    const ids = { envelopeId: job.envelopeId, recipientId: job.recipientId, to };

    const envelope = await this.prisma.envelope.findUnique({
      where: { id: job.envelopeId },
      include: {
        owner: { select: { email: true, fullName: true } },
        recipients: { select: { id: true, name: true, email: true } },
        versions: { where: { isFinal: true } },
      },
    });
    const final = envelope?.versions[0];
    if (envelope?.status !== 'COMPLETED' || !final?.storageVersionId) {
      this.logger.warn(ids, 'Completion email not sent: the envelope is not sealed');
      return { skipped: 'not sealed' };
    }

    const recipient = job.recipientId
      ? envelope.recipients.find((r) => r.id === job.recipientId)
      : undefined;
    if (job.recipientId && !recipient) {
      this.logger.warn(ids, 'Completion email not sent: recipient not found');
      return { skipped: 'recipient not found' };
    }
    const ownerEmail = envelope.owner.email.toLowerCase();
    if (!recipient && envelope.recipients.some((r) => r.email.toLowerCase() === ownerEmail)) {
      // The sender is also on the envelope and gets their copy as a recipient.
      this.logger.info(ids, 'Completion email not sent: the sender receives it as a recipient');
      return { skipped: 'sender is a recipient' };
    }

    const already = await this.prisma.auditTrail.findFirst({
      where: {
        envelopeId: envelope.id,
        action: 'COMPLETION_SENT',
        recipientId: recipient?.id ?? null,
      },
      select: { id: true },
    });
    if (already) {
      this.logger.info(ids, 'Completion email not sent: already sent');
      return { skipped: 'already sent' };
    }

    const person = recipient ?? { name: envelope.owner.fullName, email: envelope.owner.email };
    const attach = final.sizeBytes <= this.config.COMPLETION_ATTACHMENT_MAX_BYTES;
    let delivery: CompletedDelivery;
    let attachment: Buffer | undefined;
    let linkRef: string | undefined;

    if (attach) {
      attachment = await bytesOf(
        (await this.storage.getSealed(final.fileUrl, final.storageVersionId)).body,
      );
      // Never send anything but the file on record.
      const sha256 = createHash('sha256').update(attachment).digest('hex');
      if (sha256 !== envelope.finalHash) {
        this.logger.error(
          { ...ids, alert: true, expected: envelope.finalHash, actual: sha256 },
          'Sealed file does not match its recorded fingerprint',
        );
        throw new Error(`Sealed file for envelope ${envelope.id} does not match finalHash`);
      }
      delivery = { kind: 'attachment', filename: signedFilename(envelope.originalFilename) };
    } else {
      const { rawToken, tokenHash } = mintDownloadToken(this.config.SIGNING_TOKEN_SECRET);
      const expiresAt = new Date(Date.now() + this.config.COMPLETION_LINK_DAYS * 24 * 3600_000);
      await this.prisma.completionDownload.create({
        data: { envelopeId: envelope.id, recipientId: recipient?.id ?? null, tokenHash, expiresAt },
      });
      linkRef = tokenRef(tokenHash);
      delivery = { kind: 'link', url: downloadUrl(this.config.APP_URL, rawToken), expiresAt };
    }

    const email = renderCompletedEmail({
      to: person.email,
      name: person.name,
      isSender: !recipient,
      senderName: envelope.owner.fullName,
      envelopeTitle: envelope.title,
      sha256: final.hash,
      verifyUrl: new URL('/verify', this.config.APP_URL).toString(),
      envelopeUrl: recipient
        ? undefined
        : new URL(`/dashboard/envelopes/${envelope.id}`, this.config.APP_URL).toString(),
      delivery,
    });
    if (attachment && delivery.kind === 'attachment') {
      email.attachments = [
        { filename: delivery.filename, contentType: 'application/pdf', content: attachment },
      ];
    }
    const { messageId } = await this.transport.send(email, job.template);

    await this.prisma.$transaction((tx) =>
      this.audit.record(tx, {
        envelopeId: envelope.id,
        recipientId: recipient?.id,
        action: 'COMPLETION_SENT',
        ...SYSTEM_ACTOR,
        metadata: {
          to,
          delivery: delivery.kind,
          versionNumber: final.versionNumber,
          sizeBytes: final.sizeBytes,
        },
      }),
    );

    this.logger.info(
      {
        ...ids,
        delivery: delivery.kind,
        sizeBytes: final.sizeBytes,
        ...(linkRef ? { tokenRef: linkRef } : {}),
        messageId,
      },
      'Completion email sent',
    );
    return { messageId };
  }
}
