import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BRAND } from '@envelope/shared';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { createTransport, type Transporter } from 'nodemailer';
import { AppConfig } from '../config/app-config';
import { maskEmail } from '../logging/redact';
import { PrismaService } from '../prisma/prisma.service';
import type { EmailTemplate, RenderedEmail } from './mail.types';

export interface SentEmail extends RenderedEmail {
  from: string;
  messageId: string;
  template: EmailTemplate;
}

/** Messages "sent" with MAIL_TRANSPORT=memory. Only ever used by automated tests. */
@Injectable()
export class MemoryMailbox {
  readonly messages: SentEmail[] = [];

  clear(): void {
    this.messages.length = 0;
  }
}

/**
 * What an email is about, when it goes to someone on an envelope: the transport
 * then labels the message so a provider's bounce report can be matched to it
 * (docs/20, ADR 0029).
 */
export interface MailDeliveryContext {
  envelopeId: string;
  recipientId?: string | null;
}

/** The domain of the From address, for a Message-ID that is ours and unique. */
function domainOf(from: string): string {
  const match = /@([^>\s]+)>?\s*$/.exec(from);
  return match?.[1] ?? 'envelope.local';
}

/** Fields worth logging from an SMTP failure (nodemailer adds these to its errors). */
function smtpDetails(error: unknown): Record<string, unknown> {
  const { code, command, responseCode } = (error ?? {}) as Record<string, unknown>;
  return { code, command, responseCode };
}

/**
 * Sends email. With MAIL_TRANSPORT=smtp this is real SMTP (Gmail in development,
 * any SMTP relay in production); with `memory` messages go to MemoryMailbox; with
 * `file` they are written to MAIL_OUTBOX_DIR and nothing is sent.
 */
@Injectable()
export class MailTransportService implements OnModuleDestroy {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(
    private readonly config: AppConfig,
    private readonly mailbox: MemoryMailbox,
    private readonly prisma: PrismaService,
    @InjectPinoLogger(MailTransportService.name) private readonly logger: PinoLogger,
  ) {
    this.from = config.SMTP_FROM ?? `${BRAND.fullName} <no-reply@localhost>`;
    this.transporter =
      config.MAIL_TRANSPORT === 'smtp'
        ? createTransport({
            host: config.SMTP_HOST,
            port: config.SMTP_PORT,
            secure: config.SMTP_SECURE,
            // Port 587 starts in plain text; refuse to continue without STARTTLS.
            requireTLS: !config.SMTP_SECURE,
            auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
            pool: true,
            maxConnections: 3,
            connectionTimeout: 10_000,
            greetingTimeout: 10_000,
            socketTimeout: 30_000,
          })
        : createTransport({ jsonTransport: true });
  }

  /** Checks the SMTP login once at start-up and says clearly what is wrong. */
  async verify(): Promise<boolean> {
    if (this.config.MAIL_TRANSPORT === 'file') {
      this.logger.warn(
        { transport: 'file', outbox: this.config.MAIL_OUTBOX_DIR },
        'Emails are written to the outbox folder and not sent',
      );
      return true;
    }
    if (this.config.MAIL_TRANSPORT !== 'smtp') {
      this.logger.info({ transport: this.config.MAIL_TRANSPORT }, 'Email transport ready');
      return true;
    }
    const target = {
      host: this.config.SMTP_HOST,
      port: this.config.SMTP_PORT,
      user: maskEmail(this.config.SMTP_USER),
    };
    try {
      await this.transporter.verify();
      this.logger.info(target, 'SMTP connection verified');
      return true;
    } catch (error) {
      this.logger.error(
        { ...target, ...smtpDetails(error), err: error },
        'SMTP connection failed. Check SMTP_USER and SMTP_PASSWORD; Gmail needs an App Password',
      );
      return false;
    }
  }

  async send(
    email: RenderedEmail,
    template: EmailTemplate,
    delivery?: MailDeliveryContext,
  ): Promise<{ messageId: string }> {
    const started = performance.now();
    const fields = { template, to: maskEmail(email.to), transport: this.config.MAIL_TRANSPORT };
    // The reference is ours, chosen before sending, and travels in the Message-ID header and in
    // headers a provider can echo in its bounce report. SMTP providers differ in which they
    // return (docs/operations/mail-delivery.md).
    const ref = delivery ? `${randomUUID()}@${domainOf(this.from)}` : undefined;
    try {
      // nodemailer rewrites attachment objects as it encodes them: give it
      // copies, so the originals stay as they were for the outbox and the tests.
      const attachments = email.attachments?.map((attachment) => ({ ...attachment }));
      const info = (await this.transporter.sendMail({
        from: this.from,
        ...email,
        attachments,
        ...(ref
          ? {
              messageId: `<${ref}>`,
              headers: {
                'X-Envelope-Ref': ref,
                // Postmark hands this metadata back on a bounce; other providers ignore it.
                'X-PM-Metadata-envelope-ref': ref,
              },
            }
          : {}),
      })) as {
        messageId: string;
        accepted?: unknown[];
        rejected?: unknown[];
        response?: string;
      };
      const sent: SentEmail = { ...email, from: this.from, messageId: info.messageId, template };
      if (this.config.MAIL_TRANSPORT === 'memory') {
        this.mailbox.messages.push(sent);
      } else if (this.config.MAIL_TRANSPORT === 'file') {
        await this.writeToOutbox(sent);
      }
      this.logger.info(
        {
          ...fields,
          attachmentBytes: email.attachments?.reduce((sum, a) => sum + a.content.length, 0),
          messageId: info.messageId,
          accepted: info.accepted?.length ?? 0,
          rejected: info.rejected?.length ?? 0,
          durationMs: Math.round(performance.now() - started),
        },
        'Email sent',
      );
      if (delivery && ref) await this.recordDelivery(delivery, ref, template);
      return { messageId: info.messageId };
    } catch (error) {
      this.logger.error(
        {
          ...fields,
          ...smtpDetails(error),
          err: error,
          durationMs: Math.round(performance.now() - started),
        },
        'Email send failed',
      );
      throw error;
    }
  }

  /**
   * Remembers a message that went to someone on an envelope. The mail is already
   * sent, so a failure here is logged and never fails the job: the worst case is a
   * bounce that cannot be matched.
   */
  private async recordDelivery(
    delivery: MailDeliveryContext,
    ref: string,
    template: EmailTemplate,
  ): Promise<void> {
    try {
      await this.prisma.mailDelivery.create({
        data: {
          envelopeId: delivery.envelopeId,
          recipientId: delivery.recipientId ?? null,
          messageId: ref,
          template,
        },
      });
    } catch (error) {
      this.logger.error(
        { err: error, envelopeId: delivery.envelopeId, template },
        'Mail delivery could not be recorded; a bounce for it cannot be matched',
      );
    }
  }

  /**
   * MAIL_TRANSPORT=file: one JSON file per message, readable only by this user,
   * named so that a directory listing sorts oldest first. The path is not
   * logged, because the file holds a live signing link.
   *
   * Attachments are written beside it as their own files, and the JSON names
   * them, so it stays readable and the document can be opened.
   */
  private async writeToOutbox(sent: SentEmail): Promise<void> {
    const directory = path.resolve(this.config.APP_ROOT_DIR, this.config.MAIL_OUTBOX_DIR);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const base = `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`;
    const attachments = [];
    for (const [index, attachment] of (sent.attachments ?? []).entries()) {
      const file = `${base}-${index + 1}${path.extname(attachment.filename) || '.bin'}`;
      await writeFile(path.join(directory, file), attachment.content, { mode: 0o600 });
      attachments.push({
        filename: attachment.filename,
        contentType: attachment.contentType,
        sizeBytes: attachment.content.length,
        file,
      });
    }
    await writeFile(
      path.join(directory, `${base}.json`),
      JSON.stringify({ ...sent, attachments, sentAt: new Date().toISOString() }, null, 2),
      { mode: 0o600 },
    );
  }

  onModuleDestroy(): void {
    this.transporter.close();
  }
}
