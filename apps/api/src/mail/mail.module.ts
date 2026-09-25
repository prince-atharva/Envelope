import { Module } from '@nestjs/common';
import { CompletionMailer } from './completion.mailer';
import { DownloadRenewMailer } from './download-renew.mailer';
import { EmailProcessor } from './email.processor';
import { LifecycleMailer } from './lifecycle.mailer';
import { MailQueueService } from './mail-queue.service';
import { MailTransportService, MemoryMailbox } from './mail-transport.service';
import { SenderNoticeMailer } from './sender-notice.mailer';
import { SigningLinkMailer } from './signing-link.mailer';
import { UserInviteMailer } from './user-invite.mailer';

/**
 * The SMTP transport on its own, for the worker's alerts: they are sent
 * directly, never through the email queue (docs/16 step 11).
 */
@Module({
  providers: [MailTransportService, MemoryMailbox],
  exports: [MailTransportService, MemoryMailbox],
})
export class MailTransportModule {}

/** Imported by the API: queues email. */
@Module({
  providers: [MailQueueService],
  exports: [MailQueueService],
})
export class MailProducerModule {}

/**
 * Imported by the worker: renders and sends email. Signing links and
 * completion download links are minted here too (ADR 0009), which is why the
 * worker needs the database, storage and the audit trail (see WorkerModule).
 */
@Module({
  imports: [MailTransportModule],
  providers: [
    EmailProcessor,
    SigningLinkMailer,
    SenderNoticeMailer,
    CompletionMailer,
    LifecycleMailer,
    UserInviteMailer,
    DownloadRenewMailer,
  ],
  exports: [MailTransportModule],
})
export class MailWorkerModule {}
