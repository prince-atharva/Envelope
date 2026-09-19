import { describe, expect, it } from 'vitest';
import { InvalidEnvironmentError, parseEnv } from './env.schema';

const valid = {
  APP_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgresql://app:pw@localhost:5545/digitalsign',
  REDIS_URL: 'redis://localhost:6391',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  REFRESH_TOKEN_SECRET: 'b'.repeat(40),
  SIGNING_TOKEN_SECRET: 'c'.repeat(40),
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'super-secret-s3-value',
  S3_BUCKET: 'bucket',
  MAIL_TRANSPORT: 'smtp',
  SMTP_HOST: 'smtp.gmail.com',
  SMTP_USER: 'someone@gmail.com',
  SMTP_PASSWORD: 'app-password-value',
  SMTP_FROM: 'Digital Sign <someone@gmail.com>',
};

function problemsOf(env: Record<string, string>): string[] {
  try {
    parseEnv(env);
  } catch (error) {
    if (error instanceof InvalidEnvironmentError) return error.problems;
    throw error;
  }
  return [];
}

describe('parseEnv', () => {
  it('accepts a complete environment and applies defaults', () => {
    const env = parseEnv(valid);
    expect(env.API_PORT).toBe(4000);
    expect(env.SMTP_PORT).toBe(587);
    expect(env.SMTP_SECURE).toBe(false);
    expect(env.LOG_RETENTION_DAYS).toBe(14);
    expect(env.CORS_ORIGINS).toEqual([]);
    expect(env.SIGNING_DEFAULT_EXPIRY_DAYS).toBe(14);
    expect(env.MAIL_OUTBOX_DIR).toBe('.mail-outbox');
  });

  it('requires a signing-token secret of its own', () => {
    const { SIGNING_TOKEN_SECRET: _omit, ...without } = valid;
    expect(problemsOf(without)).toEqual([expect.stringMatching(/^SIGNING_TOKEN_SECRET: /)]);
    expect(problemsOf({ ...valid, SIGNING_TOKEN_SECRET: valid.REFRESH_TOKEN_SECRET })).toEqual([
      'SIGNING_TOKEN_SECRET: must be different from JWT_ACCESS_SECRET and REFRESH_TOKEN_SECRET',
    ]);
  });

  it('locks sealed documents for seven years, in a bucket of their own', () => {
    const env = parseEnv(valid);
    expect(env.S3_SEALED_BUCKET).toBe('bucket-sealed');
    expect(env.SEALED_RETENTION_DAYS).toBe(2557);
    expect(env.SEALED_RETENTION_MODE).toBe('GOVERNANCE');
    expect(parseEnv({ ...valid, NODE_ENV: 'production' }).SEALED_RETENTION_MODE).toBe('COMPLIANCE');
    expect(problemsOf({ ...valid, S3_SEALED_BUCKET: 'bucket' })).toEqual([
      'S3_SEALED_BUCKET: must be a separate bucket from S3_BUCKET, created with Object Lock on',
    ]);
  });

  it('refuses a sealed document that an administrator could delete in production', () => {
    expect(
      problemsOf({ ...valid, NODE_ENV: 'production', SEALED_RETENTION_MODE: 'GOVERNANCE' }),
    ).toEqual(['SEALED_RETENTION_MODE: must be COMPLIANCE in production']);
  });

  it('refuses real email when running tests', () => {
    expect(problemsOf({ ...valid, NODE_ENV: 'test' })).toEqual([
      'MAIL_TRANSPORT: tests never send real email: use memory or file',
    ]);
  });

  it('refuses the memory and file mail transports in production', () => {
    const { SMTP_HOST, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, ...rest } = valid;
    for (const transport of ['memory', 'file']) {
      expect(problemsOf({ ...rest, NODE_ENV: 'production', MAIL_TRANSPORT: transport })).toEqual([
        `MAIL_TRANSPORT: ${transport} transport is for development and tests only`,
      ]);
    }
    expect(parseEnv({ ...rest, MAIL_TRANSPORT: 'file' }).MAIL_TRANSPORT).toBe('file');
  });

  it('parses comma-separated CORS origins and boolean flags', () => {
    const env = parseEnv({
      ...valid,
      CORS_ORIGINS: 'http://a.test, http://b.test',
      S3_FORCE_PATH_STYLE: 'true',
    });
    expect(env.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
  });

  it('requires the SMTP settings when sending real email', () => {
    const { SMTP_PASSWORD: _omit, ...withoutPassword } = valid;
    expect(problemsOf(withoutPassword)).toEqual([
      'SMTP_PASSWORD: required when MAIL_TRANSPORT=smtp',
    ]);
  });

  it('does not require SMTP settings for the in-memory transport', () => {
    const { SMTP_HOST, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, ...rest } = valid;
    expect(parseEnv({ ...rest, MAIL_TRANSPORT: 'memory' }).MAIL_TRANSPORT).toBe('memory');
  });

  it('treats empty strings as unset', () => {
    expect(problemsOf({ ...valid, S3_BUCKET: '' })).toEqual([
      expect.stringMatching(/^S3_BUCKET: /),
    ]);
  });

  it('rejects short or reused secrets', () => {
    expect(problemsOf({ ...valid, JWT_ACCESS_SECRET: 'short' })).toEqual([
      expect.stringMatching(/^JWT_ACCESS_SECRET: must be at least 32 characters/),
    ]);
    expect(problemsOf({ ...valid, REFRESH_TOKEN_SECRET: valid.JWT_ACCESS_SECRET })).toEqual([
      'REFRESH_TOKEN_SECRET: must be different from JWT_ACCESS_SECRET',
    ]);
  });

  it('never includes secret values in its error messages', () => {
    const problems = problemsOf({
      ...valid,
      DATABASE_URL: 'mysql://root:hunter2-db-password@db/x',
      JWT_ACCESS_SECRET: 'tiny-secret',
    });
    const text = problems.join('\n');
    expect(text).toContain('DATABASE_URL');
    expect(text).not.toContain('hunter2-db-password');
    expect(text).not.toContain('tiny-secret');
  });
});
