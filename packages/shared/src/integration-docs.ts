import { ERROR_CATALOG } from './errors';
import {
  API_BASE_PATH,
  API_KEY_OPERATIONS,
  DOCUMENTED_WEBHOOK_EVENTS,
  errorGuideRows,
  INTEGRATION_HEADERS,
  INTEGRATION_LIMITS,
  type OperationContract,
  operationRoute,
  RATE_LIMITS,
  WEBHOOK_EVENT_REFERENCE,
  webhookEventPayload,
} from './integration-contract';
import {
  curlExample,
  EMBED_BACKEND_EXAMPLE,
  EMBED_EXISTING_EXAMPLE,
  EMBED_IFRAME_EXAMPLE,
  EMBED_SDK_EXAMPLE,
  EMBED_UPLOAD_EXAMPLE,
  WEBHOOK_RECEIVER,
  WORKFLOW_EXAMPLE,
} from './integration-examples';

/**
 * Sections of `docs/developers/*.md` that are generated from the catalog (ADR 0021). A page marks
 * one with `<!-- generated:NAME -->` … `<!-- /generated:NAME -->`; `integration-docs.test.ts`
 * fails when the text between the markers differs from what is produced here. Regenerate with
 * `UPDATE_DEVELOPER_DOCS=1 pnpm --filter @envelope/api test`.
 */

const cell = (value: string) => value.replaceAll('|', '\\|').replaceAll('\n', ' ');
const table = (header: string[], rows: string[][]) =>
  [
    `| ${header.join(' | ')} |`,
    `|${header.map(() => '---').join('|')}|`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n');
const fence = (language: string, body: string) => `\`\`\`${language}\n${body.trimEnd()}\n\`\`\``;

const ENV_BASE = `$ENVELOPE_URL${API_BASE_PATH}`;

function accessLabel(operation: OperationContract): string {
  if (operation.caller === 'editor') return 'Editor only';
  return operation.apiKey === 'read' ? 'Read-only key or full key' : 'Full key';
}

function idempotencyLabel(operation: OperationContract): string {
  return { none: '—', optional: 'Optional', required: 'Required' }[operation.idempotency];
}

function rateLabel(operation: OperationContract): string {
  if (!operation.rateLimit) return '—';
  const limit = RATE_LIMITS[operation.rateLimit];
  return `${limit.limit}/min per ${limit.scope}`;
}

function operationsTable(): string {
  return table(
    ['Operation', 'Method and path', 'Key access', 'Idempotency-Key', 'Rate limit'],
    API_KEY_OPERATIONS.map((operation) => [
      operation.title,
      `\`${operationRoute(operation)}\``,
      accessLabel(operation),
      idempotencyLabel(operation),
      rateLabel(operation),
    ]),
  );
}

function operationDetails(): string {
  return API_KEY_OPERATIONS.map((operation) => {
    const response =
      typeof operation.response === 'string'
        ? fence('text', operation.response)
        : fence('json', JSON.stringify(operation.response, null, 2));
    const codes = operation.errorCodes.map((code) => `\`${code}\``).join(', ') || '—';
    return [
      `### ${operation.title}`,
      '',
      `\`${operationRoute(operation)}\` · ${accessLabel(operation)} · Idempotency-Key: ${idempotencyLabel(operation)} · Rate limit: ${rateLabel(operation)}`,
      '',
      operation.description,
      '',
      ...operation.inputs.map((input) => `- ${input}`),
      '',
      fence('bash', curlExample(operation, ENV_BASE)),
      '',
      `${operation.responseNote}`,
      '',
      response,
      '',
      `Errors: ${codes}. ${operation.errorNote}`,
    ].join('\n');
  }).join('\n\n');
}

function errorsTable(): string {
  return table(
    ['HTTP', 'Code', 'Meaning', 'What to do'],
    errorGuideRows().map((row) => [String(row.status), `\`${row.code}\``, row.meaning, row.action]),
  );
}

function limitsTable(): string {
  return table(
    ['Limit', 'Value', 'Notes'],
    INTEGRATION_LIMITS.map((limit) => [limit.name, limit.value, limit.notes]),
  );
}

function rateLimitsTable(): string {
  return table(
    ['Bucket', 'Limit', 'Counted per', 'Covers'],
    Object.entries(RATE_LIMITS).map(([name, limit]) => [
      `\`${name}\``,
      `${limit.limit} per ${limit.windowSeconds} seconds`,
      limit.scope,
      limit.covers,
    ]),
  );
}

function headersTable(direction: 'request' | 'response' | 'webhook'): string {
  return table(
    ['Header', 'Meaning'],
    INTEGRATION_HEADERS.filter((header) => header.direction === direction).map((header) => [
      `\`${header.name}\``,
      header.description,
    ]),
  );
}

function webhookEvents(): string {
  return table(
    ['Event', 'Sent when'],
    DOCUMENTED_WEBHOOK_EVENTS.map((type) => [
      `\`${type}\``,
      WEBHOOK_EVENT_REFERENCE[type].description,
    ]),
  );
}

function webhookPayloads(): string {
  return DOCUMENTED_WEBHOOK_EVENTS.map((type) =>
    [
      `#### \`${type}\``,
      '',
      fence('json', JSON.stringify(webhookEventPayload(type), null, 2)),
    ].join('\n'),
  ).join('\n\n');
}

function errorStatusNote(): string {
  return `The catalog holds ${Object.keys(ERROR_CATALOG).length} error codes in total; the table above lists the ones a partner integration can meet.`;
}

export const GENERATED_SECTIONS: Record<string, () => string> = {
  'operations-table': operationsTable,
  'operation-details': operationDetails,
  'errors-table': errorsTable,
  'errors-note': errorStatusNote,
  'limits-table': limitsTable,
  'rate-limits-table': rateLimitsTable,
  'request-headers': () => headersTable('request'),
  'response-headers': () => headersTable('response'),
  'webhook-headers': () => headersTable('webhook'),
  'webhook-events': webhookEvents,
  'webhook-payloads': webhookPayloads,
  'webhook-receiver': () => fence('js', WEBHOOK_RECEIVER),
  'workflow-script': () => fence('bash', WORKFLOW_EXAMPLE),
  'embed-existing-body': () => fence('json', JSON.stringify(EMBED_EXISTING_EXAMPLE, null, 2)),
  'embed-upload-body': () => fence('json', JSON.stringify(EMBED_UPLOAD_EXAMPLE, null, 2)),
  'embed-backend': () => fence('js', EMBED_BACKEND_EXAMPLE),
  'embed-sdk': () => fence('js', EMBED_SDK_EXAMPLE),
  'embed-iframe': () => fence('js', EMBED_IFRAME_EXAMPLE),
};

const MARKER = /<!-- generated:([a-z-]+) -->\n([\s\S]*?)<!-- \/generated:\1 -->/g;

/** Every generated section a page uses, by name. */
export function generatedSectionNames(markdown: string): string[] {
  return [...markdown.matchAll(MARKER)].map((match) => match[1] as string);
}

/** The page with each generated section replaced by the current catalog output. */
export function renderGeneratedSections(markdown: string): string {
  return markdown.replace(MARKER, (_match, name: string) => {
    const render = GENERATED_SECTIONS[name];
    if (!render) throw new Error(`Unknown generated section "${name}"`);
    return `<!-- generated:${name} -->\n${render()}\n<!-- /generated:${name} -->`;
  });
}
