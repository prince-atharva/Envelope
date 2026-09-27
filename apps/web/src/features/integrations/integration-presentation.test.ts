import { describe, expect, it } from 'vitest';
import {
  apiKeyAccessDescription,
  apiKeyAccessLabel,
  canRedriveWebhookDelivery,
  WEBHOOK_DELIVERY_LABELS,
  WEBHOOK_EVENT_LABELS,
} from './integration-presentation';

describe('integration presentation', () => {
  it('turns event and delivery codes into readable labels', () => {
    expect(WEBHOOK_EVENT_LABELS['recipient.signed']).toBe('Recipient signed');
    expect(WEBHOOK_EVENT_LABELS['envelope.voided']).toBe('Envelope cancelled');
    expect(WEBHOOK_DELIVERY_LABELS.SUCCEEDED).toBe('Delivered');
    expect(WEBHOOK_DELIVERY_LABELS.EXHAUSTED).toBe('Failed');
  });

  it('only offers redrive for a failed delivery', () => {
    expect(canRedriveWebhookDelivery('PENDING')).toBe(false);
    expect(canRedriveWebhookDelivery('SUCCEEDED')).toBe(false);
    expect(canRedriveWebhookDelivery('FAILED')).toBe(true);
    expect(canRedriveWebhookDelivery('EXHAUSTED')).toBe(true);
  });

  it('explains both API key access levels', () => {
    expect(apiKeyAccessLabel(false)).toBe('Full access');
    expect(apiKeyAccessDescription(false)).toContain('create, edit, send and view');
    expect(apiKeyAccessLabel(true)).toBe('Read only');
    expect(apiKeyAccessDescription(true)).toContain('cannot create');
  });
});
