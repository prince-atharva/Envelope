import { existsSync } from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// The single .env lives at the repository root. Walk up from the current
// directory so this works from apps/api (pnpm scripts) or from the root.
for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
  const candidate = path.join(dir, '.env');
  if (existsSync(candidate)) {
    loadEnv({ path: candidate, quiet: true });
    break;
  }
  if (path.dirname(dir) === dir) break;
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Migrations run as the schema owner. The application itself connects with
    // DATABASE_URL (the restricted digitalsign_app role) through the pg adapter.
    url: process.env.DIRECT_DATABASE_URL,
  },
});
