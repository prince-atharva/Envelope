import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfig, SERVICE_NAME, type ServiceName } from '../config/app-config';
import { type Prisma, PrismaClient } from '../generated/prisma/client';

const MAX_LOGGED_QUERY_LENGTH = 500;

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
    @InjectPinoLogger(PrismaService.name) private readonly logger: PinoLogger,
  ) {
    super({
      adapter: new PrismaPg({
        connectionString: config.DATABASE_URL,
        application_name: `digitalsign-${service}`,
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
