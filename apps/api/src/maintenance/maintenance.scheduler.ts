import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfig } from '../config/app-config';
import { MAINTENANCE_QUEUE } from '../queue/queue.module';

export const EXPIRY_SWEEP_JOB = 'expiry-sweep';
export const AUTO_REMINDERS_JOB = 'auto-reminders';

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

  schedules(): { id: string; everyMs: number }[] {
    return [
      { id: EXPIRY_SWEEP_JOB, everyMs: this.config.EXPIRY_SWEEP_EVERY_MS },
      { id: AUTO_REMINDERS_JOB, everyMs: this.config.REMINDER_SWEEP_EVERY_MS },
    ];
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.MAINTENANCE_SCHEDULES_ENABLED) {
      this.logger.info(
        'Maintenance schedules not registered (MAINTENANCE_SCHEDULES_ENABLED=false)',
      );
      return;
    }
    for (const { id, everyMs } of this.schedules()) {
      await this.queue.upsertJobScheduler(id, { every: everyMs }, { name: id });
    }
    this.logger.info({ schedules: this.schedules() }, 'Maintenance schedules registered');
  }
}
