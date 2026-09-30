import { readdirSync } from 'node:fs';
import path from 'node:path';
import {
  INTEGRATION_OPERATIONS,
  operationRoute,
  RATE_LIMITS,
  type RateLimitName,
} from '@envelope/shared';
import { RequestMethod } from '@nestjs/common';
import { beforeAll, describe, expect, it } from 'vitest';
import { API_KEY_ALLOWED_KEY } from './auth/api-key.decorator';
import { LIMITS } from './common/throttling/keyed-rate-limit.guard';
import { EMBED_ALLOWED } from './embed/embed.decorator';

// What the catalog in packages/shared claims must be what the controllers enforce (ADR 0021).

const METHODS: Record<number, string> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.DELETE]: 'DELETE',
};

function controllerFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'generated' ? [] : controllerFiles(full);
    return entry.name.endsWith('.controller.ts') ? [full] : [];
  });
}

interface Route {
  route: string;
  apiKey?: { write: boolean };
  embed?: string;
}

async function collectRoutes(): Promise<Route[]> {
  const routes: Route[] = [];
  for (const file of controllerFiles(__dirname)) {
    const module = (await import(file)) as Record<string, unknown>;
    for (const value of Object.values(module)) {
      if (typeof value !== 'function') continue;
      const base = Reflect.getMetadata('path', value) as string | undefined;
      if (base === undefined) continue;
      for (const name of Object.getOwnPropertyNames(value.prototype)) {
        const handler = value.prototype[name];
        if (typeof handler !== 'function') continue;
        const method = Reflect.getMetadata('method', handler) as number | undefined;
        if (method === undefined) continue;
        const joined = [base, Reflect.getMetadata('path', handler) as string]
          .flatMap((part) => part.split('/'))
          .filter(Boolean)
          .join('/');
        routes.push({
          route: `${METHODS[method]} /${joined}`,
          apiKey: Reflect.getMetadata(API_KEY_ALLOWED_KEY, handler),
          embed: Reflect.getMetadata(EMBED_ALLOWED, handler),
        });
      }
    }
  }
  return routes;
}

describe('integration contract matches the controllers', () => {
  let routes: Route[] = [];
  // Importing every controller is slow when the whole workspace's tests run at once.
  beforeAll(async () => {
    routes = await collectRoutes();
  }, 120_000);

  it('allows an API key on exactly the routes the catalog lists, at the same access', () => {
    const actual = routes
      .filter((r) => r.apiKey)
      .map((r) => `${r.route} ${r.apiKey?.write ? 'write' : 'read'}`)
      .sort();
    const documented = INTEGRATION_OPERATIONS.filter((o) => o.apiKey)
      .map((o) => `${operationRoute(o)} ${o.apiKey}`)
      .sort();
    expect(actual).toEqual(documented);
  });

  it('allows an embedded session on exactly the routes the catalog lists, with the same permission', () => {
    const actual = routes
      .filter((r) => r.embed)
      .map((r) => `${r.route} ${r.embed}`)
      .sort();
    const documented = INTEGRATION_OPERATIONS.filter((o) => o.embed)
      .map((o) => `${operationRoute(o)} ${o.embed}`)
      .sort();
    expect(actual).toEqual(documented);
  });

  it('documents every route it lists as a real route', () => {
    const real = new Set(routes.map((r) => r.route));
    for (const operation of INTEGRATION_OPERATIONS)
      expect(real).toContain(operationRoute(operation));
  });

  it('states the rate limits the API enforces', () => {
    const pairs: [RateLimitName, { limit: number }][] = [
      ['createAndSend', LIMITS.createAndSend],
      ['lifecycle', LIMITS.lifecycle],
      ['certificate', LIMITS.certificate],
    ];
    for (const [name, enforced] of pairs) expect(RATE_LIMITS[name].limit).toBe(enforced.limit);
  });
});
