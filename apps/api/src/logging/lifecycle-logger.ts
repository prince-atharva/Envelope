import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { APP_VERSION } from '../version';
import { flushLogStreams } from './pino-options';

/** Logs when the process is ready and why it is shutting down. */
@Injectable()
export class LifecycleLogger implements OnModuleInit, OnApplicationShutdown {
  constructor(@InjectPinoLogger('Lifecycle') private readonly logger: PinoLogger) {}

  onModuleInit(): void {
    this.logger.info(
      { version: APP_VERSION, node: process.version, pid: process.pid },
      'Modules initialised',
    );
  }

  onApplicationShutdown(signal?: string): void {
    this.logger.info({ signal: signal ?? null }, 'Shutdown complete');
    flushLogStreams();
  }
}
