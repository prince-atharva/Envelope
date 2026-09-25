import { Module } from '@nestjs/common';
import { WebhookDeliveryProcessor } from './webhook-delivery.processor';
import { WebhookQueueService } from './webhook-queue.service';
import { WebhookSecretCipher } from './webhook-secret-cipher';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

/**
 * Encrypts and decrypts webhook secrets (ADR 0015). Its own module, like
 * `mail/mail.module.ts`'s `MailTransportModule`, so both the API's
 * `WebhooksModule` (encrypts, at registration) and the worker's delivery
 * processor (decrypts, at send time) can import it independently — they run
 * in separate processes, each with its own module graph.
 */
@Module({
  providers: [WebhookSecretCipher],
  exports: [WebhookSecretCipher],
})
export class WebhookCryptoModule {}

/**
 * Imported wherever an event fires (docs/18): `SendingModule`,
 * `SigningModule`, `LifecycleModule` on the API side; `SealingWorkerModule`,
 * `MaintenanceWorkerModule` on the worker side — the same shape
 * `mail/mail.module.ts`'s `MailProducerModule` already has, since email and
 * webhooks are queued from the same mix of processes.
 */
@Module({
  providers: [WebhookQueueService],
  exports: [WebhookQueueService],
})
export class WebhookProducerModule {}

/** Imported by the API: endpoint registration and management (docs/08, docs/18). */
@Module({
  imports: [WebhookCryptoModule, WebhookProducerModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}

/** Imported by the worker: signs and sends deliveries (docs/08, docs/18). */
@Module({
  imports: [WebhookCryptoModule],
  providers: [WebhookDeliveryProcessor],
})
export class WebhookDeliveryWorkerModule {}
