import { Module } from '@nestjs/common';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { MailProducerModule } from '../mail/mail.module';
import { SealProducerModule } from '../sealing/sealing.module';
import { CancelService } from './cancel.service';
import { ExtendService } from './extend.service';
import { LifecycleController } from './lifecycle.controller';
import { ReminderSettingsService } from './reminder-settings.service';

/** Phase 5: what happens to an envelope between sending and finishing (docs/16). */
@Module({
  imports: [MailProducerModule, SealProducerModule],
  controllers: [LifecycleController],
  providers: [CancelService, ExtendService, IdempotencyService, ReminderSettingsService],
})
export class LifecycleModule {}
