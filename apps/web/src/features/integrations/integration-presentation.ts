import type {
  WebhookDeliveryEventType,
  WebhookDeliveryStatus,
  WebhookEventType,
} from '@envelope/shared';

export const WEBHOOK_EVENT_LABELS: Record<WebhookEventType, string> = {
  'envelope.sent': 'Envelope sent',
  'envelope.delivered': 'Envelope delivered',
  'envelope.viewed': 'Envelope viewed',
  'recipient.consented': 'Recipient consented',
  'recipient.signed': 'Recipient signed',
  'recipient.declined': 'Recipient declined',
  'envelope.completed': 'Envelope completed',
  'envelope.voided': 'Envelope cancelled',
  'envelope.expired': 'Envelope expired',
  'envelope.extended': 'Envelope extended',
};

/**
 * A delivery's event type can be `webhook.test` (docs/18 workstream 9),
 * which is never subscribable and so isn't in WEBHOOK_EVENT_LABELS above.
 */
export function webhookDeliveryEventLabel(type: WebhookDeliveryEventType): string {
  return type === 'webhook.test' ? 'Test event' : WEBHOOK_EVENT_LABELS[type];
}

export const WEBHOOK_DELIVERY_LABELS: Record<WebhookDeliveryStatus, string> = {
  PENDING: 'Pending',
  SUCCEEDED: 'Delivered',
  FAILED: 'Retrying',
  EXHAUSTED: 'Failed',
};

/** A test delivery is one attempt by design and is never retried (docs/18 workstream 9). */
export function canRedriveWebhookDelivery(
  status: WebhookDeliveryStatus,
  eventType?: WebhookDeliveryEventType,
): boolean {
  return eventType !== 'webhook.test' && (status === 'FAILED' || status === 'EXHAUSTED');
}

/** How long the previous secret keeps working after a rotation (docs/18 workstream 9). */
export const SECRET_OVERLAP_OPTIONS = [
  { hours: 24, label: '24 hours (recommended)' },
  { hours: 72, label: '72 hours' },
  { hours: 1, label: '1 hour' },
  { hours: 0, label: 'Not at all. The old secret stops working now' },
] as const;

export function apiKeyAccessLabel(readOnly: boolean): string {
  return readOnly ? 'Read only' : 'Full access';
}

export function apiKeyAccessDescription(readOnly: boolean): string {
  return readOnly
    ? 'Can view documents and their status, but cannot create, edit or send them.'
    : 'Can create, edit, send and view documents across this workspace.';
}
