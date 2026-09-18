import { Module } from '@nestjs/common';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { MailProducerModule } from '../mail/mail.module';
import { SendingController } from './sending.controller';
import { SendingService } from './sending.service';

/** The sender's side of Phase 3: sending an envelope, and later reminders. */
@Module({
  imports: [MailProducerModule],
  controllers: [SendingController],
  providers: [SendingService, IdempotencyService],
  exports: [SendingService],
})
export class SendingModule {}
