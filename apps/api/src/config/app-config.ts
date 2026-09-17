import type { Env } from './env.schema';

/**
 * Injection token and type for the validated environment.
 *
 *   constructor(private readonly config: AppConfig) {}
 *
 * The abstract class is the runtime DI token; the interface merge gives it the
 * shape of Env.
 */
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: the class is only a DI token; the value is the object parseEnv() returns.
export abstract class AppConfig {}
export interface AppConfig extends Env {}

export type ServiceName = 'api' | 'worker';

/** Which process is running. Logged on every line as `service`. */
export const SERVICE_NAME = Symbol('SERVICE_NAME');

/** A summary of the configuration that is safe to log: no secrets, no passwords. */
export function describeConfig(config: AppConfig): Record<string, unknown> {
  const database = new URL(config.DATABASE_URL);
  const redis = new URL(config.REDIS_URL);
  return {
    nodeEnv: config.NODE_ENV,
    appUrl: config.APP_URL,
    apiPort: config.API_PORT,
    logLevel: config.LOG_LEVEL,
    logFiles: config.LOG_FILES_ENABLED ? config.LOG_DIR : false,
    database: `${database.username}@${database.host}${database.pathname}`,
    redis: redis.host,
    storage: { endpoint: config.S3_ENDPOINT ?? 'aws-default', bucket: config.S3_BUCKET },
    mail:
      config.MAIL_TRANSPORT === 'smtp'
        ? { transport: 'smtp', host: config.SMTP_HOST, port: config.SMTP_PORT }
        : { transport: config.MAIL_TRANSPORT },
  };
}
