import { describe, expect, it } from 'vitest';
import { OPERATION_RESPONSES } from './api-responses';
import { ERROR_CATALOG, type ErrorCode } from './errors';
import {
  API_BASE_PATH,
  API_KEY_OPERATIONS,
  DOCUMENTED_WEBHOOK_EVENTS,
  errorGuideRows,
  INTEGRATION_ERROR_GUIDE,
  INTEGRATION_HEADERS,
  INTEGRATION_OPERATIONS,
  NON_INTEGRATION_ERROR_CODES,
  operationRoute,
  RATE_LIMITS,
  WEBHOOK_EVENT_REFERENCE,
  webhookEventPayload,
} from './integration-contract';
import { FIRED_WEBHOOK_EVENT_TYPES, WEBHOOK_DELIVERY_HEADERS } from './webhooks';

const codes = Object.keys(ERROR_CATALOG) as ErrorCode[];

describe('operations catalog', () => {
  it('has unique ids and unique routes', () => {
    const ids = INTEGRATION_OPERATIONS.map((operation) => operation.id);
    expect(new Set(ids).size).toBe(ids.length);
    const routes = INTEGRATION_OPERATIONS.map(operationRoute);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it('gives every operation a rooted path, and no path carries the base', () => {
    for (const operation of INTEGRATION_OPERATIONS) {
      expect(operation.path.startsWith('/')).toBe(true);
      expect(operation.path.startsWith(API_BASE_PATH)).toBe(false);
    }
  });

  it('is reachable by an API key or an embedded session, never neither', () => {
    for (const operation of INTEGRATION_OPERATIONS)
      expect(operation.apiKey ?? operation.embed).not.toBeNull();
    expect(API_KEY_OPERATIONS.length).toBe(19);
  });

  it('only calls a route editor-only when a key cannot', () => {
    for (const operation of INTEGRATION_OPERATIONS)
      expect(operation.caller === 'editor').toBe(operation.apiKey === null);
  });

  it('asks for an Idempotency-Key only on operations that can replay', () => {
    const required = INTEGRATION_OPERATIONS.filter((o) => o.idempotency === 'required');
    expect(required.map((o) => o.id)).toEqual(['send']);
    for (const operation of required)
      expect(operation.errorCodes).toContain('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('marks draft edits with the If-Match revision', () => {
    for (const operation of INTEGRATION_OPERATIONS.filter((o) => o.group === 'drafts'))
      expect(operation.revision).toBe(true);
  });

  it('refers to rate limits that exist', () => {
    for (const operation of INTEGRATION_OPERATIONS)
      if (operation.rateLimit) expect(RATE_LIMITS[operation.rateLimit]).toBeDefined();
  });

  it('describes a response for every operation, and its example parses', () => {
    for (const operation of INTEGRATION_OPERATIONS) {
      const response = OPERATION_RESPONSES[operation.id];
      expect(response, operation.id).toBeDefined();
      // The detail excerpt is deliberately partial; every other JSON example is complete.
      if (
        response?.kind === 'json' &&
        !['upload', 'detail', 'embed-upload'].includes(operation.id)
      ) {
        const parsed = response.schema.safeParse(operation.response);
        expect(parsed.success, `${operation.id}: ${JSON.stringify(parsed.error?.issues)}`).toBe(
          true,
        );
      }
      if (response?.kind !== 'json') expect(typeof operation.response).toBe('string');
    }
  });
});

describe('error guide', () => {
  it('lists only codes that exist', () => {
    for (const code of Object.keys(INTEGRATION_ERROR_GUIDE)) expect(codes).toContain(code);
    for (const code of NON_INTEGRATION_ERROR_CODES) expect(codes).toContain(code);
  });

  it('classifies every code exactly once, so a new code forces a decision', () => {
    const guided = new Set(Object.keys(INTEGRATION_ERROR_GUIDE));
    const excluded = new Set<string>(NON_INTEGRATION_ERROR_CODES);
    for (const code of codes) expect(guided.has(code) !== excluded.has(code), code).toBe(true);
  });

  it('explains every code an operation can return', () => {
    for (const operation of INTEGRATION_OPERATIONS)
      for (const code of operation.errorCodes) {
        expect(codes, `${operation.id} lists ${code}`).toContain(code);
        expect(INTEGRATION_ERROR_GUIDE[code], `${operation.id} lists ${code}`).toBeDefined();
      }
  });

  it('covers every API key, webhook, embed and idempotency code', () => {
    for (const code of codes.filter((c) => /^(API_KEY|WEBHOOK|EMBED|IDEMPOTENCY)_/.test(c)))
      expect(INTEGRATION_ERROR_GUIDE[code], code).toBeDefined();
  });

  it('reads its status and title from the catalog', () => {
    for (const row of errorGuideRows()) {
      expect(row.status).toBe(ERROR_CATALOG[row.code].status);
      expect(row.title).toBe(ERROR_CATALOG[row.code].title);
    }
  });
});

describe('webhook reference', () => {
  it('documents exactly the events that fire', () => {
    expect(Object.keys(WEBHOOK_EVENT_REFERENCE).sort()).toEqual(
      [...FIRED_WEBHOOK_EVENT_TYPES].sort(),
    );
    expect([...DOCUMENTED_WEBHOOK_EVENTS].sort()).toEqual([...FIRED_WEBHOOK_EVENT_TYPES].sort());
    expect(WEBHOOK_EVENT_REFERENCE).not.toHaveProperty('envelope.delivered');
  });

  it('puts the partner reference on every event payload', () => {
    for (const type of DOCUMENTED_WEBHOOK_EVENTS) {
      const payload = webhookEventPayload(type) as { type: string; data: Record<string, unknown> };
      expect(payload.type).toBe(type);
      expect(payload.data).toHaveProperty('externalId');
      expect(payload.data).toHaveProperty('metadata');
    }
  });

  it('lists every delivery header the API sends', () => {
    const documented = INTEGRATION_HEADERS.filter((h) => h.direction === 'webhook').map(
      (h) => h.name,
    );
    expect(documented.sort()).toEqual(Object.values(WEBHOOK_DELIVERY_HEADERS).sort());
  });
});
