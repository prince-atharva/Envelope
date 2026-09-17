import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// End-to-end tests: the real AppModule against the Docker services, using the
// separate digitalsign_test database, db 1 in Redis and the digitalsign-test bucket.
// Email uses the in-memory transport, so nothing is ever sent.
export default defineConfig({
  plugins: [swc.vite()],
  resolve: {
    alias: {
      '@digitalsign/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['test/**/*.e2e.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/setup-env.ts'],
    environment: 'node',
    // The files share one database, so they run one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
