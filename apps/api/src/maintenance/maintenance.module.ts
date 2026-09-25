import { Module } from '@nestjs/common';
import { MailProducerModule } from '../mail/mail.module';
import { AuditChainCheckService } from './audit-chain-check.service';
import { AutoReminderService } from './auto-reminder.service';
import { ExpirySweepService } from './expiry-sweep.service';
import { MaintenanceProcessor } from './maintenance.processor';
import { MaintenanceScheduler } from './maintenance.scheduler';
import { RetentionService } from './retention.service';
import { SessionCleanupService } from './session-cleanup.service';

/** Imported by the worker: scheduled housekeeping (docs/16 step 6, docs/17 step 8). */
@Module({
  imports: [MailProducerModule],
  providers: [
    MaintenanceProcessor,
    MaintenanceScheduler,
    ExpirySweepService,
    AutoReminderService,
    AuditChainCheckService,
    SessionCleanupService,
    RetentionService,
  ],
  exports: [
    ExpirySweepService,
    AutoReminderService,
    AuditChainCheckService,
    SessionCleanupService,
    RetentionService,
  ],
})
export class MaintenanceWorkerModule {}
