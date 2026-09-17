import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { StorageService } from '../storage/storage.service';
import { APP_VERSION } from '../version';

const CHECK_TIMEOUT_MS = 2_000;

export interface DependencyStatus {
  status: 'up' | 'down';
  latencyMs: number;
  error?: string;
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  version: string;
  uptimeSeconds: number;
  checks: Record<string, DependencyStatus>;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
    @InjectPinoLogger(HealthService.name) private readonly logger: PinoLogger,
  ) {}

  /** Checks every dependency in parallel. Failures are logged as warnings. */
  async check(): Promise<HealthReport> {
    const entries = await Promise.all(
      Object.entries(this.checks()).map(
        async ([name, probe]) => [name, await this.run(name, probe)] as const,
      ),
    );
    const checks = Object.fromEntries(entries);
    return {
      status: entries.every(([, result]) => result.status === 'up') ? 'ok' : 'degraded',
      version: APP_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      checks,
    };
  }

  protected checks(): Record<string, () => Promise<unknown>> {
    return {
      database: () => this.prisma.$queryRaw`SELECT 1`,
      redis: () => this.redis.client.ping(),
      storage: () => this.storage.ping(),
    };
  }

  private async run(name: string, probe: () => Promise<unknown>): Promise<DependencyStatus> {
    const started = performance.now();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        probe(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`timed out after ${CHECK_TIMEOUT_MS}ms`)),
            CHECK_TIMEOUT_MS,
          );
        }),
      ]);
      return { status: 'up', latencyMs: Math.round(performance.now() - started) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn({ dependency: name, err: error }, `Health check failed: ${name}`);
      return { status: 'down', latencyMs: Math.round(performance.now() - started), error: message };
    } finally {
      clearTimeout(timer);
    }
  }
}
