import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Response } from 'express';
import { AppException } from '../errors/app-exception';

export interface RateLimitRule {
  /** Names the counter, and the Redis key's middle part. */
  bucket: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitCount {
  limited: boolean;
  hits: number;
  /** Seconds until the window resets. */
  retryAfter: number;
}

/**
 * Counts one request against a limit and sets the X-RateLimit headers the
 * global throttler sets too. `key` is hashed by the storage before it reaches
 * Redis, so it may be a tenant id, a link or an email.
 */
export async function countRequest(
  storage: ThrottlerStorage,
  res: Response,
  key: string,
  rule: RateLimitRule,
): Promise<RateLimitCount> {
  const record = await storage.increment(
    key,
    rule.windowMs,
    rule.limit,
    rule.windowMs,
    rule.bucket,
  );
  // timeToExpire is already in seconds.
  const retryAfter = Math.max(1, Math.ceil(record.timeToExpire));
  setRateLimitHeaders(res, {
    limit: rule.limit,
    remaining: Math.max(0, rule.limit - record.totalHits),
    reset: retryAfter,
  });
  return { limited: record.totalHits > rule.limit, hits: record.totalHits, retryAfter };
}

/**
 * A request can be counted by several limits (the address, a key, the
 * workspace). The headers describe the one with the fewest requests left, in
 * whatever order they ran, so a caller who slows down for them stays inside
 * every limit (docs/18, workstream 11). On a tie the earlier one stays.
 */
export function setRateLimitHeaders(
  res: { getHeader(name: string): unknown; setHeader(name: string, value: string): unknown },
  next: { limit: number; remaining: number; reset: number },
): void {
  const current = Number(res.getHeader('X-RateLimit-Remaining') ?? Number.NaN);
  if (Number.isFinite(current) && current <= next.remaining) return;
  res.setHeader('X-RateLimit-Limit', String(next.limit));
  res.setHeader('X-RateLimit-Remaining', String(next.remaining));
  res.setHeader('X-RateLimit-Reset', String(next.reset));
}

/** 429 RATE_LIMITED, with Retry-After in seconds. */
export function rateLimited(
  retryAfter: number,
  message = 'Too many requests. Please wait a moment.',
): AppException {
  return new AppException('RATE_LIMITED', message, {
    headers: { 'Retry-After': String(retryAfter) },
  });
}
