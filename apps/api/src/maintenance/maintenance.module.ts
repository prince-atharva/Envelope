import { Module } from '@nestjs/common';
import { MailProducerModule } from '../mail/mail.module';
import { WebhookProducerModule } from '../webhooks/webhooks.module';
import { AuditChainCheckService } from './audit-chain-check.service';
import { AutoReminderService } from './auto-reminder.service';
import { ExpirySweepService } from './expiry-sweep.service';
import { MaintenanceProcessor } from './maintenance.processor';
import { MaintenanceScheduler } from './maintenance.scheduler';
import { RetentionService } from './retention.service';
import { SessionCleanupService } from './session-cleanup.service';
import { WebhookDeliveryPurgeService } from './webhook-delivery-purge.service';

/** Imported by the worker: scheduled housekeeping (docs/16 step 6, docs/17 step 8, docs/18). */
@Module({
  imports: [MailProducerModule, WebhookProducerModule],
  providers: [
    MaintenanceProcessor,
    MaintenanceScheduler,
    ExpirySweepService,
    AutoReminderService,
    AuditChainCheckService,
    SessionCleanupService,
    RetentionService,
    WebhookDeliveryPurgeService,
  ],
  exports: [
    ExpirySweepService,
    AutoReminderService,
    AuditChainCheckService,
    SessionCleanupService,
    RetentionService,
    WebhookDeliveryPurgeService,
  ],
})
export class MaintenanceWorkerModule {}
