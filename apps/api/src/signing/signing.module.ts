import { Module, type OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { MailProducerModule } from '../mail/mail.module';
import { SealProducerModule } from '../sealing/sealing.module';
import { WebhookProducerModule } from '../webhooks/webhooks.module';
import { CONSENT_TEXT_IS_DRAFT } from './consent-text';
import { SigningController } from './signing.controller';
import { SigningService } from './signing.service';
import { SigningRateLimitGuard } from './signing-rate-limit.guard';
import { TokenGuardianService } from './token-guardian.service';

/** The public signing surface: everything a signer reaches through their link. */
@Module({
  imports: [MailProducerModule, SealProducerModule, WebhookProducerModule],
  controllers: [SigningController],
  providers: [TokenGuardianService, SigningService, SigningRateLimitGuard],
  exports: [TokenGuardianService],
})
export class SigningModule implements OnModuleInit {
  constructor(@InjectPinoLogger(SigningModule.name) private readonly logger: PinoLogger) {}

  onModuleInit(): void {
    if (CONSENT_TEXT_IS_DRAFT) {
      // Every start-up says so until the lawyer-approved wording is in.
      this.logger.warn(
        'The consent notice is a DRAFT placeholder; replace it with approved wording before real use',
      );
    }
  }
}
