import { describe, expect, it } from 'vitest';
import { setRateLimitHeaders } from './rate-limit';

function response() {
  const headers = new Map<string, string>();
  return {
    headers,
    getHeader: (name: string) => headers.get(name),
    setHeader: (name: string, value: string) => {
      headers.set(name, value);
    },
  };
}

describe('setRateLimitHeaders', () => {
  it('sets the headers when none are there yet', () => {
    const res = response();
    setRateLimitHeaders(res, { limit: 30, remaining: 12, reset: 40 });
    expect(Object.fromEntries(res.headers)).toEqual({
      'X-RateLimit-Limit': '30',
      'X-RateLimit-Remaining': '12',
      'X-RateLimit-Reset': '40',
    });
  });

  it('lets the limit with fewer requests left replace one with more', () => {
    const res = response();
    setRateLimitHeaders(res, { limit: 300, remaining: 299, reset: 60 });
    setRateLimitHeaders(res, { limit: 30, remaining: 3, reset: 20 });
    expect(res.headers.get('X-RateLimit-Limit')).toBe('30');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('3');
    expect(res.headers.get('X-RateLimit-Reset')).toBe('20');
  });

  it('keeps the tighter limit when a looser one is counted afterwards', () => {
    const res = response();
    setRateLimitHeaders(res, { limit: 30, remaining: 3, reset: 20 });
    setRateLimitHeaders(res, { limit: 300, remaining: 299, reset: 60 });
    expect(res.headers.get('X-RateLimit-Limit')).toBe('30');
    expect(res.headers.get('X-RateLimit-Reset')).toBe('20');
  });

  it('keeps the earlier limit on a tie, and reports an exhausted one as zero left', () => {
    const res = response();
    setRateLimitHeaders(res, { limit: 30, remaining: 5, reset: 20 });
    setRateLimitHeaders(res, { limit: 60, remaining: 5, reset: 50 });
    expect(res.headers.get('X-RateLimit-Limit')).toBe('30');
    setRateLimitHeaders(res, { limit: 5, remaining: 0, reset: 9 });
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(res.headers.get('X-RateLimit-Reset')).toBe('9');
  });
});
