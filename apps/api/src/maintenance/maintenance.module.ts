import { Module } from '@nestjs/common';
import { MailProducerModule } from '../mail/mail.module';
import { AutoReminderService } from './auto-reminder.service';
import { ExpirySweepService } from './expiry-sweep.service';
import { MaintenanceProcessor } from './maintenance.processor';
import { MaintenanceScheduler } from './maintenance.scheduler';

/** Imported by the worker: scheduled housekeeping (docs/16 step 6). */
@Module({
  imports: [MailProducerModule],
  providers: [MaintenanceProcessor, MaintenanceScheduler, ExpirySweepService, AutoReminderService],
  exports: [ExpirySweepService, AutoReminderService],
})
export class MaintenanceWorkerModule {}
