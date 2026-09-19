import { BRAND, DEFAULT_EXPIRY_DAYS, MAX_EXPIRY_DAYS } from '@envelope/shared';
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
    /** Namespace for BullMQ keys in Redis. */
    QUEUE_PREFIX: z
      .string()
      .regex(/^[a-z0-9-]+$/, 'use lowercase letters, digits and dashes')
      .default('digitalsign'),

    JWT_ACCESS_SECRET: secret,
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_SECRET: secret,
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),

    /** HMAC key for signing-link tokens (ADR 0009). Rotating it invalidates every open link. */
    SIGNING_TOKEN_SECRET: secret,
    /** How long signing links last when the sender does not choose. */
    SIGNING_DEFAULT_EXPIRY_DAYS: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_EXPIRY_DAYS)
      .default(DEFAULT_EXPIRY_DAYS),

    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_BUCKET: z.string().min(3),
    S3_FORCE_PATH_STYLE: flag.default(false),
    /**
     * Where sealed, final documents go (ADR 0007). The bucket must be created
     * with Object Lock on. Defaults to "<S3_BUCKET>-sealed".
     */
    S3_SEALED_BUCKET: z.string().min(3).optional(),
    /**
     * COMPLIANCE: nobody can delete a sealed file before its retention date, not
     * even the storage account's root user. GOVERNANCE allows it with a special
     * permission, so dev and test files can be cleaned up. Defaults to
     * COMPLIANCE in production and GOVERNANCE elsewhere.
     */
    SEALED_RETENTION_MODE: z.enum(['GOVERNANCE', 'COMPLIANCE']).optional(),
    /** How long a sealed file is locked. Seven years by default (docs/01, docs/07). */
    SEALED_RETENTION_DAYS: z.coerce.number().int().min(1).max(36_500).default(2557),

    /**
     * smtp sends for real. memory keeps messages in the process (API e2e tests).
     * file writes each message as JSON to MAIL_OUTBOX_DIR and sends nothing
     * (browser tests, and trying the signing flow without an SMTP account).
     */
    MAIL_TRANSPORT: z.enum(['smtp', 'memory', 'file']).default('smtp'),
    /** Relative to APP_ROOT_DIR. Only used with MAIL_TRANSPORT=file. */
    MAIL_OUTBOX_DIR: z.string().min(1).default('.mail-outbox'),
    /** First retry delay for a failed email; each later retry waits twice as long. */
    EMAIL_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(10).default(10_000),
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
    if (env.NODE_ENV === 'test' && env.MAIL_TRANSPORT === 'smtp') {
      // Tests use made-up addresses; real email to them bounces back to the sender.
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_TRANSPORT'],
        message: 'tests never send real email: use memory or file',
      });
    }
    if (env.NODE_ENV === 'production' && env.MAIL_TRANSPORT !== 'smtp') {
      // A file outbox would put live signing links on disk.
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_TRANSPORT'],
        message: `${env.MAIL_TRANSPORT} transport is for development and tests only`,
      });
    }
    if (env.JWT_ACCESS_SECRET === env.REFRESH_TOKEN_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['REFRESH_TOKEN_SECRET'],
        message: 'must be different from JWT_ACCESS_SECRET',
      });
    }
    if (
      env.SIGNING_TOKEN_SECRET === env.JWT_ACCESS_SECRET ||
      env.SIGNING_TOKEN_SECRET === env.REFRESH_TOKEN_SECRET
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['SIGNING_TOKEN_SECRET'],
        message: 'must be different from JWT_ACCESS_SECRET and REFRESH_TOKEN_SECRET',
      });
    }
    if (env.NODE_ENV === 'production' && env.SEALED_RETENTION_MODE === 'GOVERNANCE') {
      // A sealed contract that an administrator can delete is not sealed (ADR 0007).
      ctx.addIssue({
        code: 'custom',
        path: ['SEALED_RETENTION_MODE'],
        message: 'must be COMPLIANCE in production',
      });
    }
    if (env.S3_SEALED_BUCKET !== undefined && env.S3_SEALED_BUCKET === env.S3_BUCKET) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_SEALED_BUCKET'],
        message: 'must be a separate bucket from S3_BUCKET, created with Object Lock on',
      });
    }
  })
  .transform((env) => ({
    ...env,
    S3_SEALED_BUCKET: env.S3_SEALED_BUCKET ?? `${env.S3_BUCKET}-sealed`,
    SEALED_RETENTION_MODE:
      env.SEALED_RETENTION_MODE ?? (env.NODE_ENV === 'production' ? 'COMPLIANCE' : 'GOVERNANCE'),
  }));

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
