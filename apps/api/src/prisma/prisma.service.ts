import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { ClsService } from 'nestjs-cls';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { RequestContext } from '../common/request-context';
import { AppConfig, SERVICE_NAME, type ServiceName } from '../config/app-config';
import { type Prisma, PrismaClient } from '../generated/prisma/client';

const MAX_LOGGED_QUERY_LENGTH = 500;

/**
 * `idle_in_transaction_session_timeout`, in milliseconds: how long a
 * connection may sit inside an open transaction between statements before
 * Postgres kills it. Not operator-tunable (unlike DB_STATEMENT_TIMEOUT_MS):
 * it exists to bound each process's own transaction shape, not the database's.
 *
 * The API's transactions are DB-only, so a short budget is correct. The
 * worker's sealFinal still holds one open across a single S3 upload (the
 * Object Lock write, ADR 0007) — everything slower than that (download,
 * PDF stamping) was moved out of any transaction in the same change that
 * added this (100M-row scale follow-up, docs/16 step 14) — so it gets a
 * longer budget to comfortably cover that one call, not the unbounded one
 * the whole round used to need.
 */
const IDLE_IN_TRANSACTION_TIMEOUT_MS: Record<ServiceName, number> = {
  api: 10_000,
  worker: 60_000,
};

type EventLogDefinitions = [
  { emit: 'event'; level: 'query' },
  { emit: 'event'; level: 'warn' },
  { emit: 'event'; level: 'error' },
];
type ClientOptions = Prisma.PrismaClientOptions & { log: EventLogDefinitions };

/**
 * The database client. Connects as the restricted runtime role (DATABASE_URL),
 * which cannot UPDATE or DELETE audit rows.
 *
 * Logging: slow queries (over DB_SLOW_QUERY_MS) are warnings and Prisma errors
 * are errors. Query parameters are never logged, because they contain user data.
 */
@Injectable()
export class PrismaService
  extends PrismaClient<ClientOptions>
  implements OnModuleInit, OnModuleDestroy
{
  constructor(
    private readonly config: AppConfig,
    @Inject(SERVICE_NAME) service: ServiceName,
    private readonly cls: ClsService<RequestContext>,
    @InjectPinoLogger(PrismaService.name) private readonly logger: PinoLogger,
  ) {
    super({
      adapter: new PrismaPg({
        connectionString: config.DATABASE_URL,
        application_name: `digitalsign-${service}`,
        // Sized and timed out explicitly: unset, the pg pool falls back to
        // its own default of 10 connections regardless of how many
        // processes are running, and neither timeout below exists at all
        // (100M-row scale follow-up, docs/16 step 14).
        max: service === 'worker' ? config.DB_POOL_MAX_WORKER : config.DB_POOL_MAX,
        idleTimeoutMillis: config.DB_POOL_IDLE_TIMEOUT_MS,
        connectionTimeoutMillis: config.DB_CONNECT_TIMEOUT_MS,
        statement_timeout: config.DB_STATEMENT_TIMEOUT_MS,
        idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_TIMEOUT_MS[service],
      }),
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    this.$on('query', (event) => {
      // Counted per request, surfaced on the request's own log line
      // (DbQueryCountInterceptor) rather than logged here: a high count on
      // one endpoint is the N+1 pattern the 100M-row scale audit went
      // looking for, and it should show up without grepping for it.
      if (this.cls.isActive()) {
        this.cls.set('dbQueryCount', (this.cls.get('dbQueryCount') ?? 0) + 1);
      }
      if (event.duration >= this.config.DB_SLOW_QUERY_MS) {
        this.logger.warn(
          {
            durationMs: event.duration,
            query: event.query.slice(0, MAX_LOGGED_QUERY_LENGTH),
          },
          'Slow database query',
        );
      }
    });
    this.$on('warn', (event) => {
      this.logger.warn({ target: event.target }, `Prisma warning: ${event.message}`);
    });
    this.$on('error', (event) => {
      this.logger.error(
        { target: event.target },
        `Prisma error${event.message ? `: ${event.message}` : ''}`,
      );
    });

    const target = new URL(this.config.DATABASE_URL);
    const where = `${target.username}@${target.host}${target.pathname}`;
    const started = performance.now();
    try {
      await this.$queryRaw`SELECT 1`;
    } catch (error) {
      this.logger.fatal(
        { err: error, database: where },
        'Cannot reach PostgreSQL. Is `docker compose up -d` running?',
      );
      throw error;
    }
    this.logger.info(
      { database: where, durationMs: Math.round(performance.now() - started) },
      'Database connected',
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.info('Database connection closed');
  }
}
