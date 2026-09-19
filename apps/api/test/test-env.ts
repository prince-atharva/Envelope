/**
 * Environment for the e2e suites. Defaults match docker-compose.yml; CI overrides
 * them with TEST_* variables. The developer's .env is never loaded here.
 */
const env = process.env;

export const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:5173',
  API_DOCS_ENABLED: 'false',

  DATABASE_URL:
    env.TEST_DATABASE_URL ??
    'postgresql://digitalsign_app:digitalsign_app_dev_password@localhost:5545/digitalsign_test?schema=public',
  DIRECT_DATABASE_URL:
    env.TEST_DIRECT_DATABASE_URL ??
    'postgresql://digitalsign:digitalsign_dev_password@localhost:5545/digitalsign_test?schema=public',
  REDIS_URL: env.TEST_REDIS_URL ?? 'redis://localhost:6391/1',
  QUEUE_PREFIX: 'digitalsign-test',

  JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdefghijklmnop',
  REFRESH_TOKEN_SECRET: 'test-refresh-secret-0123456789abcdefghijklmnop',
  SIGNING_TOKEN_SECRET: 'test-signing-secret-0123456789abcdefghijklmnop',

  S3_ENDPOINT: env.TEST_S3_ENDPOINT ?? 'http://localhost:9102',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: env.TEST_S3_ACCESS_KEY_ID ?? 'digitalsign',
  S3_SECRET_ACCESS_KEY: env.TEST_S3_SECRET_ACCESS_KEY ?? 'digitalsign_dev_password',
  S3_BUCKET: env.TEST_S3_BUCKET ?? 'digitalsign-test',
  S3_FORCE_PATH_STYLE: 'true',
  // digitalsign-test-sealed, created with Object Lock. One day, so test files do not stay locked.
  SEALED_RETENTION_DAYS: '1',

  // Each suite runs the maintenance jobs itself, with the time it needs.
  MAINTENANCE_SCHEDULES_ENABLED: 'false',

  MAIL_TRANSPORT: 'memory',
  // Alerts go to the in-memory mailbox like every other test email.
  ALERT_EMAIL: 'alerts@test.local',
  EMAIL_RETRY_BASE_DELAY_MS: '20',
  SMTP_FROM: 'Envelope by HealthProHub <no-reply@test.local>',

  // Set TEST_LOG_LEVEL=debug to see the application logs while debugging a test.
  LOG_LEVEL: env.TEST_LOG_LEVEL ?? 'silent',
  LOG_FILES_ENABLED: 'false',
  LOG_PRETTY: 'false',
};

/** Refuses to run destructive setup against anything but a *_test database. */
export function assertTestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to reset "${name}": e2e tests only run against a *_test database.`);
  }
}
