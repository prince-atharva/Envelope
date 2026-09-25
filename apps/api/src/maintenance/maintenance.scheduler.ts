import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfig } from '../config/app-config';
import { MAINTENANCE_QUEUE } from '../queue/queue.module';

export const EXPIRY_SWEEP_JOB = 'expiry-sweep';
export const AUTO_REMINDERS_JOB = 'auto-reminders';
export const AUDIT_CHAIN_CHECK_JOB = 'audit-chain-check';
export const SESSION_CLEANUP_JOB = 'session-cleanup';
export const RETENTION_SWEEP_JOB = 'retention-sweep';
export const WEBHOOK_DELIVERY_PURGE_JOB = 'webhook-delivery-purge';

/** A job on a fixed interval, or at the times a cron pattern names (UTC). */
export type Schedule = { id: string; everyMs: number } | { id: string; pattern: string };

/**
 * Registers the scheduled jobs when a worker starts. BullMQ job schedulers are
 * keyed by id, so every worker upserting the same one leaves a single
 * schedule, and one tick makes one job however many workers run.
 */
@Injectable()
export class MaintenanceScheduler implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(MAINTENANCE_QUEUE) private readonly queue: Queue,
    private readonly config: AppConfig,
    @InjectPinoLogger(MaintenanceScheduler.name) private readonly logger: PinoLogger,
  ) {}

  schedules(): Schedule[] {
    return [
      { id: EXPIRY_SWEEP_JOB, everyMs: this.config.EXPIRY_SWEEP_EVERY_MS },
      { id: AUTO_REMINDERS_JOB, everyMs: this.config.REMINDER_SWEEP_EVERY_MS },
      { id: AUDIT_CHAIN_CHECK_JOB, pattern: this.config.AUDIT_CHAIN_CHECK_CRON },
      { id: SESSION_CLEANUP_JOB, pattern: this.config.SESSION_CLEANUP_CRON },
      { id: RETENTION_SWEEP_JOB, pattern: this.config.RETENTION_SWEEP_CRON },
      { id: WEBHOOK_DELIVERY_PURGE_JOB, pattern: this.config.WEBHOOK_DELIVERY_PURGE_CRON },
    ];
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.MAINTENANCE_SCHEDULES_ENABLED) {
      this.logger.info(
        'Maintenance schedules not registered (MAINTENANCE_SCHEDULES_ENABLED=false)',
      );
      return;
    }
    for (const schedule of this.schedules()) {
      const repeat =
        'pattern' in schedule
          ? { pattern: schedule.pattern, tz: 'UTC' }
          : { every: schedule.everyMs };
      await this.queue.upsertJobScheduler(schedule.id, repeat, { name: schedule.id });
    }
    this.logger.info({ schedules: this.schedules() }, 'Maintenance schedules registered');
  }
}
