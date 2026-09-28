import { describe, expect, it } from 'vitest';
import { parseOriginsInput, removedOrigins } from './api-key-origins-form';

describe('parseOriginsInput', () => {
  it('trims blank lines and accepts valid origins', () => {
    const result = parseOriginsInput('\nhttps://healthprohub.example\n\nhttps://staging.example\n');
    expect(result).toEqual({
      origins: ['https://healthprohub.example', 'https://staging.example'],
      errors: [],
    });
  });

  it('points at the offending line instead of one generic message', () => {
    const result = parseOriginsInput('https://healthprohub.example\nhttps://*.example');
    expect(result.errors).toEqual(['Line 2: "https://*.example" is not an exact HTTPS origin.']);
  });

  it('refuses a duplicate origin', () => {
    const result = parseOriginsInput('https://a.example\nhttps://a.example');
    expect(result.errors).toContain('Each origin can only appear once.');
  });

  it('refuses more than ten origins', () => {
    const many = Array.from({ length: 11 }, (_, i) => `https://app${i}.example`).join('\n');
    expect(parseOriginsInput(many).errors).toContain('Enter at most 10 origins.');
  });

  it('accepts an empty list', () => {
    expect(parseOriginsInput('  \n  ')).toEqual({ origins: [], errors: [] });
  });
});

describe('removedOrigins', () => {
  it('returns only origins missing from the new list', () => {
    expect(
      removedOrigins(['https://a.example', 'https://b.example'], ['https://a.example']),
    ).toEqual(['https://b.example']);
  });

  it('returns an empty list when nothing was removed, including on an addition', () => {
    expect(
      removedOrigins(['https://a.example'], ['https://a.example', 'https://b.example']),
    ).toEqual([]);
  });
});
