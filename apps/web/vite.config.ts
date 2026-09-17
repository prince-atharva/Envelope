import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const sharedSource = fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url));

export default defineConfig(({ mode }) => {
  // The one .env file lives at the repository root.
  const env = loadEnv(mode, repoRoot, '');
  const apiTarget = `http://localhost:${env.API_PORT || '4000'}`;
  const port = Number(env.WEB_PORT || 5173);

  // The browser only ever talks to this origin; /api is forwarded to the API, so
  // the refresh cookie stays first-party and no CORS is needed. xfwd passes the
  // real client address on (the API trusts loopback proxies).
  const proxy = { '/api': { target: apiTarget, xfwd: true } };

  return {
    plugins: [react(), tailwindcss()],
    envDir: repoRoot,
    resolve: { alias: { '@digitalsign/shared': sharedSource } },
    server: { port, strictPort: true, proxy },
    preview: { port, strictPort: true, proxy },
    build: { sourcemap: true, target: 'es2022' },
  };
});
