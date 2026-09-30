import {
  API_KEY_OPERATIONS,
  curlExample,
  type FiredWebhookEventType,
  type OperationContract,
  WEBHOOK_EVENT_REFERENCE,
  webhookEventPayload,
} from '@envelope/shared';

// The catalog lives in @envelope/shared (docs/18 workstream 13, ADR 0021): this guide, the served
// OpenAPI document and docs/developers/ all read the same operations, events and examples.
export { EXAMPLE_ENVELOPE_ID, EXAMPLE_RECIPIENT_ID } from '@envelope/shared';

export type EndpointReference = OperationContract;

/** The envelope API reference. Embedded-editor session operations are shown in that guide. */
export const ENDPOINTS: readonly EndpointReference[] = API_KEY_OPERATIONS.filter(
  (operation) => operation.group !== 'embedded',
);
export const EMBEDDED_ENDPOINTS: readonly EndpointReference[] = API_KEY_OPERATIONS.filter(
  (operation) => operation.group === 'embedded',
);

export const WEBHOOK_EXAMPLES = WEBHOOK_EVENT_REFERENCE;

export function apiBaseUrl(origin: string): string {
  return `${new URL(origin).origin}/api/v1`;
}

export const requestExample = curlExample;

export function webhookExample(type: FiredWebhookEventType): string {
  return JSON.stringify(webhookEventPayload(type), null, 2);
}
