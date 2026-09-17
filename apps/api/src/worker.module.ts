import { Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { ConfigModule } from './config/config.module';
import { LoggingModule } from './logging/logging.module';
import { MailWorkerModule } from './mail/mail.module';
import { QueueModule } from './queue/queue.module';

/** The background worker process: consumes queue jobs. No HTTP server. */
@Module({
  imports: [
    ConfigModule,
    LoggingModule.forRoot('worker'),
    ClsModule.forRoot({ global: true }),
    QueueModule,
    MailWorkerModule,
  ],
})
export class WorkerModule {}
