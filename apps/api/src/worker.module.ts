import { Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { AuditModule } from './audit/audit.module';
import { ConfigModule } from './config/config.module';
import { LoggingModule } from './logging/logging.module';
import { MailWorkerModule } from './mail/mail.module';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';
import { SealingWorkerModule } from './sealing/sealing.module';
import { StorageModule } from './storage/storage.module';

/**
 * The background worker process: consumes queue jobs. No HTTP server.
 *
 * It reaches the database and the audit trail because it mints signing links
 * when it emails them (ADR 0009), and object storage because it stamps
 * signatures into document versions (ADR 0006).
 */
@Module({
  imports: [
    ConfigModule,
    LoggingModule.forRoot('worker'),
    ClsModule.forRoot({ global: true }),
    PrismaModule,
    AuditModule,
    StorageModule,
    QueueModule,
    MailWorkerModule,
    SealingWorkerModule,
  ],
})
export class WorkerModule {}
