import type { PinoLogger } from 'nestjs-pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AlertService } from '../../alert/alert.service';
import type { AppConfig } from '../../config/app-config';
import { RedisThrottlerStorage } from './redis-throttler.storage';

function storage() {
  const raise = vi.fn().mockResolvedValue(undefined);
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const instance = new RedisThrottlerStorage(
    {
      REDIS_URL: 'redis://localhost:1/0',
      QUEUE_PREFIX: 'ds',
      RATE_LIMIT_REDIS_TIMEOUT_MS: 50,
    } as AppConfig,
    { raise } as unknown as AlertService,
    logger as unknown as PinoLogger,
  );
  const evalSpy = vi.spyOn(instance.client, 'eval');
  return { instance, raise, logger, evalSpy };
}

describe('RedisThrottlerStorage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reports the count and the seconds left, blocked once over the limit', async () => {
    const { instance, evalSpy } = storage();
    evalSpy.mockResolvedValueOnce([3, 42_500]).mockResolvedValueOnce([6, 1_200]);
    expect(await instance.increment('tenant-1', 60_000, 5, 60_000, 'tenant-lifecycle')).toEqual({
      totalHits: 3,
      timeToExpire: 43,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    expect(await instance.increment('tenant-1', 60_000, 5, 60_000, 'tenant-lifecycle')).toEqual({
      totalHits: 6,
      timeToExpire: 2,
      isBlocked: true,
      timeToBlockExpire: 2,
    });
  });

  it('hashes what it is keyed on, so no id, email or link reaches Redis', async () => {
    const { instance, evalSpy } = storage();
    evalSpy.mockResolvedValue([1, 60_000]);
    await instance.increment('priya@example.com', 60_000, 5, 60_000, 'login-account');
    const key = String(evalSpy.mock.calls[0]?.[2]);
    expect(key).toMatch(/^ds:rl:login-account:[0-9a-f]{32}$/);
    expect(key).not.toContain('priya');
  });

  it('counts in memory while Redis is down, alerts once, and says when it is back', async () => {
    const { instance, evalSpy, raise, logger } = storage();
    evalSpy.mockRejectedValue(new Error('Connection is closed.'));
    const hits = [];
    for (let i = 0; i < 6; i += 1) {
      hits.push(await instance.increment('ip-1', 60_000, 5, 60_000, 'default'));
    }
    expect(hits.map((h) => h.totalHits)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(hits.at(-1)?.isBlocked).toBe(true);
    expect(raise).toHaveBeenCalledTimes(1);
    expect(raise.mock.calls[0]?.[0]).toBe('rate-limit-redis-down');

    evalSpy.mockResolvedValue([1, 60_000]);
    await instance.increment('ip-1', 60_000, 5, 60_000, 'default');
    expect(logger.info).toHaveBeenCalledWith('Rate limits counted in Redis again');
  });
});
