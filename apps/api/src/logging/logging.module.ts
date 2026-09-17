import { type DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppConfig, SERVICE_NAME, type ServiceName } from '../config/app-config';
import { LifecycleLogger } from './lifecycle-logger';
import { NestLogger } from './nest-logger';
import { createLoggerParams } from './pino-options';

/**
 * Structured logging for the API and the worker (pino via nestjs-pino).
 * Inject with `@InjectPinoLogger(MyClass.name) private readonly logger: PinoLogger`.
 */
@Module({})
export class LoggingModule {
  static forRoot(service: ServiceName): DynamicModule {
    return {
      module: LoggingModule,
      global: true,
      imports: [
        LoggerModule.forRootAsync({
          inject: [AppConfig],
          useFactory: (config: AppConfig) => createLoggerParams(service, config),
        }),
      ],
      providers: [{ provide: SERVICE_NAME, useValue: service }, LifecycleLogger, NestLogger],
      exports: [SERVICE_NAME, NestLogger],
    };
  }
}
