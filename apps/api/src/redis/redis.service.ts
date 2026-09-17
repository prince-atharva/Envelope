import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfig, SERVICE_NAME, type ServiceName } from '../config/app-config';

/** Connection problems are logged at most this often, so an outage does not flood the logs. */
const PROBLEM_LOG_INTERVAL_MS = 30_000;

/** Shared Redis connection (health checks now; BullMQ queues reuse the settings). */
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;
  private lastProblemLoggedAt = 0;
  private healthy = false;

  constructor(
    config: AppConfig,
    @Inject(SERVICE_NAME) service: ServiceName,
    @InjectPinoLogger(RedisService.name) private readonly logger: PinoLogger,
  ) {
    const target = new URL(config.REDIS_URL);
    this.client = new Redis(config.REDIS_URL, {
      connectionName: `digitalsign-${service}`,
      // Required by BullMQ, and lets commands wait for a reconnect instead of failing fast.
      maxRetriesPerRequest: null,
    });

    this.client.on('ready', () => {
      this.healthy = true;
      this.logger.info({ redis: target.host }, 'Redis connection ready');
    });
    this.client.on('error', (error) => {
      this.logProblem(() => this.logger.error({ err: error, redis: target.host }, 'Redis error'));
    });
    this.client.on('reconnecting', (delayMs: number) => {
      this.logProblem(() =>
        this.logger.warn({ redis: target.host, delayMs }, 'Redis reconnecting'),
      );
    });
  }

  private logProblem(write: () => void): void {
    const now = Date.now();
    if (this.healthy || now - this.lastProblemLoggedAt >= PROBLEM_LOG_INTERVAL_MS) {
      this.healthy = false;
      this.lastProblemLoggedAt = now;
      write();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
    this.logger.info('Redis connection closed');
  }
}
