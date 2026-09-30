import { Module } from '@nestjs/common';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { JurisdictionService } from '../compliance/jurisdiction.service';
import { MailProducerModule } from '../mail/mail.module';
import { SendingService } from '../sending/sending.service';
import { TemplatesModule } from '../templates/templates.module';
import { TemplatesService } from '../templates/templates.service';
import { WebhookProducerModule } from '../webhooks/webhooks.module';
import { BulkController } from './bulk.controller';
import { BulkProcessor } from './bulk.processor';
import { BulkService } from './bulk.service';
import { BulkQueueService } from './bulk-queue.service';
import { BulkRunner } from './bulk-runner.service';

/** Imported by the API: accepts batches and answers for their progress (docs/20, ADR 0028). */
@Module({
  imports: [TemplatesModule],
  controllers: [BulkController],
  providers: [BulkService, BulkQueueService, IdempotencyService],
})
export class BulkModule {}

/**
 * Imported by the worker: creates each batch's envelopes. It provides the
 * services it needs directly, rather than importing `TemplatesModule`, which
 * would bring the API's controllers and upload pipeline into the worker.
 */
@Module({
  imports: [MailProducerModule, WebhookProducerModule],
  providers: [BulkProcessor, BulkRunner, TemplatesService, JurisdictionService, SendingService],
})
export class BulkWorkerModule {}
