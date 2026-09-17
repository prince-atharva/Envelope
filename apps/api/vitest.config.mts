import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Unit tests: src/**/*.test.ts. No database, Redis or network.
// SWC (instead of Vite's own transform) keeps NestJS decorator metadata intact.
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
    include: ['src/**/*.test.ts'],
    environment: 'node',
    env: { NODE_ENV: 'test' },
  },
});
