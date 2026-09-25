import { BRAND, DEFAULT_EXPIRY_DAYS, MAX_EXPIRY_DAYS } from '@envelope/shared';
import { z } from 'zod';

const port = z.coerce.number().int().min(1).max(65535);
const flag = z.stringbool();
const secret = z.string().min(32, 'must be at least 32 characters (use: openssl rand -base64 48)');
/** Exactly 32 raw bytes, base64-encoded: an AES-256 key (use: openssl rand -base64 32). */
const aes256Key = z.base64().refine((value) => Buffer.from(value, 'base64').length === 32, {
  error: 'must decode to exactly 32 bytes (use: openssl rand -base64 32)',
});

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
    /**
     * 100 by default, not the audit's original 500: at 100M-row scale a
     * "slow" query is one worth knowing about quickly, not one already
     * costing seconds.
     */
    DB_SLOW_QUERY_MS: z.coerce.number().int().min(1).default(100),
    /** Connections the API process's pool may open. pg's own default (10) if unset. */
    DB_POOL_MAX: z.coerce.number().int().min(1).default(10),
    /**
     * Connections the worker process's pool may open. Smaller than the API's:
     * the seal, email and maintenance queues together run at concurrency 8.
     */
    DB_POOL_MAX_WORKER: z.coerce.number().int().min(1).default(5),
    /** How long a pooled connection may sit unused before it is closed. */
    DB_POOL_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30_000),
    /** How long to wait for a new connection before giving up. */
    DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(100).default(5_000),
    /**
     * Postgres kills any single statement that runs longer than this
     * (`statement_timeout`). Same budget for both processes: after the
     * sealing rework, no worker statement should legitimately run long
     * either — the slow parts (download, PDF stamping, upload) now happen
     * with no transaction open.
     */
    DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).default(5_000),

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

    /** HMAC key for API keys (docs/18). Rotating it revokes every issued key at once. */
    API_KEY_HASH_SECRET: secret,
    /**
     * AES-256-GCM key that encrypts webhook signing secrets at rest (docs/18,
     * ADR 0015). Unlike the HMAC secrets above, a webhook secret must be
     * recovered in full to sign each delivery, so it cannot only be hashed.
     * Rotating this key makes every stored webhook secret unrecoverable —
     * endpoints would need to be re-created.
     */
    WEBHOOK_SECRET_ENC_KEY: aes256Key,
    /**
     * Lets a webhook endpoint be http and/or resolve to a private address,
     * bypassing `webhook-url-guard.ts` (docs/18). Exists only for the e2e
     * suite's local receiver, the same way `S3_ENDPOINT` points at a real
     * local MinIO over plain http rather than a mock. Never true in
     * production — enforced below.
     */
    WEBHOOK_ALLOW_INSECURE_LOCAL_URLS: flag.default(false),
    /**
     * Six comma-separated millisecond delays for webhook delivery retries
     * (docs/08: 10s, 1m, 5m, 30m, 2h, 12h by default). Overridable so the
     * e2e suite can exercise retry and exhaustion in milliseconds instead
     * of hours, the same reason EMAIL_RETRY_BASE_DELAY_MS exists.
     */
    WEBHOOK_RETRY_SCHEDULE_MS: z.string().default('10000,60000,300000,1800000,7200000,43200000'),

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
    /**
     * The largest finished document attached to the completion email. Anything
     * larger is sent as a private download link instead (docs/15 step 6).
     */
    COMPLETION_ATTACHMENT_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(1)
      .default(15 * 1024 * 1024),
    /** How long a completion download link works. */
    COMPLETION_LINK_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    /**
     * Whether this worker registers the scheduled maintenance jobs (docs/16
     * step 6). Off in the API e2e suite, which runs each job directly.
     */
    MAINTENANCE_SCHEDULES_ENABLED: flag.default(true),
    /**
     * Automatic reminders for envelopes sent without choosing: every this many
     * days. 0 means off unless the sender turns them on.
     */
    AUTO_REMINDER_DEFAULT_DAYS: z.coerce.number().int().min(0).max(30).default(3),
    /** How long before the deadline the one "expires soon" email goes out. */
    EXPIRY_WARNING_HOURS: z.coerce.number().int().min(1).max(720).default(48),
    /** How often the reminder job looks for people due an automatic email. */
    REMINDER_SWEEP_EVERY_MS: z.coerce.number().int().min(1000).default(900_000),
    /** When the nightly audit-chain check runs: a cron pattern, in UTC. */
    AUDIT_CHAIN_CHECK_CRON: z.string().trim().min(9).default('0 2 * * *'),
    /** How often the expiry sweep looks for envelopes past their deadline. */
    EXPIRY_SWEEP_EVERY_MS: z.coerce.number().int().min(1000).default(300_000),
    /**
     * When the nightly session cleanup runs: a cron pattern, in UTC. Deletes
     * expired refresh-token rows in batches (100M-row scale follow-up,
     * docs/16 step 14) — nothing ever deletes them otherwise, so the table
     * only grows.
     */
    SESSION_CLEANUP_CRON: z.string().trim().min(9).default('30 2 * * *'),
    /** A session is deleted this long after it expired, not the moment it does. */
    SESSION_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    /**
     * When the retention sweeper runs: a cron pattern, in UTC (docs/17 step
     * 8). Removes an old unsent draft's or a cancelled/declined envelope's
     * storage objects; never a completed envelope's sealed file, and never
     * an audit row (ADR 0014).
     */
    RETENTION_SWEEP_CRON: z.string().trim().min(9).default('0 3 * * *'),
    /**
     * When the webhook-delivery purge runs: a cron pattern, in UTC (docs/18).
     * Removes WebhookDelivery rows past the 7-day retention docs/08
     * documents for failed deliveries, applied to every status.
     */
    WEBHOOK_DELIVERY_PURGE_CRON: z.string().trim().min(9).default('30 3 * * *'),
    /**
     * Where urgent problems are emailed (docs/16 step 11). Unset: alerts are
     * only logged, with `alert: true`.
     */
    ALERT_EMAIL: z.email().optional(),
    /** The same alert is emailed at most this often; repeats in between are only logged. */
    ALERT_EMAIL_MIN_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
    /**
     * How long a rate-limit count may wait for Redis before this process counts
     * in its own memory instead (docs/16 step 13).
     */
    RATE_LIMIT_REDIS_TIMEOUT_MS: z.coerce.number().int().min(10).max(5000).default(250),
    /**
     * Prefix of the rate-limit keys, `{prefix}:rl:…`. Defaults to QUEUE_PREFIX.
     * The API e2e suite gives each test file its own, so counts never carry
     * from one file into the next.
     */
    RATE_LIMIT_KEY_PREFIX: z.string().trim().min(1).optional(),
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
    if (
      env.API_KEY_HASH_SECRET === env.JWT_ACCESS_SECRET ||
      env.API_KEY_HASH_SECRET === env.REFRESH_TOKEN_SECRET ||
      env.API_KEY_HASH_SECRET === env.SIGNING_TOKEN_SECRET
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['API_KEY_HASH_SECRET'],
        message:
          'must be different from JWT_ACCESS_SECRET, REFRESH_TOKEN_SECRET and SIGNING_TOKEN_SECRET',
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
    if (env.NODE_ENV === 'production' && env.WEBHOOK_ALLOW_INSECURE_LOCAL_URLS) {
      ctx.addIssue({
        code: 'custom',
        path: ['WEBHOOK_ALLOW_INSECURE_LOCAL_URLS'],
        message: 'must be false in production',
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
