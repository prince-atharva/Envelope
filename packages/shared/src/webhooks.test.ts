import { describe, expect, it } from 'vitest';
import {
  FIRED_WEBHOOK_EVENT_TYPES,
  listWebhookDeliveriesPageQuerySchema,
  WEBHOOK_API_VERSION,
  WEBHOOK_EVENT_TYPES,
  webhookEventDataSchemas,
  webhookUserAgent,
} from './webhooks';

/**
 * The event contract v1 additions (docs/18 workstream 8, ADR 0018): a new
 * event, per-event data schemas loose enough to accept future additive
 * fields, and the tenant-wide delivery browsing query.
 */
describe('webhook event contract v1', () => {
  it('adds envelope.extended as a fired, subscribable event', () => {
    expect(WEBHOOK_EVENT_TYPES).toContain('envelope.extended');
    expect(FIRED_WEBHOOK_EVENT_TYPES).toContain('envelope.extended');
    expect(FIRED_WEBHOOK_EVENT_TYPES).not.toContain('envelope.delivered');
  });

  it('has a data schema for every event type, including future fields', () => {
    for (const type of WEBHOOK_EVENT_TYPES) {
      expect(webhookEventDataSchemas[type]).toBeDefined();
    }
    // A schema is loose (not z.strictObject), so a later additive field on a
    // real payload never breaks a test or example parsing it.
    const result = webhookEventDataSchemas['recipient.signed'].safeParse({
      envelopeId: '123e4567-e89b-42d3-a456-426614174000',
      envelopeTitle: 'Agreement',
      recipientId: '223e4567-e89b-42d3-a456-426614174000',
      recipientEmail: 'signer@example.com',
      envelopeStatus: 'COMPLETED',
      signedAt: new Date().toISOString(),
      allSigned: true,
      remainingSigners: 0,
      aFieldAddedLater: 'ignored, not rejected',
    });
    expect(result.success).toBe(true);
  });

  it('formats the delivery User-Agent from the running app version', () => {
    expect(webhookUserAgent('0.8.0')).toBe('Envelope-Webhooks/0.8.0');
  });

  it('carries the contract version as a literal', () => {
    expect(WEBHOOK_API_VERSION).toBe('v1');
  });
});

describe('listWebhookDeliveriesPageQuerySchema', () => {
  it('defaults limit to 50 with every filter optional', () => {
    expect(listWebhookDeliveriesPageQuerySchema.parse({})).toEqual({ limit: 50 });
  });

  it('accepts every documented filter together', () => {
    const parsed = listWebhookDeliveriesPageQuerySchema.parse({
      endpointId: '123e4567-e89b-42d3-a456-426614174000',
      status: 'FAILED',
      eventType: 'recipient.signed',
      eventId: 'evt_abc',
      envelopeId: '223e4567-e89b-42d3-a456-426614174000',
      limit: 10,
      cursor: 'opaque-cursor',
    });
    expect(parsed.status).toBe('FAILED');
    expect(parsed.limit).toBe(10);
  });

  it('refuses a limit above 100', () => {
    expect(listWebhookDeliveriesPageQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });
});
