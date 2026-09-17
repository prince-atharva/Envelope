import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';
import { vi } from 'vitest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap/configure-app';
import { MemoryMailbox } from '../../src/mail/mail-transport.service';
import { WorkerModule } from '../../src/worker.module';

export interface TestApp {
  app: INestApplication;
  http: Server;
  close(): Promise<void>;
}

/** Boots the real AppModule with the same HTTP setup as production (configureApp). */
export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  configureApp(app);
  await app.init();
  return {
    app,
    http: app.getHttpServer() as Server,
    close: () => app.close(),
  };
}

export interface TestWorker {
  mailbox: MemoryMailbox;
  close(): Promise<void>;
}

/** Starts the real WorkerModule (queue consumers) in this process. */
export async function createTestWorker(): Promise<TestWorker> {
  const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
  await moduleRef.init();
  return {
    mailbox: moduleRef.get(MemoryMailbox),
    close: () => moduleRef.close(),
  };
}

/** Polls until `check` returns a value, or fails after `timeoutMs`. */
export async function waitFor<T>(
  check: () => T | undefined | Promise<T | undefined>,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

type Level = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
const LEVELS: Level[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

export interface LogCall {
  level: Level;
  fields: Record<string, unknown>;
  message: string;
}

/**
 * Records what the application passes to its loggers (before pino's redaction),
 * so tests can assert both that an event was logged and that no secret was
 * ever handed to a logger in the first place.
 */
export function captureLogs() {
  const spies = LEVELS.map((level) => ({ level, spy: vi.spyOn(PinoLogger.prototype, level) }));

  const calls = (): LogCall[] =>
    spies.flatMap(({ level, spy }) =>
      spy.mock.calls.map((args: unknown[]) => {
        const [first, second] = args;
        return typeof first === 'string'
          ? { level, fields: {}, message: first }
          : {
              level,
              fields: (first ?? {}) as Record<string, unknown>,
              message: String(second ?? ''),
            };
      }),
    );

  return {
    calls,
    find: (message: string, level?: Level) =>
      calls().filter((call) => call.message === message && (!level || call.level === level)),
    /** Everything logged so far, as one string, for "never logged" checks. */
    text: () =>
      JSON.stringify(calls(), (_key, value: unknown) =>
        value instanceof Error ? value.message : value,
      ),
    clear: () => {
      for (const { spy } of spies) spy.mockClear();
    },
    restore: () => {
      for (const { spy } of spies) spy.mockRestore();
    },
  };
}
