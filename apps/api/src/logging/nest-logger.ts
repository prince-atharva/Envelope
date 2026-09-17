import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

/** Nest's own start-up chatter: one line per module and route. Useful only when debugging. */
const VERBOSE_CONTEXTS = new Set(['InstanceLoader', 'RoutesResolver', 'RouterExplorer']);

/** Nest framework logs routed through pino, with the start-up chatter moved to debug. */
@Injectable()
export class NestLogger extends Logger {
  // biome-ignore lint/suspicious/noExplicitAny: matches Nest's LoggerService signature.
  override log(message: any, ...optionalParams: any[]): void {
    const context = optionalParams.at(-1);
    if (typeof context === 'string' && VERBOSE_CONTEXTS.has(context)) {
      this.debug(message, ...optionalParams);
      return;
    }
    super.log(message, ...optionalParams);
  }
}
