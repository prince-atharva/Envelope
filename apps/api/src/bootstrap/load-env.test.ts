import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnvFile } from './load-env';

describe('loadEnvFile', () => {
  let dir: string;
  const saved = { ...process.env };

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'load-env-'));
    await writeFile(path.join(dir, '.env'), 'LOAD_ENV_PROBE=from-file\n');
    delete process.env.LOAD_ENV_PROBE;
    delete process.env.ENV_FILE;
  });

  afterEach(async () => {
    process.env = { ...saved };
    await rm(dir, { recursive: true, force: true });
  });

  it('reads the nearest .env without overriding real variables', () => {
    expect(loadEnvFile(dir)).toBe(path.join(dir, '.env'));
    expect(process.env.LOAD_ENV_PROBE).toBe('from-file');
  });

  it('reads nothing with ENV_FILE=none, so a test run cannot pick up dev settings', () => {
    process.env.ENV_FILE = 'none';
    expect(loadEnvFile(dir)).toBeUndefined();
    expect(process.env.LOAD_ENV_PROBE).toBeUndefined();
  });
});
