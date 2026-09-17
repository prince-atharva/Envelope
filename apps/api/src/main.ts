import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { API_PREFIX, configureApp, DOCS_PATH } from './bootstrap/configure-app';
import { loadEnvFile } from './bootstrap/load-env';
import { exitWithFatal, installProcessHandlers } from './bootstrap/process-handlers';
import { AppConfig, describeConfig } from './config/app-config';
import { HealthService } from './health/health.service';

async function bootstrap(): Promise<void> {
  const envFile = loadEnvFile();
  installProcessHandlers('api');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  configureApp(app);

  const config = app.get(AppConfig);
  const logger = PinoLogger.root.child({ context: 'Bootstrap' });
  logger.info(
    { envFile: envFile ?? 'none (using the process environment)', config: describeConfig(config) },
    'Starting Digital Sign API',
  );

  await app.listen(config.API_PORT);

  const health = await app.get(HealthService).check();
  const base = `http://localhost:${config.API_PORT}`;
  logger[health.status === 'ok' ? 'info' : 'warn'](
    { port: config.API_PORT, checks: health.checks },
    `API listening on ${base}/${API_PREFIX} (docs: ${base}/${DOCS_PATH})`,
  );
}

bootstrap().catch((error: unknown) => exitWithFatal('api', error, 'API failed to start'));
