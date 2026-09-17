import { PinoLogger } from 'nestjs-pino';
import type { ServiceName } from '../config/app-config';
import { flushLogStreams } from '../logging/pino-options';

function rootLogger() {
  // PinoLogger.root only exists once the logging module has started.
  return (PinoLogger as { root?: typeof PinoLogger.root }).root;
}

/** Logs a fatal error, flushes the log streams, then exits with code 1. */
export function exitWithFatal(service: ServiceName, error: unknown, message: string): void {
  const logger = rootLogger();
  if (!logger) {
    console.error(`[${service}] ${message}`, error);
    process.exit(1);
  }
  logger.fatal({ err: error, context: 'Process' }, message);
  flushLogStreams();
  process.exit(1);
}

/**
 * Crash loudly: an unexpected exception or unhandled promise rejection is logged
 * as fatal and the process exits (a supervisor or `pnpm dev` restarts it).
 */
export function installProcessHandlers(service: ServiceName): void {
  process.on('uncaughtException', (error) => exitWithFatal(service, error, 'Uncaught exception'));
  process.on('unhandledRejection', (reason) =>
    exitWithFatal(service, reason, 'Unhandled promise rejection'),
  );
}
