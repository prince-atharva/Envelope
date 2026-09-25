import { z } from 'zod';
import { MAX_WEBHOOK_DESCRIPTION_LENGTH } from './limits';

/**
 * Outbound event notifications for a third-party integration (docs/08,
 * "Webhooks"; docs/18).
 *
 * `envelope.delivered` is reserved but never fired in this phase: the
 * platform sends mail over SMTP, which confirms only that a message was
 * handed to a mail server, never that it reached an inbox. Firing this event
 * on SMTP-accept would claim something the system does not know (docs/18).
 * It stays in the union so integration code can switch on it without
 * breaking later, if a provider with real delivery confirmation replaces
 * SMTP.
 */
export const WEBHOOK_EVENT_TYPES = [
  'envelope.sent',
  'envelope.delivered',
  'envelope.viewed',
  'recipient.consented',
  'recipient.signed',
  'recipient.declined',
  'envelope.completed',
  'envelope.voided',
  'envelope.expired',
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/** Fired by this phase. `envelope.delivered` is excluded — see above. */
export const FIRED_WEBHOOK_EVENT_TYPES: readonly WebhookEventType[] = WEBHOOK_EVENT_TYPES.filter(
  (type) => type !== 'envelope.delivered',
);

const webhookEventTypeSchema = z.enum(WEBHOOK_EVENT_TYPES);

/**
 * Shape only. The https-only and public-address rules (docs/10, docs/18)
 * live entirely server-side (`apps/api/src/webhooks/webhook-url-guard.ts`),
 * not duplicated here, so there is exactly one place that enforces them —
 * and one place a test environment can legitimately relax them for a local
 * receiver.
 */
const webhookUrlSchema = z.url({ error: 'Enter a valid URL' });

export const createWebhookEndpointSchema = z.strictObject({
  url: webhookUrlSchema,
  description: z.string().trim().max(MAX_WEBHOOK_DESCRIPTION_LENGTH).optional(),
  /** Empty or omitted subscribes to every fired event type. */
  subscribedEvents: z.array(webhookEventTypeSchema).max(WEBHOOK_EVENT_TYPES.length).default([]),
});
export type CreateWebhookEndpointInput = z.infer<typeof createWebhookEndpointSchema>;

export const updateWebhookEndpointSchema = z.strictObject({
  url: webhookUrlSchema.optional(),
  description: z.string().trim().max(MAX_WEBHOOK_DESCRIPTION_LENGTH).optional(),
  subscribedEvents: z.array(webhookEventTypeSchema).max(WEBHOOK_EVENT_TYPES.length).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateWebhookEndpointInput = z.infer<typeof updateWebhookEndpointSchema>;

export interface WebhookEndpointSummary {
  id: string;
  url: string;
  description: string | null;
  /** The raw secret's first characters, shown instead of the full value after creation. */
  secretDisplayHint: string;
  subscribedEvents: WebhookEventType[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** The raw secret is returned only here, once, at creation. It is never shown again. */
export interface CreateWebhookEndpointResponse {
  endpoint: WebhookEndpointSummary;
  rawSecret: string;
}

export const listWebhookDeliveriesQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListWebhookDeliveriesQuery = z.infer<typeof listWebhookDeliveriesQuerySchema>;

export type WebhookDeliveryStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'EXHAUSTED';

export interface WebhookDeliverySummary {
  id: string;
  eventId: string;
  eventType: WebhookEventType;
  /** The event payload's `data` object, exactly as sent (or as it will be sent). */
  data: Record<string, unknown>;
  status: WebhookDeliveryStatus;
  attempts: number;
  lastAttemptAt: string | null;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
}

/** The body sent to a webhook endpoint (docs/08, "Payload"). */
export interface WebhookEventPayload<TData = Record<string, unknown>> {
  id: string;
  type: WebhookEventType;
  createdAt: string;
  data: TData;
}
