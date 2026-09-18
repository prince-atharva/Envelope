import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { basePinoOptions } from './pino-options';
import { maskEmail, redactUrl, scrubSecrets } from './redact';

const SECRETS = {
  password: 'CorrectHorseBatteryStaple!',
  passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2g',
  refreshToken: 'rt_9f8e7d6c5b4a39281706f5e4d3c2b1a0',
  accessToken: 'at_0a1b2c3d4e5f60718293a4b5c6d7e8f9',
  cookie: 'ds_refresh=cookie-secret-value-123',
  bearer: 'bearer-secret-value-456',
  jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.c2lnbmF0dXJlLXZhbHVlLTc4OQ',
  signingToken: 'sgn_7Qz9XvKp2LmN4RtY6WbH',
  rawToken: '3f1c9a7e5b2d8f4a6c0e1b3d5f7a9c2e4b6d8f0a1c3e5b7d9f2a4c6e8b0d1f3a',
  signingSecret: 'signing-secret-value-abcdefghijklmnop',
  smtpPassword: 'abcd efgh ijkl mnop',
  dbPassword: 'db-password-hunter2',
};

function captureLogger() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      chunks.push(chunk.toString());
      done();
    },
  });
  const logger = pino(basePinoOptions('api', { LOG_LEVEL: 'trace', NODE_ENV: 'test' }), stream);
  return { logger, output: () => chunks.join('') };
}

describe('log redaction', () => {
  it('never writes passwords, tokens, cookies or credentials', () => {
    const { logger, output } = captureLogger();

    logger.info({ password: SECRETS.password, passwordHash: SECRETS.passwordHash }, 'top level');
    logger.info(
      { body: { password: SECRETS.password, refreshToken: SECRETS.refreshToken } },
      'nested',
    );
    logger.info({ accessToken: SECRETS.accessToken, token: SECRETS.signingToken }, 'tokens');
    logger.info(
      {
        req: {
          headers: { authorization: `Bearer ${SECRETS.bearer}`, cookie: SECRETS.cookie },
        },
        res: { headers: { 'set-cookie': SECRETS.cookie } },
      },
      'http',
    );
    logger.info({ config: { SMTP_PASSWORD: SECRETS.smtpPassword } }, 'config');
    logger.info(
      {
        rawToken: SECRETS.rawToken,
        job: { signingUrl: `https://app.test/sign/${SECRETS.rawToken}` },
        config: { SIGNING_TOKEN_SECRET: SECRETS.signingSecret },
      },
      'signing',
    );
    logger.warn(`Browser error at https://app.test/sign/${SECRETS.rawToken}#page=2`);
    logger.warn(`Rejected header Authorization: Bearer ${SECRETS.bearer}`);
    logger.warn(`Token in message ${SECRETS.jwt}`);
    logger.error(
      { err: new Error(`Failed to open https://app.test/sign/${SECRETS.signingToken}?x=1`) },
      'error with a signing link',
    );
    logger.error(
      `connect failed: postgresql://digitalsign_app:${SECRETS.dbPassword}@localhost:5545/db`,
    );

    const text = output();
    for (const [name, value] of Object.entries(SECRETS)) {
      expect(text, `${name} leaked into the log output`).not.toContain(value);
    }
    expect(text).toContain('[redacted]');
  });

  it('writes text levels, ISO timestamps and the service name', () => {
    const { logger, output } = captureLogger();
    logger.info({ envelopeId: 'e-1' }, 'hello');
    const line = JSON.parse(output()) as Record<string, unknown>;
    expect(line).toMatchObject({ level: 'info', service: 'api', env: 'test', msg: 'hello' });
    expect(line.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(line.envelopeId).toBe('e-1');
  });
});

describe('redaction helpers', () => {
  it('masks email addresses', () => {
    expect(maskEmail('raj.kumar@example.com')).toBe('r***@example.com');
    expect(maskEmail('not-an-email')).toBe('[redacted]');
    expect(maskEmail(undefined)).toBe('[redacted]');
  });

  it('removes signing tokens and secret query parameters from URLs', () => {
    expect(redactUrl('/api/v1/sign/abc123def/submit')).toBe('/api/v1/sign/[redacted]/submit');
    expect(redactUrl(`http://localhost:5173/sign/${'a'.repeat(64)}`)).toBe(
      'http://localhost:5173/sign/[redacted]',
    );
    expect(redactUrl('/callback?code=xyz&state=ok')).toBe('/callback?code=[redacted]&state=ok');
    expect(redactUrl('/api/v1/envelopes?limit=10')).toBe('/api/v1/envelopes?limit=10');
  });

  it('scrubs signing links out of a browser stack trace', () => {
    const stack = [
      'TypeError: x is undefined',
      `    at SigningPage (http://localhost:5173/sign/${'b'.repeat(64)}:12:3)`,
      '    at renderWithHooks (http://localhost:5173/node_modules/.vite/deps/react-dom.js:1:1)',
    ].join('\n');
    const scrubbed = scrubSecrets(stack);
    expect(scrubbed).not.toContain('b'.repeat(64));
    expect(scrubbed).toContain('/sign/[redacted]:12:3');
    expect(scrubbed).toContain('react-dom.js:1:1');
  });

  it('keeps ordinary text unchanged', () => {
    expect(scrubSecrets('Envelope 42 created by r***@example.com')).toBe(
      'Envelope 42 created by r***@example.com',
    );
  });
});
