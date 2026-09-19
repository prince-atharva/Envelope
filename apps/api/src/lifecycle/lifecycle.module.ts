import { Module } from '@nestjs/common';
import { MailProducerModule } from '../mail/mail.module';
import { CancelService } from './cancel.service';
import { LifecycleController } from './lifecycle.controller';

/** Phase 5: what happens to an envelope between sending and finishing (docs/16). */
@Module({
  imports: [MailProducerModule],
  controllers: [LifecycleController],
  providers: [CancelService],
})
export class LifecycleModule {}
