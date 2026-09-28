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

export function canRedriveWebhookDelivery(status: WebhookDeliveryStatus): boolean {
  return status === 'FAILED' || status === 'EXHAUSTED';
}

export function apiKeyAccessLabel(readOnly: boolean): string {
  return readOnly ? 'Read only' : 'Full access';
}

export function apiKeyAccessDescription(readOnly: boolean): string {
  return readOnly
    ? 'Can view documents and their status, but cannot create, edit or send them.'
    : 'Can create, edit, send and view documents across this workspace.';
}
