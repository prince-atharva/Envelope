import { z } from 'zod';
import {
  DEFAULT_WEBHOOK_SECRET_OVERLAP_HOURS,
  MAX_WEBHOOK_DESCRIPTION_LENGTH,
  MAX_WEBHOOK_SECRET_OVERLAP_HOURS,
} from './limits';
import { envelopeMetadataSchema } from './partner-reference';

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
  'recipient.delegated',
  'envelope.completed',
  'envelope.voided',
  'envelope.expired',
  'envelope.extended',
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/** Fired by this phase. `envelope.delivered` is excluded — see above. */
export type FiredWebhookEventType = Exclude<WebhookEventType, 'envelope.delivered'>;
export const FIRED_WEBHOOK_EVENT_TYPES: readonly FiredWebhookEventType[] =
  WEBHOOK_EVENT_TYPES.filter(
    (type): type is FiredWebhookEventType => type !== 'envelope.delivered',
  );

/**
 * A test delivery (docs/18 workstream 9) is never fired for a real envelope
 * event and can never be subscribed to — it exists only as a
 * `WebhookDelivery.eventType` value, so it needs its own type outside the
 * subscribable `WebhookEventType` union.
 */
export const WEBHOOK_TEST_EVENT_TYPE = 'webhook.test' as const;
export type WebhookDeliveryEventType = WebhookEventType | typeof WEBHOOK_TEST_EVENT_TYPE;

/**
 * The webhook contract's own version, carried on every payload (docs/18
 * workstream 8, ADR 0018): additions are backward compatible, so a receiver
 * written against `v1` keeps working as fields are added. A breaking change
 * would ship as `v2`, not a mutation of what `v1` already promised.
 */
export const WEBHOOK_API_VERSION = 'v1' as const;

/** Request headers on every delivery attempt (docs/18 workstream 8, ADR 0018). */
export const WEBHOOK_DELIVERY_HEADERS = {
  signature: 'X-Signature',
  signatureTimestamp: 'X-Signature-Timestamp',
  eventId: 'X-Envelope-Event-Id',
  eventType: 'X-Envelope-Event-Type',
  deliveryId: 'X-Envelope-Delivery-Id',
  attempt: 'X-Envelope-Delivery-Attempt',
} as const;

/** `Envelope-Webhooks/<app version>`, so a receiver's own logs show which build sent a request. */
export function webhookUserAgent(appVersion: string): string {
  return `Envelope-Webhooks/${appVersion}`;
}

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
  /** When the signing secret was last rotated; null if it never has been. */
  secretRotatedAt: string | null;
  /**
   * While in the future, deliveries carry a signature for both the current
   * and the previous secret. Null when no overlap window is open.
   */
  previousSecretExpiresAt: string | null;
  /** Real deliveries in a row that failed every retry; any success resets it. */
  consecutiveFailures: number;
  /** Set when the endpoint was turned off automatically; cleared when it is reactivated. */
  disabledAt: string | null;
  disabledReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Rotates an endpoint's signing secret (docs/18 workstream 9). For
 * `overlapHours` the previous secret keeps verifying alongside the new one;
 * 0 ends the old secret immediately. An empty body means the default.
 */
export const rotateWebhookSecretSchema = z
  .strictObject({
    overlapHours: z
      .number()
      .int()
      .min(0)
      .max(MAX_WEBHOOK_SECRET_OVERLAP_HOURS)
      .default(DEFAULT_WEBHOOK_SECRET_OVERLAP_HOURS),
  })
  .default({ overlapHours: DEFAULT_WEBHOOK_SECRET_OVERLAP_HOURS });
export type RotateWebhookSecretInput = z.infer<typeof rotateWebhookSecretSchema>;

/** The new raw secret is returned only here, once. */
export type RotateWebhookSecretResponse = CreateWebhookEndpointResponse;

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

/**
 * The tenant-wide, filterable browsing route (docs/18 workstream 8 step 8.4),
 * alongside the existing per-endpoint `GET /webhooks/:id/deliveries`, which
 * is kept. `cursor` is opaque, the same idiom every other cursor in this API
 * uses — the client never constructs one itself.
 */
export const listWebhookDeliveriesPageQuerySchema = z.strictObject({
  endpointId: z.uuid().optional(),
  status: z.enum(['PENDING', 'SUCCEEDED', 'FAILED', 'EXHAUSTED']).optional(),
  eventType: webhookEventTypeSchema.optional(),
  eventId: z.string().trim().min(1).optional(),
  envelopeId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});
export type ListWebhookDeliveriesPageQuery = z.infer<typeof listWebhookDeliveriesPageQuerySchema>;

export interface WebhookDeliveryPage {
  items: WebhookDeliverySummary[];
  nextCursor: string | null;
}

export interface WebhookDeliverySummary {
  id: string;
  eventId: string;
  eventType: WebhookDeliveryEventType;
  /** The event payload's `data` object, exactly as sent (or as it will be sent). */
  data: Record<string, unknown>;
  status: WebhookDeliveryStatus;
  attempts: number;
  lastAttemptAt: string | null;
  /** Set while FAILED and a retry is scheduled; null once SUCCEEDED or EXHAUSTED. */
  nextAttemptAt?: string | null;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
  /** Optional in this step (docs/18 workstream 8 step 8.1); populated from 8.4 onward. */
  webhookEndpointId?: string;
  envelopeId?: string | null;
}

/** The body sent to a webhook endpoint (docs/08, "Payload"; docs/18 workstream 8). */
export interface WebhookEventPayload<TData = Record<string, unknown>> {
  id: string;
  /** `webhook.test` only for a test delivery (docs/18 workstream 9). */
  type: WebhookDeliveryEventType;
  /** Added in workstream 8; a receiver written before it ignores unknown fields. */
  apiVersion?: typeof WEBHOOK_API_VERSION;
  createdAt: string;
  data: TData;
}

/**
 * Per-event `data` schemas (docs/18 workstream 8): loose objects, not
 * `z.strictObject`, so a later additive field never breaks a test or example
 * parsing an existing payload. Used by the shared reference, the in-app
 * guide and the webhook e2e suite — not to validate an inbound webhook,
 * since Envelope only ever sends these, never receives them.
 */
/**
 * On every event about an envelope: the partner's own reference, or null when
 * the envelope has none (docs/18 workstream 10, ADR 0019). Present-but-null,
 * not absent, so a receiver never has to tell "no reference" from "old event".
 */
const partnerReference = {
  externalId: z.string().nullable(),
  metadata: envelopeMetadataSchema.nullable(),
};

export const webhookEventDataSchemas = {
  'envelope.sent': z.object({
    envelopeId: z.uuid(),
    envelopeTitle: z.string(),
    ...partnerReference,
    envelopeStatus: z.string(),
    sentAt: z.iso.datetime(),
    expiresAt: z.iso.datetime().nullable(),
    recipientCount: z.number().int(),
    invitedCount: z.number().int(),
  }),
  'envelope.delivered': z.object({ envelopeId: z.uuid() }),
  'envelope.viewed': z.object({
    envelopeId: z.uuid(),
    envelopeTitle: z.string(),
    ...partnerReference,
    recipientId: z.uuid(),
    recipientEmail: z.string(),
    envelopeStatus: z.string(),
    viewedAt: z.iso.datetime(),
  }),
  'recipient.consented': z.object({
    envelopeId: z.uuid(),
    envelopeTitle: z.string(),
    ...partnerReference,
    recipientId: z.uuid(),
    recipientEmail: z.string(),
    envelopeStatus: z.string(),
    consentGivenAt: z.iso.datetime(),
  }),
  'recipient.signed': z.object({
    envelopeId: z.uuid(),
    envelopeTitle: z.string(),
    ...partnerReference,
    recipientId: z.uuid(),
    recipientEmail: z.string(),
    envelopeStatus: z.string(),
    signedAt: z.iso.datetime(),
    allSigned: z.boolean(),
    remainingSigners: z.number().int().min(0),
  }),
  'recipient.declined': z.object({
    envelopeId: z.uuid(),
    envelopeTitle: z.string(),
    ...partnerReference,
    recipientId: z.uuid(),
    recipientEmail: z.string(),
    envelopeStatus: z.string(),
    declinedAt: z.iso.datetime(),
  }),
  'recipient.delegated': z.object({
    envelopeId: z.uuid(),
    envelopeTitle: z.string(),
    ...partnerReference,
    fromRecipientId: z.uuid(),
    fromRecipientEmail: z.string(),
    toRecipientId: z.uuid(),
    toRecipientEmail: z.string(),
    envelopeStatus: z.string(),
    delegatedAt: z.iso.datetime(),
  }),
  'envelope.completed': z.object({
    envelopeId: z.uuid(),
    envelopeTitle: z.string(),
    ...partnerReference,
    envelopeStatus: z.string(),
    completedAt: z.iso.datetime(),
    finalVersionNumber: z.number().int(),
    finalHash: z.string(),
  }),
  'envelope.voided': z.object({
    envelopeId: z.uuid(),
    envelopeTitle: z.string(),
    ...partnerReference,
    envelopeStatus: z.string(),
    voidedAt: z.iso.datetime(),
    fromStatus: z.string(),
    reason: z.string().nullable(),
  }),
  'envelope.expired': z.object({
    envelopeId: z.uuid(),
    envelopeTitle: z.string(),
    ...partnerReference,
    envelopeStatus: z.string(),
    expiredAt: z.iso.datetime(),
    unsigned: z.number().int().min(0),
  }),
  'envelope.extended': z.object({
    envelopeId: z.uuid(),
    envelopeTitle: z.string(),
    ...partnerReference,
    envelopeStatus: z.string(),
    expiresAt: z.iso.datetime(),
    previousExpiresAt: z.iso.datetime().nullable(),
    reopened: z.boolean(),
    reinvitedCount: z.number().int().min(0),
  }),
} as const satisfies Record<WebhookEventType, z.ZodType>;
