import { Module } from '@nestjs/common';
import { MailProducerModule } from '../mail/mail.module';
import { PdfSealingService } from './pdf-sealing.service';
import { SealProcessor } from './seal.processor';
import { SealQueueService } from './seal-queue.service';
import { SealingService } from './sealing.service';

/** Imported by the API: queues seal jobs. */
@Module({
  providers: [SealQueueService],
  exports: [SealQueueService],
})
export class SealProducerModule {}

/**
 * Imported by the worker: stamps signatures into versions (ADR 0006). It
 * queues the next signer's invitation, so it needs the mail producer too.
 */
@Module({
  imports: [MailProducerModule],
  providers: [SealProcessor, SealingService, PdfSealingService],
  exports: [SealingService],
})
export class SealingWorkerModule {}
