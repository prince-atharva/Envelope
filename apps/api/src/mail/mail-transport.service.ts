import { BRAND } from '@digitalsign/shared';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { createTransport, type Transporter } from 'nodemailer';
import { AppConfig } from '../config/app-config';
import { maskEmail } from '../logging/redact';
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

/** Fields worth logging from an SMTP failure (nodemailer adds these to its errors). */
function smtpDetails(error: unknown): Record<string, unknown> {
  const { code, command, responseCode } = (error ?? {}) as Record<string, unknown>;
  return { code, command, responseCode };
}

/**
 * Sends email. With MAIL_TRANSPORT=smtp this is real SMTP (Gmail in development,
 * any SMTP relay in production); with `memory` messages go to MemoryMailbox.
 */
@Injectable()
export class MailTransportService implements OnModuleDestroy {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(
    private readonly config: AppConfig,
    private readonly mailbox: MemoryMailbox,
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

  async send(email: RenderedEmail, template: EmailTemplate): Promise<{ messageId: string }> {
    const started = performance.now();
    const fields = { template, to: maskEmail(email.to), transport: this.config.MAIL_TRANSPORT };
    try {
      const info = (await this.transporter.sendMail({ from: this.from, ...email })) as {
        messageId: string;
        accepted?: unknown[];
        rejected?: unknown[];
        response?: string;
      };
      if (this.config.MAIL_TRANSPORT === 'memory') {
        this.mailbox.messages.push({
          ...email,
          from: this.from,
          messageId: info.messageId,
          template,
        });
      }
      this.logger.info(
        {
          ...fields,
          messageId: info.messageId,
          accepted: info.accepted?.length ?? 0,
          rejected: info.rejected?.length ?? 0,
          durationMs: Math.round(performance.now() - started),
        },
        'Email sent',
      );
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

  onModuleDestroy(): void {
    this.transporter.close();
  }
}
