import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Request } from 'express';
import { ClsModule } from 'nestjs-cls';
import { AuthModule } from './auth/auth.module';
import { ClientLogsModule } from './client-logs/client-logs.module';
import { ProblemDetailsFilter } from './common/errors/problem-details.filter';
import { LoggingThrottlerGuard } from './common/throttling/logging-throttler.guard';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { LoggingModule } from './logging/logging.module';
import { RoutePatternInterceptor } from './logging/route-pattern.interceptor';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule,
    LoggingModule.forRoot('api'),
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        // Same id as the X-Request-Id header and the pino log lines.
        idGenerator: (req: Request) => String(req.id),
        setup: (cls, req: Request) => {
          cls.set('ip', req.ip ?? 'unknown');
          cls.set('userAgent', req.headers['user-agent'] ?? 'unknown');
        },
      },
    }),
    // Default limit for every route; sensitive routes set stricter ones with @Throttle.
    ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }] }),
    PrismaModule,
    RedisModule,
    AuthModule,
    HealthModule,
    ClientLogsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    { provide: APP_GUARD, useClass: LoggingThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: RoutePatternInterceptor },
  ],
})
export class AppModule {}
