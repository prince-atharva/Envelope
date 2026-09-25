import { Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { AlertModule } from './alert/alert.module';
import { AuditModule } from './audit/audit.module';
import { ConfigModule } from './config/config.module';
import { LoggingModule } from './logging/logging.module';
import { MailWorkerModule } from './mail/mail.module';
import { MaintenanceWorkerModule } from './maintenance/maintenance.module';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';
import { RedisModule } from './redis/redis.module';
import { SealingWorkerModule } from './sealing/sealing.module';
import { StorageModule } from './storage/storage.module';
import { WebhookDeliveryWorkerModule } from './webhooks/webhooks.module';

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
    RedisModule,
    AuditModule,
    AlertModule.forRoot('direct'),
    StorageModule,
    QueueModule,
    MailWorkerModule,
    SealingWorkerModule,
    MaintenanceWorkerModule,
    WebhookDeliveryWorkerModule,
  ],
})
export class WorkerModule {}
