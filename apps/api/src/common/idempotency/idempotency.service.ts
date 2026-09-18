import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfig } from '../../config/app-config';
import { RedisService } from '../../redis/redis.service';
import { AppException } from '../errors/app-exception';

/** docs/08: a replay within 24 hours returns the original response. */
const KEEP_RESPONSE_SECONDS = 24 * 3600;
/** How long a key stays claimed while its first request runs. */
const IN_FLIGHT_SECONDS = 60;
const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

interface StoredEntry<T> {
  state: 'pending' | 'done';
  fingerprint: string;
  response?: T;
}

export interface IdempotentResult<T> {
  response: T;
  replayed: boolean;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Idempotency keys for requests that must not run twice (docs/08, API-03).
 *
 * The first request with a key claims it and runs. A repeat with the same key
 * and the same body gets the stored response back instead of running again; the
 * same key with a different body is refused, because that is a client bug.
 * A request that fails releases its key, so it can be retried as it was.
 *
 * Only a hash of the key is stored, since clients may put anything in it.
 */
@Injectable()
export class IdempotencyService {
  constructor(
    private readonly redis: RedisService,
    private readonly config: AppConfig,
    @InjectPinoLogger(IdempotencyService.name) private readonly logger: PinoLogger,
  ) {}

  async run<T>(
    scope: string,
    key: string | undefined,
    request: unknown,
    work: () => Promise<T>,
  ): Promise<IdempotentResult<T>> {
    if (!key || !KEY_PATTERN.test(key)) {
      throw new AppException(
        'IDEMPOTENCY_KEY_REQUIRED',
        'Send an Idempotency-Key header of 8 to 128 letters, digits, dots, dashes or colons.',
      );
    }

    const redisKey = `${this.config.QUEUE_PREFIX}:idempotency:${scope}:${sha256(key)}`;
    const fingerprint = sha256(JSON.stringify(request ?? null));
    const client = this.redis.client;

    const claim: StoredEntry<T> = { state: 'pending', fingerprint };
    const claimed = await client.set(
      redisKey,
      JSON.stringify(claim),
      'EX',
      IN_FLIGHT_SECONDS,
      'NX',
    );
    if (claimed !== 'OK') {
      const existing = await client.get(redisKey);
      return this.replay<T>(existing, fingerprint, scope);
    }

    try {
      const response = await work();
      const done: StoredEntry<T> = { state: 'done', fingerprint, response };
      await client.set(redisKey, JSON.stringify(done), 'EX', KEEP_RESPONSE_SECONDS);
      return { response, replayed: false };
    } catch (error) {
      await client.del(redisKey);
      throw error;
    }
  }

  private replay<T>(raw: string | null, fingerprint: string, scope: string): IdempotentResult<T> {
    const entry = raw ? (JSON.parse(raw) as StoredEntry<T>) : null;
    if (!entry) {
      // Expired between the two calls: rare, and safest to ask for a retry.
      throw new AppException('CONFLICT', 'Please try the request again.');
    }
    if (entry.fingerprint !== fingerprint) {
      this.logger.warn({ scope }, 'Idempotency key reused with a different request');
      throw new AppException(
        'IDEMPOTENCY_KEY_MISMATCH',
        'This Idempotency-Key was already used for a different request.',
      );
    }
    if (entry.state === 'pending') {
      throw new AppException('CONFLICT', 'The same request is still being processed.');
    }
    this.logger.info({ scope }, 'Idempotent request replayed');
    return { response: entry.response as T, replayed: true };
  }
}
