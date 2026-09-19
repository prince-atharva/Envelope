import { Global, Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { RedisThrottlerStorage } from './redis-throttler.storage';

/** Holds the Redis storage as a provider, so its connection opens and closes with the app. */
@Global()
@Module({
  providers: [RedisThrottlerStorage],
  exports: [RedisThrottlerStorage],
})
export class RateLimitStorageModule {}

/**
 * Request limits for the API (docs/16 step 13): 300 a minute per address by
 * default, stricter per route with @Throttle, and per workspace or account
 * with @RateLimit. Every count lives in Redis.
 */
export const ThrottlingModule = ThrottlerModule.forRootAsync({
  imports: [RateLimitStorageModule],
  inject: [RedisThrottlerStorage],
  useFactory: (storage: RedisThrottlerStorage) => ({
    throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
    storage,
  }),
});
