import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ClsModule } from 'nestjs-cls';
import { AlertModule } from './alert/alert.module';
import { loadEnvFile } from './bootstrap/load-env';
import { ConfigModule } from './config/config.module';
import { LoggingModule } from './logging/logging.module';
import { NestLogger } from './logging/nest-logger';
import { AuditChainCheckService } from './maintenance/audit-chain-check.service';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';

/** Only what the check needs: no queues are consumed, no HTTP server starts. */
@Module({
  imports: [
    ConfigModule,
    LoggingModule.forRoot('worker'),
    ClsModule.forRoot({ global: true }),
    PrismaModule,
    RedisModule,
    AlertModule.forRoot('direct'),
  ],
  providers: [AuditChainCheckService],
})
class AuditCheckModule {}

/**
 * `pnpm --filter @envelope/api audit:check` (ADR 0004): the nightly check, on
 * demand. Prints what it found and exits with 1 on any break. It raises no
 * alert; the person running it is the one who would receive it.
 */
async function main(): Promise<void> {
  loadEnvFile();
  const app = await NestFactory.createApplicationContext(AuditCheckModule, { bufferLogs: true });
  app.useLogger(app.get(NestLogger));
  app.flushLogs();
  try {
    const result = await app.get(AuditChainCheckService).run({ alert: false });
    process.stdout.write(
      `${JSON.stringify({ checked: result.scanned, broken: result.broken, breaks: result.breaks }, null, 2)}\n`,
    );
    process.exitCode = result.breaks.length > 0 ? 1 : 0;
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Audit check failed to run: ${String(error)}\n`);
  process.exitCode = 2;
});
