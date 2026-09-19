import type { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config/app-config';
import type { RedisService } from '../redis/redis.service';
import { type AlertDelivery, AlertService } from './alert.service';

function service(options: { to?: string; gate?: 'OK' | null; deliverFails?: boolean } = {}) {
  const set = vi.fn().mockResolvedValue(options.gate === undefined ? 'OK' : options.gate);
  const deliver = vi.fn(async () => {
    if (options.deliverFails) throw new Error('smtp down');
  });
  const logger = { error: vi.fn(), info: vi.fn(), debug: vi.fn() };
  const alerts = new AlertService(
    {
      ALERT_EMAIL: options.to,
      ALERT_EMAIL_MIN_INTERVAL_MINUTES: 15,
      QUEUE_PREFIX: 'ds',
    } as AppConfig,
    { client: { set } } as unknown as RedisService,
    { deliver } as unknown as AlertDelivery,
    'worker',
    logger as unknown as PinoLogger,
  );
  return { alerts, set, deliver, logger };
}

describe('AlertService', () => {
  it('always logs with alert: true, and emails nothing without ALERT_EMAIL', async () => {
    const { alerts, logger, deliver, set } = service();
    await alerts.raise('seal-job-failed', 'Seal job failed permanently', { envelopeId: 'e-1' });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ alert: true, alertKey: 'seal-job-failed', envelopeId: 'e-1' }),
      'Seal job failed permanently',
    );
    expect(set).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  it('emails once per key per interval, through a shared Redis gate', async () => {
    const { alerts, set, deliver } = service({ to: 'ops@example.com' });
    await alerts.raise('seal-job-failed', 'Seal job failed permanently', { envelopeId: 'e-1' });
    expect(set).toHaveBeenCalledWith('ds:alert-gate:seal-job-failed', '1', 'PX', 900_000, 'NX');
    expect(deliver).toHaveBeenCalledWith(
      'ops@example.com',
      expect.objectContaining({
        key: 'seal-job-failed',
        service: 'worker',
        fields: { envelopeId: 'e-1' },
      }),
    );

    const held = service({ to: 'ops@example.com', gate: null });
    await held.alerts.raise('seal-job-failed', 'Again');
    expect(held.deliver).not.toHaveBeenCalled();
  });

  it('never throws, even when the email cannot be sent', async () => {
    const { alerts, logger } = service({ to: 'ops@example.com', deliverFails: true });
    await expect(alerts.raise('audit-write-failed', 'Audit write failed')).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ alertKey: 'audit-write-failed' }),
      'Alert could not be emailed',
    );
  });
});
