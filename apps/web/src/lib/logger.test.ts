import { describe, expect, it } from 'vitest';
import { buildClientLog, redactSigningLinks } from './logger';

const TOKEN = 'ab'.repeat(32);

describe('logger', () => {
  describe('buildClientLog', () => {
    it('creates a valid ClientLog from an Error', () => {
      const error = new Error('Test error message');
      error.stack = 'Error: Test error message\\n  at some/path.js:10';

      const log = buildClientLog(error, 'test-source', { url: 'https://example.com/path?query=1' });

      expect(log.level).toBe('error');
      expect(log.message).toBe('Error: Test error message');
      expect(log.stack).toBe(error.stack);
      expect(log.url).toBe('https://example.com/path'); // Query stripped
      expect(log.source).toBe('test-source');
      expect(log.occurredAt).toBeDefined();
    });

    it('creates a valid ClientLog from a string', () => {
      const log = buildClientLog('String error', 'test-source', { url: 'https://example.com' });

      expect(log.level).toBe('error');
      expect(log.message).toBe('Error: String error');
      expect(log.source).toBe('test-source');
    });

    it('truncates long messages', () => {
      const longMessage = 'A'.repeat(3000);
      const error = new Error(longMessage);

      const log = buildClientLog(error, 'source', { url: 'https://example.com' });

      // The prefix 'Error: ' takes 7 characters. Max length is 2000, so 'Error: ' + 1992 'A's + '…'
      expect(log.message.length).toBeLessThanOrEqual(2000);
      expect(log.message.endsWith('…')).toBe(true);
    });

    it('caps total JSON size to CLIENT_LOG_MAX_BYTES', () => {
      const error = new Error('Error');
      error.stack = 'A'.repeat(10000); // 10KB stack

      const log = buildClientLog(error, 'source', { url: 'https://example.com' });

      const jsonBytes = new TextEncoder().encode(JSON.stringify(log)).length;
      expect(jsonBytes).toBeLessThanOrEqual(8192); // 8KB
      expect(log.stack?.length).toBeLessThan(10000);
    });

    it('never sends a signing token, from the page URL, the message or the stack', () => {
      const error = new Error(`Failed to fetch /api/v1/sign/${TOKEN}/document`);
      error.stack = `Error\n    at https://sign.example.com/sign/${TOKEN}:12:5`;

      const log = buildClientLog(error, 'signing', {
        url: `https://sign.example.com/sign/${TOKEN}?x=1#y`,
      });

      expect(JSON.stringify(log)).not.toContain(TOKEN);
      expect(log.url).toBe('https://sign.example.com/sign/[redacted]');
      expect(log.message).toBe('Error: Failed to fetch /api/v1/sign/[redacted]/document');
      // The line and column survive, so the stack is still useful.
      expect(log.stack).toContain('/sign/[redacted]:12:5');
    });
  });

  describe('redactSigningLinks', () => {
    it('leaves text without a signing link alone', () => {
      expect(redactSigningLinks('/dashboard/envelopes/1')).toBe('/dashboard/envelopes/1');
    });

    it('masks every link in the text', () => {
      expect(redactSigningLinks(`/sign/${TOKEN} and /SIGN/${TOKEN}/submit`)).toBe(
        '/sign/[redacted] and /SIGN/[redacted]/submit',
      );
    });
  });
});
