// Starts the browser-test API and worker (see stack.mjs). Run by Playwright's
// webServer; stopped by it when the tests finish.
//
//   1. check the environment is isolated
//   2. create the browser-test database if it is missing, and apply migrations
//   3. compile the API into apps/api/.e2e-dist (never the dev server's dist/)
//   4. run the API and the worker, logging to apps/web/.e2e/logs

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import pg from 'pg';
import {
  API_DIR,
  API_OUT_DIR,
  assertIsolated,
  childEnv,
  E2E_DIR,
  LOG_DIR,
  OUTBOX_DIR,
  STACK_ENV,
} from './stack.mjs';

/** Progress for the terminal. stderr, because Playwright discards the stack's stdout. */
const say = (message) => process.stderr.write(`${message}\n`);

assertIsolated(STACK_ENV);

// A clean slate for what earlier runs wrote. Only paths under .e2e / .e2e-dist.
rmSync(OUTBOX_DIR, { recursive: true, force: true });
rmSync(LOG_DIR, { recursive: true, force: true });
mkdirSync(OUTBOX_DIR, { recursive: true });
mkdirSync(LOG_DIR, { recursive: true });
mkdirSync(E2E_DIR, { recursive: true });

const env = childEnv(STACK_ENV);

function step(label, command, args) {
  say(`[e2e stack] ${label}`);
  const result = spawnSync(command, args, { cwd: API_DIR, env, stdio: 'inherit' });
  if (result.status !== 0) {
    say(`[e2e stack] ${label} failed`);
    process.exit(result.status ?? 1);
  }
}

/**
 * The Postgres init script creates digitalsign_browser_test on a new volume;
 * an older volume gets it here. Connects as the schema owner to the server's
 * `postgres` database, and only ever creates the *_test database it names.
 */
async function ensureDatabase() {
  const target = new URL(STACK_ENV.DIRECT_DATABASE_URL);
  const name = target.pathname.replace(/^\//, '');
  if (!/^[a-z_]+_test$/.test(name)) throw new Error(`Refusing to create database "${name}"`);
  const admin = new URL(target);
  admin.pathname = '/postgres';
  admin.search = '';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (rowCount === 0) {
      say(`[e2e stack] Creating database ${name}`);
      await client.query(`CREATE DATABASE ${name} OWNER ${target.username}`);
    }
  } finally {
    await client.end();
  }
}

await ensureDatabase();
step('Applying migrations to the test database', 'pnpm', ['exec', 'prisma', 'migrate', 'deploy']);
rmSync(API_OUT_DIR, { recursive: true, force: true });
step('Compiling the API', 'pnpm', [
  'exec',
  'tsc',
  '-p',
  'tsconfig.build.json',
  '--outDir',
  API_OUT_DIR,
]);

const children = ['main.js', 'worker.js'].map((entry) =>
  spawn(process.execPath, ['--enable-source-maps', `${API_OUT_DIR}/${entry}`], {
    cwd: API_DIR,
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
  }),
);

function stop() {
  for (const child of children) child.kill('SIGTERM');
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
for (const child of children) {
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) say(`[e2e stack] a process exited with ${code}`);
    stop();
    process.exit(code ?? 0);
  });
}
