import type { Queue } from 'bullmq';
import type { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config/app-config';
import { EXPIRY_SWEEP_JOB, MaintenanceScheduler } from './maintenance.scheduler';

function scheduler(config: Partial<AppConfig>) {
  const queue = { upsertJobScheduler: vi.fn().mockResolvedValue(undefined) };
  const logger = { info: vi.fn() };
  const instance = new MaintenanceScheduler(
    queue as unknown as Queue,
    config as AppConfig,
    logger as unknown as PinoLogger,
  );
  return { instance, queue };
}

describe('MaintenanceScheduler', () => {
  it('registers the expiry sweep by a fixed id, so every worker shares one schedule', async () => {
    const { instance, queue } = scheduler({
      MAINTENANCE_SCHEDULES_ENABLED: true,
      EXPIRY_SWEEP_EVERY_MS: 300_000,
    });
    await instance.onApplicationBootstrap();
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      EXPIRY_SWEEP_JOB,
      { every: 300_000 },
      { name: EXPIRY_SWEEP_JOB },
    );
  });

  it('registers nothing when schedules are turned off', async () => {
    const { instance, queue } = scheduler({ MAINTENANCE_SCHEDULES_ENABLED: false });
    await instance.onApplicationBootstrap();
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
  });
});
