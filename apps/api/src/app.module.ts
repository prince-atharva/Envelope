import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Request } from 'express';
import { ClsModule } from 'nestjs-cls';
import { AlertModule } from './alert/alert.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { ClientLogsModule } from './client-logs/client-logs.module';
import { ProblemDetailsFilter } from './common/errors/problem-details.filter';
import { LoggingThrottlerGuard } from './common/throttling/logging-throttler.guard';
import { CompletionModule } from './completion/completion.module';
import { ConfigModule } from './config/config.module';
import { DraftsModule } from './drafts/drafts.module';
import { EnvelopesModule } from './envelopes/envelopes.module';
import { HealthModule } from './health/health.module';
import { LifecycleModule } from './lifecycle/lifecycle.module';
import { LoggingModule } from './logging/logging.module';
import { RoutePatternInterceptor } from './logging/route-pattern.interceptor';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';
import { RedisModule } from './redis/redis.module';
import { SendingModule } from './sending/sending.module';
import { SigningModule } from './signing/signing.module';
import { StorageModule } from './storage/storage.module';
import { VerifyModule } from './verify/verify.module';

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
    StorageModule,
    QueueModule,
    AuditModule,
    AlertModule.forRoot('queued'),
    AuthModule,
    EnvelopesModule,
    DraftsModule,
    SendingModule,
    LifecycleModule,
    SigningModule,
    CompletionModule,
    VerifyModule,
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
