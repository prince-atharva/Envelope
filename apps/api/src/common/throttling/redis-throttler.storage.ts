import { createHash } from 'node:crypto';
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { Redis } from 'ioredis';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AlertService } from '../../alert/alert.service';
import { AppConfig } from '../../config/app-config';

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/**
 * One round trip: count the hit, start the window on the first one, and say
 * how long is left. KEYS[1] the counter; ARGV[1] the window in milliseconds.
 */
const INCREMENT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { hits, ttl }`;

/** The counter as the throttler wants it: seconds, and blocked once over the limit. */
function record(hits: number, ttlMs: number, limit: number): ThrottlerStorageRecord {
  const seconds = Math.max(1, Math.ceil(ttlMs / 1000));
  return {
    totalHits: hits,
    timeToExpire: seconds,
    isBlocked: hits > limit,
    timeToBlockExpire: hits > limit ? seconds : 0,
  };
}

/**
 * Request counts shared by every API server, in Redis (docs/16 step 13).
 *
 * Its own connection, which fails fast (no offline queue, no retries, a short
 * command timeout): the shared BullMQ connection waits for ever while Redis is
 * down, and every request would wait with it. When Redis fails, this process
 * counts in its own memory, so limits still hold per server; one alert is
 * raised when that starts, and recovery is logged. Refusing everyone, signers
 * included, or dropping login protection during an outage would both be worse.
 *
 * Keys are `{prefix}:rl:{bucket}:{hash}`. The key the caller passes (a tenant
 * id, an email, a link, an address) is hashed, so none of them is ever stored.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage, OnModuleInit, OnModuleDestroy {
  readonly client: Redis;
  private readonly prefix: string;
  private readonly memory = new Map<string, { hits: number; expiresAt: number }>();
  private degraded = false;

  constructor(
    config: AppConfig,
    private readonly alerts: AlertService,
    @InjectPinoLogger(RedisThrottlerStorage.name) private readonly logger: PinoLogger,
  ) {
    this.prefix = config.RATE_LIMIT_KEY_PREFIX ?? config.QUEUE_PREFIX;
    this.client = new Redis(config.REDIS_URL, {
      connectionName: 'digitalsign-ratelimit',
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      commandTimeout: config.RATE_LIMIT_REDIS_TIMEOUT_MS,
    });
    // Reconnecting is ioredis's job; failures surface on the commands.
    this.client.on('error', () => undefined);
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
    } catch (error) {
      this.fallBack(error);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }

  keyFor(key: string, bucket: string): string {
    const hash = createHash('sha256').update(key).digest('hex').slice(0, 32);
    return `${this.prefix}:rl:${bucket}:${hash}`;
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    _blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const redisKey = this.keyFor(key, throttlerName);
    try {
      const [hits, ttlMs] = (await this.client.eval(INCREMENT, 1, redisKey, ttl)) as [
        number,
        number,
      ];
      if (this.degraded) {
        this.degraded = false;
        this.memory.clear();
        this.logger.info('Rate limits counted in Redis again');
      }
      return record(hits, ttlMs, limit);
    } catch (error) {
      this.fallBack(error);
      return this.countInMemory(redisKey, ttl, limit);
    }
  }

  private fallBack(error: unknown): void {
    if (this.degraded) return;
    this.degraded = true;
    // Not awaited: the alert's own Redis gate may be waiting on the same outage.
    void this.alerts.raise(
      'rate-limit-redis-down',
      'Rate limits are counted per server: Redis is unavailable',
      {},
      error,
    );
  }

  private countInMemory(key: string, ttl: number, limit: number): ThrottlerStorageRecord {
    const now = Date.now();
    if (this.memory.size > 10_000) {
      for (const [k, entry] of this.memory) if (entry.expiresAt <= now) this.memory.delete(k);
    }
    const entry = this.memory.get(key);
    const current = entry && entry.expiresAt > now ? entry : { hits: 0, expiresAt: now + ttl };
    current.hits += 1;
    this.memory.set(key, current);
    return record(current.hits, current.expiresAt - now, limit);
  }
}
