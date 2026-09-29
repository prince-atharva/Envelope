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

/**
 * `response` holds whatever the caller chose to keep: the full response for
 * `run()`, or only an id for `runReferenced()`.
 */
interface StoredEntry<T> {
  state: 'pending' | 'done';
  fingerprint: string;
  response?: T;
}

export interface IdempotentResult<T> {
  response: T;
  replayed: boolean;
}

function keyRequired(): AppException {
  return new AppException(
    'IDEMPOTENCY_KEY_REQUIRED',
    'Send an Idempotency-Key header of 8 to 128 letters, digits, dots, dashes or colons.',
  );
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

  /** A required key: the first response is stored whole and returned again on a replay. */
  async run<T>(
    scope: string,
    key: string | undefined,
    request: unknown,
    work: () => Promise<T>,
  ): Promise<IdempotentResult<T>> {
    if (!key || !KEY_PATTERN.test(key)) throw keyRequired();
    return this.execute<T, T>(
      scope,
      key,
      request,
      async () => {
        const response = await work();
        return { stored: response, response };
      },
      async (stored) => stored,
    );
  }

  /**
   * An optional key, storing only a reference to what the first request created
   * (docs/18 workstream 10, ADR 0019) and rebuilding the response from it on a
   * replay. Without a key the work simply runs. Used where the response holds
   * something that must not sit in Redis (a launch token) or that should show
   * the resource as it is now (an envelope), and where existing callers have
   * never sent a key, so requiring one would break them.
   *
   * A key that is present but malformed is refused rather than ignored: a
   * client that believes it is protected against a duplicate must be told when
   * it is not.
   */
  async runReferenced<R extends string, T>(
    scope: string,
    key: string | undefined,
    request: unknown,
    work: () => Promise<{ reference: R; response: T }>,
    replay: (reference: R) => Promise<T>,
  ): Promise<IdempotentResult<T>> {
    if (key === undefined) {
      const { response } = await work();
      return { response, replayed: false };
    }
    if (!KEY_PATTERN.test(key)) throw keyRequired();
    return this.execute<R, T>(
      scope,
      key,
      request,
      async () => {
        const { reference, response } = await work();
        return { stored: reference, response };
      },
      replay,
    );
  }

  private async execute<S, T>(
    scope: string,
    key: string,
    request: unknown,
    work: () => Promise<{ stored: S; response: T }>,
    rebuild: (stored: S) => Promise<T>,
  ): Promise<IdempotentResult<T>> {
    const redisKey = `${this.config.QUEUE_PREFIX}:idempotency:${scope}:${sha256(key)}`;
    const fingerprint = sha256(JSON.stringify(request ?? null));
    const client = this.redis.client;

    const claim: StoredEntry<S> = { state: 'pending', fingerprint };
    const claimed = await client.set(
      redisKey,
      JSON.stringify(claim),
      'EX',
      IN_FLIGHT_SECONDS,
      'NX',
    );
    if (claimed !== 'OK') {
      const existing = await client.get(redisKey);
      const entry = this.replay<S>(existing, fingerprint, scope);
      return { response: await rebuild(entry), replayed: true };
    }

    try {
      const { stored, response } = await work();
      const done: StoredEntry<S> = { state: 'done', fingerprint, response: stored };
      await client.set(redisKey, JSON.stringify(done), 'EX', KEEP_RESPONSE_SECONDS);
      return { response, replayed: false };
    } catch (error) {
      await client.del(redisKey);
      throw error;
    }
  }

  private replay<S>(raw: string | null, fingerprint: string, scope: string): S {
    const entry = raw ? (JSON.parse(raw) as StoredEntry<S>) : null;
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
    return entry.response as S;
  }
}
