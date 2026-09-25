import { Module } from '@nestjs/common';
import { MailProducerModule } from '../mail/mail.module';
import { CompletionDownloadController } from './completion-download.controller';
import { CompletionDownloadService } from './completion-download.service';

/** Public: the finished document behind a completion email's download link. */
@Module({
  imports: [MailProducerModule],
  controllers: [CompletionDownloadController],
  providers: [CompletionDownloadService],
})
export class CompletionModule {}
