import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { PinoLogger } from 'nestjs-pino';
import { loadEnvFile } from './bootstrap/load-env';
import { exitWithFatal, installProcessHandlers } from './bootstrap/process-handlers';
import { AppConfig, describeConfig } from './config/app-config';
import { NestLogger } from './logging/nest-logger';
import { MailTransportService } from './mail/mail-transport.service';
import { EMAIL_QUEUE, MAINTENANCE_QUEUE, SEAL_QUEUE } from './queue/queue.module';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  const envFile = loadEnvFile();
  installProcessHandlers('worker');

  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(NestLogger));
  app.flushLogs();
  app.enableShutdownHooks();

  const config = app.get(AppConfig);
  const logger = PinoLogger.root.child({ context: 'Bootstrap' });
  logger.info(
    { envFile: envFile ?? 'none (using the process environment)', config: describeConfig(config) },
    'Starting Envelope worker',
  );

  const smtpReady = await app.get(MailTransportService).verify();
  logger[smtpReady ? 'info' : 'warn'](
    { queues: [EMAIL_QUEUE, SEAL_QUEUE, MAINTENANCE_QUEUE], smtpReady },
    smtpReady ? 'Worker ready' : 'Worker ready, but email cannot be sent until SMTP is fixed',
  );
}

bootstrap().catch((error: unknown) => exitWithFatal('worker', error, 'Worker failed to start'));
