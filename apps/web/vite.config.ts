import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const rootEnvFile = fileURLToPath(new URL('../../.env', import.meta.url));
const sharedSource = fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url));

/**
 * The one .env file lives at the repository root and belongs mostly to the API.
 * It is read here by hand, for the ports only. Vite's own .env loading (loadEnv,
 * envDir) would also pick up the API's NODE_ENV=development and turn every
 * `vite build` run from a plain shell into a development build of React.
 */
function setting(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  return existsSync(rootEnvFile) ? parseEnv(readFileSync(rootEnvFile, 'utf8'))[name] : undefined;
}

export default defineConfig(() => {
  const apiTarget = `http://localhost:${setting('API_PORT') || '4000'}`;
  const port = Number(setting('WEB_PORT') || 5173);

  // The browser only ever talks to this origin; /api is forwarded to the API, so
  // the refresh cookie stays first-party and no CORS is needed. xfwd passes the
  // real client address on (the API trusts loopback proxies).
  const proxy = { '/api': { target: apiTarget, xfwd: true } };

  return {
    plugins: [react(), tailwindcss()],
    // The web app uses no VITE_ variables, so no .env file is loaded for it.
    envDir: false as const,
    resolve: { alias: { '@envelope/shared': sharedSource } },
    server: { port, strictPort: true, proxy },
    preview: { port, strictPort: true, proxy },
    build: { sourcemap: true, target: 'es2022' },
  };
});
