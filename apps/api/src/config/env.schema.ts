import { BRAND } from '@digitalsign/shared';
import { z } from 'zod';

const port = z.coerce.number().int().min(1).max(65535);
const flag = z.stringbool();
const secret = z.string().min(32, 'must be at least 32 characters (use: openssl rand -base64 48)');

const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_NAME: z.string().min(1).default(BRAND.fullName),
    /** Public URL of the web app, used for links in emails. */
    APP_URL: z.url(),
    /** Base for relative paths such as LOG_DIR. Set by loadEnvFile() when a .env is found. */
    APP_ROOT_DIR: z.string().min(1).default(process.cwd()),
    API_PORT: port.default(4000),
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    /** Express "trust proxy" setting; decides which client IP is logged and rate-limited. */
    TRUST_PROXY: z.string().default('loopback'),
    API_DOCS_ENABLED: flag.optional(),

    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    LOG_DIR: z.string().min(1).default('logs'),
    LOG_FILES_ENABLED: flag.default(true),
    LOG_PRETTY: flag.optional(),
    LOG_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(14),

    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'must be a postgresql:// URL' }),
    DB_SLOW_QUERY_MS: z.coerce.number().int().min(1).default(500),

    REDIS_URL: z.url({ protocol: /^rediss?$/, error: 'must be a redis:// or rediss:// URL' }),

    JWT_ACCESS_SECRET: secret,
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_SECRET: secret,
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),

    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_BUCKET: z.string().min(3),
    S3_FORCE_PATH_STYLE: flag.default(false),

    MAIL_TRANSPORT: z.enum(['smtp', 'memory']).default('smtp'),
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: port.default(587),
    SMTP_SECURE: flag.default(false),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    SMTP_FROM: z.string().min(3).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.MAIL_TRANSPORT === 'smtp') {
      for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'required when MAIL_TRANSPORT=smtp',
          });
        }
      }
    }
    if (env.NODE_ENV === 'production' && env.MAIL_TRANSPORT === 'memory') {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_TRANSPORT'],
        message: 'memory transport is for tests only',
      });
    }
    if (env.JWT_ACCESS_SECRET === env.REFRESH_TOKEN_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['REFRESH_TOKEN_SECRET'],
        message: 'must be different from JWT_ACCESS_SECRET',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export class InvalidEnvironmentError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid environment configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'InvalidEnvironmentError';
  }
}

/**
 * Validates the environment. Empty strings count as "not set". Error messages
 * name the variable and the rule, never the value, so secrets cannot leak into
 * startup logs.
 */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const present = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ''),
  );
  const result = envSchema.safeParse(present);
  if (!result.success) {
    throw new InvalidEnvironmentError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return result.data;
}
