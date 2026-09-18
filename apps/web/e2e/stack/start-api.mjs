// Starts the browser-test API and worker (see stack.mjs). Run by Playwright's
// webServer; stopped by it when the tests finish.
//
//   1. check the environment is isolated
//   2. apply migrations to the test database
//   3. compile the API into apps/api/.e2e-dist (never the dev server's dist/)
//   4. run the API and the worker, logging to apps/web/.e2e/logs

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
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
