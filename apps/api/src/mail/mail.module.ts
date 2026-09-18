import { Module } from '@nestjs/common';
import { EmailProcessor } from './email.processor';
import { MailQueueService } from './mail-queue.service';
import { MailTransportService, MemoryMailbox } from './mail-transport.service';
import { SenderNoticeMailer } from './sender-notice.mailer';
import { SigningLinkMailer } from './signing-link.mailer';

/** Imported by the API: queues email. */
@Module({
  providers: [MailQueueService],
  exports: [MailQueueService],
})
export class MailProducerModule {}

/**
 * Imported by the worker: renders and sends email. Signing links are minted
 * here too (ADR 0009), which is why the worker needs the database and the audit
 * trail (see WorkerModule).
 */
@Module({
  providers: [
    EmailProcessor,
    MailTransportService,
    MemoryMailbox,
    SigningLinkMailer,
    SenderNoticeMailer,
  ],
  exports: [MailTransportService, MemoryMailbox],
})
export class MailWorkerModule {}
