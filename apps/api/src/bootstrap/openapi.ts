import {
  API_BASE_PATH,
  BRAND,
  DOCUMENTED_WEBHOOK_EVENTS,
  ERROR_CATALOG,
  type ErrorCode,
  INTEGRATION_HEADERS,
  INTEGRATION_OPERATIONS,
  OPERATION_RESPONSES,
  type OperationContract,
  RATE_LIMITS,
  WEBHOOK_EVENT_REFERENCE,
  webhookEventPayload,
} from '@envelope/shared';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { z } from 'zod';
import { APP_VERSION } from '../version';

type Json = Record<string, unknown>;

const TAGS: Record<OperationContract['group'], { name: string; description: string }> = {
  envelopes: {
    name: 'Envelopes',
    description: 'Create, list and read documents sent for signing.',
  },
  drafts: {
    name: 'Drafts',
    description:
      'Edit a draft before it is sent. Every edit needs `If-Match` with the latest draftRevision.',
  },
  files: {
    name: 'Documents',
    description: 'Download the original, the sealed or the certificate PDF.',
  },
  lifecycle: { name: 'Sending', description: 'Send, remind and cancel.' },
  templates: {
    name: 'Templates',
    description:
      'Reusable documents: save an envelope once, then create envelopes or batches from it.',
  },
  embedded: {
    name: 'Embedded editor',
    description:
      'Issue and revoke embedded sender-editor sessions. The editor itself calls the rest.',
  },
};

const DESCRIPTION = `Server-to-server API for creating, sending and tracking documents for signature.

- **Base URL:** \`${API_BASE_PATH}\` on your Envelope host.
- **Authentication:** \`Authorization: Bearer <API key>\` (scheme \`apiKey\`). A key can call only the operations listed here; every other route needs a signed-in session.
- **Errors:** RFC 7807 \`application/problem+json\` with a stable \`code\`.
- **Webhooks:** see the \`x-webhooks\` extension and the \`Webhook*\` schemas.
- **Guide:** \`docs/developers/\` in the repository is the same contract as a readable guide.`;

const pascal = (value: string) =>
  value
    .split(/[.\-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

const camel = (value: string) => {
  const result = pascal(value);
  return result.charAt(0).toLowerCase() + result.slice(1);
};

function security(operation: OperationContract): Json[] {
  if (operation.caller === 'editor') return [{ embedSession: [] }];
  const options: Json[] = [{ apiKey: [] }];
  if (operation.embed) options.push({ embedSession: [] });
  options.push({ session: [] });
  return options;
}

const problem = { $ref: '#/components/schemas/Problem' };
const problemContent = { 'application/problem+json': { schema: problem } };

function errorResponses(operation: OperationContract): Record<string, Json> {
  const byStatus = new Map<number, ErrorCode[]>();
  const add = (code: ErrorCode) => {
    const status = ERROR_CATALOG[code].status;
    byStatus.set(status, [...new Set([...(byStatus.get(status) ?? []), code])]);
  };
  for (const code of operation.errorCodes) add(code);
  add('RATE_LIMITED');
  if (operation.apiKey) {
    add('API_KEY_INVALID');
    if (operation.apiKey === 'write') add('API_KEY_READ_ONLY');
  }
  return Object.fromEntries(
    [...byStatus]
      .sort(([a], [b]) => a - b)
      .map(([status, codes]) => [
        String(status),
        { description: `Error codes: ${codes.join(', ')}.`, content: problemContent },
      ]),
  );
}

function successResponse(operation: OperationContract): Record<string, Json> {
  const response = OPERATION_RESPONSES[operation.id];
  if (!response) throw new Error(`No response contract for operation ${operation.id}`);
  const status = String(response.status);
  const description = operation.responseNote.replace(/^\d+ · /, '');
  if (response.kind === 'none') return { [status]: { description } };
  const responses: Record<string, Json> = {};
  if (response.kind === 'pdf') {
    responses[status] = {
      description,
      headers: { ETag: { schema: { type: 'string' } } },
      content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
    };
  } else {
    const id = z.globalRegistry.get(response.schema)?.id;
    if (!id) throw new Error(`Response schema for ${operation.id} needs an id`);
    responses[status] = {
      description,
      content: { 'application/json': { schema: { $ref: `#/components/schemas/${id}` } } },
    };
  }
  if (operation.inputs.some((input) => input.includes('If-None-Match')))
    responses['304'] = { description: 'Unchanged since the ETag you sent; no body.' };
  return responses;
}

function componentSchemas(): Record<string, Json> {
  const registry = z.toJSONSchema(z.globalRegistry, {
    target: 'openapi-3.0',
    uri: (id) => `#/components/schemas/${id}`,
  }) as { schemas: Record<string, Json> };
  const clean = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(clean);
    if (node && typeof node === 'object') {
      const entries = Object.entries(node as Json).filter(
        ([key, value]) =>
          key !== '$id' &&
          !(key === 'pattern' && typeof value === 'string' && value.startsWith('^([0-9a-fA-F]{8}')),
      );
      return Object.fromEntries(entries.map(([key, value]) => [key, clean(value)]));
    }
    return node;
  };
  return clean(registry.schemas) as Record<string, Json>;
}

function webhookSchemas(): { schemas: Record<string, Json>; events: Json } {
  const schemas: Record<string, Json> = {
    WebhookEvent: {
      type: 'object',
      description:
        'The JSON body of every webhook delivery. `data` always carries `externalId` and `metadata` (null when unset) alongside the fields listed for the event.',
      required: ['id', 'type', 'createdAt', 'data'],
      properties: {
        id: {
          type: 'string',
          description: 'The event id, stable across retries. Deduplicate on it.',
        },
        type: { type: 'string', enum: [...DOCUMENTED_WEBHOOK_EVENTS] },
        createdAt: { type: 'string', description: 'When the event happened (UTC ISO 8601).' },
        data: { type: 'object', additionalProperties: true },
      },
    },
  };
  const events: Json = {};
  for (const type of DOCUMENTED_WEBHOOK_EVENTS) {
    const name = `WebhookEvent${pascal(type)}`;
    schemas[name] = {
      allOf: [{ $ref: '#/components/schemas/WebhookEvent' }],
      description: WEBHOOK_EVENT_REFERENCE[type].description,
      example: webhookEventPayload(type),
    };
    events[type] = { $ref: `#/components/schemas/${name}` };
  }
  return { schemas, events };
}

/** Adds what the controllers cannot say: who may call, what comes back, and how it fails. */
function applyIntegrationContract(document: OpenAPIObject): OpenAPIObject {
  for (const operation of INTEGRATION_OPERATIONS) {
    const path = `${API_BASE_PATH}${operation.path.replace(/:(\w+)/g, '{$1}')}`;
    const target = (document.paths[path] as Record<string, Json> | undefined)?.[
      operation.method.toLowerCase()
    ];
    if (!target) throw new Error(`OpenAPI has no ${operation.method} ${path} for ${operation.id}`);
    const limit = operation.rateLimit ? RATE_LIMITS[operation.rateLimit] : null;
    Object.assign(target, {
      operationId: camel(operation.id),
      summary: operation.title,
      description: [operation.description, ...operation.inputs.map((input) => `- ${input}`)].join(
        '\n\n',
      ),
      tags: [TAGS[operation.group].name],
      security: security(operation),
      responses: { ...successResponse(operation), ...errorResponses(operation) },
      'x-idempotency': operation.idempotency,
      ...(limit
        ? { 'x-rate-limit': `${limit.limit} per ${limit.windowSeconds}s per ${limit.scope}` }
        : {}),
    });
  }
  const webhooks = webhookSchemas();
  document.components = {
    ...document.components,
    schemas: { ...componentSchemas(), ...webhooks.schemas },
  };
  document.tags = Object.values(TAGS);
  Object.assign(document, {
    'x-webhooks': {
      description:
        'Signed POST requests sent to your registered endpoint. Verify `X-Signature` over "<X-Signature-Timestamp>.<raw body>" with HMAC-SHA256.',
      headers: INTEGRATION_HEADERS.filter((h) => h.direction === 'webhook').map(
        ({ name, description }) => ({
          name,
          description,
        }),
      ),
      events: webhooks.events,
    },
  });
  return document;
}

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const bearer = (description: string) => ({
    type: 'http' as const,
    scheme: 'bearer',
    description,
  });
  const config = new DocumentBuilder()
    .setTitle(`${BRAND.fullName} API`)
    .setDescription(DESCRIPTION)
    .setVersion(APP_VERSION)
    .addBearerAuth(
      bearer('A server API key, created in Settings → Integrations. Keep it on your server.'),
      'apiKey',
    )
    .addBearerAuth(bearer('A signed-in person’s session token (the web app).'), 'session')
    .addBearerAuth(
      bearer('The token an embedded editor session receives after its launch handshake.'),
      'embedSession',
    )
    .build();
  return applyIntegrationContract(SwaggerModule.createDocument(app, config));
}
