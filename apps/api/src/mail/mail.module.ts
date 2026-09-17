import { Module } from '@nestjs/common';
import { EmailProcessor } from './email.processor';
import { MailQueueService } from './mail-queue.service';
import { MailTransportService, MemoryMailbox } from './mail-transport.service';

/** Imported by the API: queues email. */
@Module({
  providers: [MailQueueService],
  exports: [MailQueueService],
})
export class MailProducerModule {}

/** Imported by the worker: renders and sends email. */
@Module({
  providers: [EmailProcessor, MailTransportService, MemoryMailbox],
  exports: [MailTransportService, MemoryMailbox],
})
export class MailWorkerModule {}
