import { hostname } from 'node:os';
import path from 'node:path';
import type { Request, Response } from 'express';
import type { Params } from 'nestjs-pino';
import pino, { type DestinationStream, type Level, type LoggerOptions } from 'pino';
import type { Options as HttpLoggerOptions } from 'pino-http';
import pinoRoll from 'pino-roll';
import type { AppConfig, ServiceName } from '../config/app-config';
import { APP_VERSION } from '../version';
import { REDACT_PATHS, REDACTED, redactUrl, scrubSecrets } from './redact';

type LogConfig = Pick<
  AppConfig,
  | 'NODE_ENV'
  | 'LOG_LEVEL'
  | 'LOG_DIR'
  | 'LOG_FILES_ENABLED'
  | 'LOG_PRETTY'
  | 'LOG_RETENTION_DAYS'
  | 'APP_ROOT_DIR'
>;

/** Error serializer that also scrubs credentials out of messages and stack traces. */
export function serializeError(error: unknown): Record<string, unknown> {
  const serialized = pino.stdSerializers.err(error as Error) as unknown as Record<string, unknown>;
  for (const key of ['message', 'stack'] as const) {
    const value = serialized[key];
    if (typeof value === 'string') serialized[key] = scrubSecrets(value);
  }
  return serialized;
}

/**
 * Options shared by every logger in the system (API and worker). Every line gets
 * an ISO timestamp, a text level, the service name, environment and version.
 */
export function basePinoOptions(
  service: ServiceName,
  config: Pick<AppConfig, 'LOG_LEVEL' | 'NODE_ENV'>,
): LoggerOptions {
  return {
    level: config.LOG_LEVEL,
    base: {
      service,
      env: config.NODE_ENV,
      version: APP_VERSION,
      pid: process.pid,
      hostname: hostname(),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: { paths: REDACT_PATHS, censor: REDACTED },
    serializers: { err: serializeError },
    hooks: {
      // Free-text arguments (the message and printf-style values) are scrubbed too.
      logMethod(args, method) {
        const scrubbed = args.map((arg: unknown) =>
          typeof arg === 'string' ? scrubSecrets(arg) : arg,
        ) as typeof args;
        method.apply(this, scrubbed);
      },
    },
  };
}

/** The matched route pattern (set by RoutePatternInterceptor), or the redacted URL. */
function routeOf(req: Request): string {
  const route = req.res?.locals.route;
  if (typeof route === 'string') return route;
  return redactUrl((req.originalUrl ?? req.url).split('?')[0]) ?? '';
}

function serializeRequest(req: Request): Record<string, unknown> {
  return {
    method: req.method,
    url: redactUrl(req.originalUrl ?? req.url),
    route: routeOf(req),
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    contentLength: req.headers['content-length'],
  };
}

function serializeResponse(res: Response): Record<string, unknown> {
  return {
    statusCode: res.statusCode,
    contentLength: res.getHeader('content-length'),
  };
}

const QUIET_PATHS = ['/api/v1/health'];
const IGNORED_PATHS = ['/api/docs'];

/** One log line per HTTP request, at a level that matches the outcome. */
function httpLoggerOptions(): HttpLoggerOptions<Request, Response> {
  return {
    genReqId: (req) => req.id,
    customAttributeKeys: { reqId: 'requestId', responseTime: 'durationMs' },
    quietReqLogger: true,
    wrapSerializers: false,
    serializers: { req: serializeRequest, res: serializeResponse, err: serializeError },
    autoLogging: {
      ignore: (req) => IGNORED_PATHS.some((prefix) => req.url?.startsWith(prefix)),
    },
    customLogLevel: (req, res, error) => {
      if (error || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      if (QUIET_PATHS.some((prefix) => req.originalUrl?.startsWith(prefix))) return 'debug';
      return 'info';
    },
    customSuccessMessage: (req, res) => `${req.method} ${routeOf(req)} ${res.statusCode}`,
    customErrorMessage: (req, res, error) =>
      `${req.method} ${routeOf(req)} ${res.statusCode} failed: ${error.message}`,
    // The problem-details filter records the error code on res.locals.
    customSuccessObject: (_req, res, value: Record<string, unknown>) => ({
      ...value,
      errorCode: res.locals.errorCode,
    }),
    customErrorObject: (_req, res, _error, value: Record<string, unknown>) => ({
      ...value,
      errorCode: res.locals.errorCode,
    }),
  };
}

const openDestinations = new Set<pino.MultiStreamRes>();

/**
 * Writes out anything still buffered. Log streams are asynchronous, so this runs
 * as the very last shutdown step and before a fatal exit; otherwise the final
 * lines would be lost when the process exits.
 */
export function flushLogStreams(): void {
  for (const destination of openDestinations) {
    try {
      destination.flushSync();
    } catch {
      // A stream that is not open yet has nothing to flush.
    }
  }
}

/**
 * Where log lines go:
 *  - stdout (pretty in development, JSON otherwise)
 *  - logs/<service>.<date>.<n>.log         everything at LOG_LEVEL and above
 *  - logs/<service>-error.<date>.<n>.log   errors and fatals only
 * Files rotate daily and LOG_RETENTION_DAYS rotated files are kept.
 */
export async function buildLogDestination(
  service: ServiceName,
  config: LogConfig,
): Promise<DestinationStream> {
  const level: Level = config.LOG_LEVEL === 'silent' ? 'fatal' : config.LOG_LEVEL;
  const streams: pino.StreamEntry[] = [];

  if (config.LOG_PRETTY ?? config.NODE_ENV === 'development') {
    const { default: pretty } = await import('pino-pretty');
    streams.push({
      level,
      stream: pretty({
        colorize: true,
        singleLine: true,
        translateTime: 'SYS:HH:MM:ss.l',
        messageFormat: '{service}{if context} [{context}]{end} {msg}',
        ignore: 'pid,hostname,env,version,service,context',
        destination: 1,
        sync: true,
      }),
    });
  } else {
    streams.push({ level, stream: pino.destination({ dest: 1, sync: false }) });
  }

  if (config.LOG_FILES_ENABLED) {
    const directory = path.resolve(config.APP_ROOT_DIR, config.LOG_DIR);
    const rotation = {
      frequency: 'daily',
      dateFormat: 'yyyy-MM-dd',
      extension: '.log',
      mkdir: true,
      limit: { count: config.LOG_RETENTION_DAYS },
    } as const;
    streams.push({
      level,
      stream: await pinoRoll({ ...rotation, file: path.join(directory, service) }),
    });
    streams.push({
      level: 'error',
      stream: await pinoRoll({ ...rotation, file: path.join(directory, `${service}-error`) }),
    });
  }

  const destination = pino.multistream(streams);
  openDestinations.add(destination);
  return destination;
}

export async function createLoggerParams(
  service: ServiceName,
  config: LogConfig,
): Promise<Params<Request, Response>> {
  const destination = await buildLogDestination(service, config);
  return {
    pinoHttp: [{ ...basePinoOptions(service, config), ...httpLoggerOptions() }, destination],
    // PinoLogger.assign() (tenantId, userId) also applies to the "request completed" line.
    assignResponse: true,
  };
}
