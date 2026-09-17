import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { assertTestDatabase, TEST_ENV } from './test-env';

/**
 * Brings the test database up to date with the committed migrations, once per run.
 * `migrate deploy` only applies pending migrations and never drops anything; each
 * suite empties the tables it uses (helpers/db.ts truncateAll).
 */
export default function setup(): void {
  assertTestDatabase(TEST_ENV.DIRECT_DATABASE_URL ?? '');

  const apiDir = path.resolve(__dirname, '..');
  execFileSync(path.join(apiDir, 'node_modules', '.bin', 'prisma'), ['migrate', 'deploy'], {
    cwd: apiDir,
    env: { ...process.env, ...TEST_ENV },
    stdio: 'pipe',
  });
}
