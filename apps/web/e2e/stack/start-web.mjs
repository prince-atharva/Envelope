// Builds the web app and serves it for the browser tests (see stack.mjs), with
// /api forwarded to the test API.
//
// A production build rather than the Vite dev server: it cannot reload itself
// in the middle of a test when a source file changes, and it is what signers
// actually get.

import { spawn, spawnSync } from 'node:child_process';
import { API_PORT, childEnv, WEB_DIR, WEB_OUT_DIR, WEB_PORT } from './stack.mjs';

/** Progress for the terminal. stderr, because Playwright discards the stack's stdout. */
const say = (message) => process.stderr.write(`${message}\n`);

const env = childEnv({
  NODE_ENV: 'production',
  API_PORT: String(API_PORT),
  WEB_PORT: String(WEB_PORT),
});

say('[e2e stack] Building the web app');
const build = spawnSync(
  'pnpm',
  ['exec', 'vite', 'build', '--outDir', WEB_OUT_DIR, '--emptyOutDir', '--logLevel', 'warn'],
  { cwd: WEB_DIR, env, stdio: 'inherit' },
);
if (build.status !== 0) process.exit(build.status ?? 1);

const server = spawn(
  'pnpm',
  ['exec', 'vite', 'preview', '--outDir', WEB_OUT_DIR, '--port', String(WEB_PORT), '--strictPort'],
  { cwd: WEB_DIR, env, stdio: ['ignore', 'inherit', 'inherit'] },
);
const stop = () => server.kill('SIGTERM');
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
server.on('exit', (code) => process.exit(code ?? 0));
