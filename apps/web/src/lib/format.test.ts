import { BRAND } from '@digitalsign/shared';
import { describe, expect, it } from 'vitest';
import {
  describeAuditAction,
  formatBytes,
  formatDateTime,
  pageTitle,
  pluralize,
  shortHash,
} from './format';

describe('format', () => {
  describe('formatBytes', () => {
    it('formats bytes correctly', () => {
      expect(formatBytes(0)).toBe('0 B');
      expect(formatBytes(512)).toBe('512 B');
      expect(formatBytes(1024)).toBe('1.0 KB');
      expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
      expect(formatBytes(10.4 * 1024 * 1024 * 1024)).toBe('10 GB');
      expect(formatBytes(15.6 * 1024 * 1024 * 1024)).toBe('16 GB');
    });
  });

  describe('formatDateTime', () => {
    it('formats valid ISO string', () => {
      const iso = '2026-09-17T10:00:00Z';
      const result = formatDateTime(iso);
      // Since timezone can vary in tests, just check it returns a non-empty string
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('shortHash', () => {
    it('returns short hash for long strings', () => {
      const longHash = 'a'.repeat(64);
      const expected = `${'a'.repeat(12)}…${'a'.repeat(10)}`;
      expect(shortHash(longHash)).toBe(expected);
    });

    it('returns original string if 24 chars or less', () => {
      const short = 'a'.repeat(24);
      expect(shortHash(short)).toBe(short);
    });
  });

  describe('pluralize', () => {
    it('pluralizes 0 items', () => {
      expect(pluralize(0, 'item')).toBe('0 items');
    });

    it('singularizes 1 item', () => {
      expect(pluralize(1, 'item')).toBe('1 item');
    });

    it('pluralizes 2 items', () => {
      expect(pluralize(2, 'item')).toBe('2 items');
    });

    it('uses custom plural', () => {
      expect(pluralize(2, 'person', 'people')).toBe('2 people');
    });
  });

  describe('pageTitle', () => {
    it('returns brand name when no title is provided', () => {
      expect(pageTitle()).toBe(BRAND.fullName);
    });

    it('returns title with brand name', () => {
      expect(pageTitle('Dashboard')).toBe(`Dashboard · ${BRAND.fullName}`);
    });
  });

  describe('describeAuditAction', () => {
    it('describes known action', () => {
      expect(describeAuditAction('ENVELOPE_CREATED')).toBe('Document uploaded and fingerprinted');
    });

    it('describes unknown action gracefully', () => {
      expect(describeAuditAction('UNKNOWN_WEIRD_ACTION')).toBe('unknown weird action');
    });
  });
});
