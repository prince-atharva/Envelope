// The isolated stack the browser tests run against.
//
// Browser tests must never touch the developer's own setup: not the dev
// database, not the dev Redis queues, not the dev logs, and never real email.
// So they start their own API, worker and web app, on their own ports, with an
// environment built here from scratch. The developer's .env is not read at all
// (ENV_FILE=none), so nothing in it (Gmail password, dev database) can leak in.
//
// Email uses MAIL_TRANSPORT=file: every message is written to the outbox folder
// below and nothing is sent anywhere. The tests read signing links from it.

import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const WEB_DIR = fileURLToPath(new URL('../../', import.meta.url));
export const API_DIR = fileURLToPath(new URL('../../../api/', import.meta.url));

/** Everything the stack writes goes under here (gitignored), and is wiped at start. */
export const E2E_DIR = fileURLToPath(new URL('../../.e2e/', import.meta.url));
export const OUTBOX_DIR = `${E2E_DIR}outbox`;
export const LOG_DIR = `${E2E_DIR}logs`;
export const WEB_OUT_DIR = `${E2E_DIR}web-dist`;
/** The API is compiled here, never into apps/api/dist, which the dev server uses. */
export const API_OUT_DIR = `${API_DIR}.e2e-dist`;

// Not 4000/5173, so the stack runs alongside `pnpm dev` without touching it.
export const API_PORT = 4100;
export const WEB_PORT = 5174;
export const WEB_URL = `http://localhost:${WEB_PORT}`;
export const API_HEALTH_URL = `http://localhost:${API_PORT}/api/v1/health/live`;

const env = process.env;

/** The whole environment of the stack's API and worker. Nothing else is inherited. */
export const STACK_ENV = {
  NODE_ENV: 'test',
  ENV_FILE: 'none',
  APP_URL: WEB_URL,
  APP_ROOT_DIR: REPO_ROOT,
  API_PORT: String(API_PORT),
  API_DOCS_ENABLED: 'false',

  // Its own database, never the dev one, and not the API e2e suite's either:
  // this stack's scheduler expires and reminds whatever it finds (docs/16
  // step 15). start-api.mjs creates it if it is missing.
  DATABASE_URL:
    env.TEST_BROWSER_DATABASE_URL ??
    'postgresql://digitalsign_app:digitalsign_app_dev_password@localhost:5545/digitalsign_browser_test?schema=public',
  DIRECT_DATABASE_URL:
    env.TEST_BROWSER_DIRECT_DATABASE_URL ??
    'postgresql://digitalsign:digitalsign_dev_password@localhost:5545/digitalsign_browser_test?schema=public',
  // Redis database 2 with its own prefix: dev uses 0, the API e2e suite uses 1.
  REDIS_URL: env.TEST_REDIS_URL ?? 'redis://localhost:6391/2',
  QUEUE_PREFIX: 'digitalsign-browser-e2e',

  JWT_ACCESS_SECRET: 'browser-e2e-access-secret-0123456789abcdefghij',
  REFRESH_TOKEN_SECRET: 'browser-e2e-refresh-secret-0123456789abcdefghij',
  SIGNING_TOKEN_SECRET: 'browser-e2e-signing-secret-0123456789abcdefghij',

  S3_ENDPOINT: env.TEST_S3_ENDPOINT ?? 'http://localhost:9102',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: env.TEST_S3_ACCESS_KEY_ID ?? 'digitalsign',
  S3_SECRET_ACCESS_KEY: env.TEST_S3_SECRET_ACCESS_KEY ?? 'digitalsign_dev_password',
  S3_BUCKET: env.TEST_S3_BUCKET ?? 'digitalsign-test',
  S3_FORCE_PATH_STYLE: 'true',
  // digitalsign-test-sealed, created with Object Lock. One day, so test files do not stay locked.
  SEALED_RETENTION_DAYS: '1',

  // The expiry sweep runs every 2 seconds, so a test that moves a deadline
  // into the past sees the envelope paused almost at once.
  EXPIRY_SWEEP_EVERY_MS: '2000',

  MAIL_TRANSPORT: 'file',
  MAIL_OUTBOX_DIR: OUTBOX_DIR,
  EMAIL_RETRY_BASE_DELAY_MS: '50',
  SMTP_FROM: 'Envelope powered by HealthProHub <no-reply@e2e.local>',

  // Debug by default, so the token-leak audit (token-leak.spec.ts) searches
  // every line the API and worker could ever write, not only the usual ones.
  LOG_LEVEL: env.E2E_LOG_LEVEL ?? 'debug',
  LOG_PRETTY: 'false',
  LOG_FILES_ENABLED: 'true',
  LOG_DIR,
};

/** Only what a child process needs to find its tools. The developer's variables stay out. */
export function childEnv(extra) {
  return {
    PATH: env.PATH ?? '',
    HOME: env.HOME ?? '',
    ...(env.CI ? { CI: env.CI } : {}),
    ...extra,
  };
}

/**
 * Refuses to start unless the stack is isolated: a *_test database, no real
 * email, no .env file. A mistake here would write test data into the
 * developer's database or send email to made-up addresses.
 */
export function assertIsolated(stackEnv) {
  for (const key of ['DATABASE_URL', 'DIRECT_DATABASE_URL']) {
    const name = new URL(stackEnv[key]).pathname.replace(/^\//, '');
    if (!name.endsWith('_test')) {
      throw new Error(
        `${key} points at "${name}"; browser tests only run against a *_test database.`,
      );
    }
  }
  if (stackEnv.MAIL_TRANSPORT === 'smtp') {
    throw new Error('Browser tests never send real email; MAIL_TRANSPORT must not be smtp.');
  }
  if (stackEnv.ENV_FILE !== 'none') {
    throw new Error('Browser tests must not read the developer .env file.');
  }
  if (!new URL(stackEnv.REDIS_URL).pathname.match(/^\/[1-9]\d*$/)) {
    throw new Error('Browser tests must use a Redis database other than 0, which dev uses.');
  }
}
