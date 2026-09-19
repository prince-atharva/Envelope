import { randomUUID } from 'node:crypto';
import { TEST_ENV } from './test-env';

Object.assign(process.env, TEST_ENV, {
  // Rate-limit counts live in Redis now (docs/16 step 13). Each test file gets
  // its own keys, as it had its own memory before, so one file's requests never
  // count against the next file's within the same minute.
  RATE_LIMIT_KEY_PREFIX: `${TEST_ENV.QUEUE_PREFIX}-rl-${randomUUID().slice(0, 8)}`,
});
