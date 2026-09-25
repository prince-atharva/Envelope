import { Module } from '@nestjs/common';
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

/** Imported by the API: endpoint registration and management (docs/08, docs/18). */
@Module({
  imports: [WebhookCryptoModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
