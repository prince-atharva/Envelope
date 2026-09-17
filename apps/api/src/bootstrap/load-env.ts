import { existsSync } from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';

/**
 * Loads the repository's single `.env` file by walking up from the working
 * directory, so `pnpm dev` works from the repo root or from apps/api.
 *
 * Variables already set in the real environment always win over the file.
 * The directory that held the file is exported as APP_ROOT_DIR, which is what
 * relative paths such as LOG_DIR are resolved against. Production deployments
 * normally have no .env file at all.
 */
export function loadEnvFile(startDir: string = process.cwd()): string | undefined {
  for (let dir = startDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, '.env');
    if (existsSync(candidate)) {
      config({ path: candidate, quiet: true, override: false });
      process.env.APP_ROOT_DIR ??= dir;
      return candidate;
    }
    if (path.dirname(dir) === dir) {
      return undefined;
    }
  }
}
