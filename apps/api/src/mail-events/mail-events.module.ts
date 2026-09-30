import { Module } from '@nestjs/common';
import { MailProducerModule } from '../mail/mail.module';
import { MailEventsController } from './mail-events.controller';
import { MailEventsService } from './mail-events.service';

/** Delivery events from a mail provider (docs/20, ADR 0029). */
@Module({
  imports: [MailProducerModule],
  controllers: [MailEventsController],
  providers: [MailEventsService],
})
export class MailEventsModule {}
