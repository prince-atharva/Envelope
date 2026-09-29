import { MAX_WEBHOOK_SECRET_OVERLAP_HOURS } from '@envelope/shared';
import { describe, expect, it } from 'vitest';
import {
  apiKeyAccessDescription,
  apiKeyAccessLabel,
  canRedriveWebhookDelivery,
  SECRET_OVERLAP_OPTIONS,
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

  it('never offers a retry for a test event, which is a single attempt', () => {
    expect(canRedriveWebhookDelivery('EXHAUSTED', 'webhook.test')).toBe(false);
    expect(canRedriveWebhookDelivery('FAILED', 'webhook.test')).toBe(false);
    expect(canRedriveWebhookDelivery('EXHAUSTED', 'envelope.sent')).toBe(true);
  });

  it('offers overlap windows from none up to the 72 hour maximum, recommending 24 hours', () => {
    const hours = SECRET_OVERLAP_OPTIONS.map((option) => option.hours);
    expect(hours).toContain(0);
    expect(Math.max(...hours)).toBe(MAX_WEBHOOK_SECRET_OVERLAP_HOURS);
    expect(SECRET_OVERLAP_OPTIONS[0]).toMatchObject({ hours: 24 });
    expect(SECRET_OVERLAP_OPTIONS[0]?.label).toContain('recommended');
  });

  it('explains both API key access levels', () => {
    expect(apiKeyAccessLabel(false)).toBe('Full access');
    expect(apiKeyAccessDescription(false)).toContain('create, edit, send and view');
    expect(apiKeyAccessLabel(true)).toBe('Read only');
    expect(apiKeyAccessDescription(true)).toContain('cannot create');
  });
});
