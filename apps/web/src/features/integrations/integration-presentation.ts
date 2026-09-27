import type { WebhookDeliveryStatus, WebhookEventType } from '@envelope/shared';

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
};

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
