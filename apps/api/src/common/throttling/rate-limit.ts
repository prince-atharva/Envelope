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
  res.setHeader('X-RateLimit-Limit', String(rule.limit));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, rule.limit - record.totalHits)));
  res.setHeader('X-RateLimit-Reset', String(retryAfter));
  return { limited: record.totalHits > rule.limit, hits: record.totalHits, retryAfter };
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
