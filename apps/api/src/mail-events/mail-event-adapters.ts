import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/**
 * Delivery events from a mail provider, in one neutral shape (docs/20, ADR 0029).
 * Each adapter is a pure function from a provider's webhook body to this shape, so
 * supporting another provider is one function and one test.
 */
export type MailEventType = 'BOUNCED' | 'COMPLAINED';

export interface MailEvent {
  /** The Message-ID we sent, without angle brackets. */
  messageId: string;
  type: MailEventType;
}

export const MAIL_EVENT_ADAPTERS = ['generic', 'postmark'] as const;
export type MailEventAdapter = (typeof MAIL_EVENT_ADAPTERS)[number];

export function isMailEventAdapter(value: string): value is MailEventAdapter {
  return (MAIL_EVENT_ADAPTERS as readonly string[]).includes(value);
}

/** The most events one request may carry. */
export const MAX_MAIL_EVENTS_PER_REQUEST = 100;

/** `<id@host>` and `id@host` are the same message. */
export function normaliseMessageId(value: string): string {
  return value.trim().replace(/^<|>$/g, '');
}

const genericEventSchema = z.strictObject({
  messageId: z.string().min(3).max(998),
  type: z.enum(['BOUNCED', 'COMPLAINED']),
});

/** One event, or a list of them. */
export const genericMailEventsSchema = z.union([
  genericEventSchema,
  z.array(genericEventSchema).min(1).max(MAX_MAIL_EVENTS_PER_REQUEST),
]);

/**
 * Postmark's bounce and spam-complaint webhooks. Postmark hands back the metadata set on the
 * message, and `X-PM-Metadata-envelope-ref` (added by the transport) is where our reference
 * comes back. Bounce kinds that are not a failure to deliver are ignored.
 */
const POSTMARK_NOT_A_FAILURE = new Set([
  'Transient',
  'AutoResponder',
  'VirusNotification',
  'ChallengeVerification',
  'OpenRelayTest',
  'Unknown',
]);

const postmarkSchema = z.looseObject({
  RecordType: z.string(),
  Type: z.string().optional(),
  Metadata: z.record(z.string(), z.unknown()).optional(),
});

function postmarkEvent(body: unknown): MailEvent[] {
  const parsed = postmarkSchema.safeParse(body);
  if (!parsed.success) return [];
  const { RecordType, Type, Metadata } = parsed.data;
  const ref = Metadata?.['envelope-ref'];
  if (typeof ref !== 'string' || ref.trim() === '') return [];
  if (RecordType === 'SpamComplaint') {
    return [{ messageId: normaliseMessageId(ref), type: 'COMPLAINED' }];
  }
  if (RecordType === 'Bounce' && !(Type && POSTMARK_NOT_A_FAILURE.has(Type))) {
    return [{ messageId: normaliseMessageId(ref), type: 'BOUNCED' }];
  }
  return [];
}

/**
 * Turns a webhook body into events. A body the generic adapter cannot read is refused
 * (throws the zod error) so an integrator sees why; a provider's own body that holds nothing
 * for us (a delivery receipt, say) is simply no events, so the provider does not retry it.
 */
export function adaptMailEvents(adapter: MailEventAdapter, body: unknown): MailEvent[] {
  if (adapter === 'postmark') return postmarkEvent(body);
  const parsed = genericMailEventsSchema.parse(body);
  return (Array.isArray(parsed) ? parsed : [parsed]).map((event) => ({
    messageId: normaliseMessageId(event.messageId),
    type: event.type,
  }));
}

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Whether an `Authorization` header carries the shared secret, as a bearer token or as the
 * password of HTTP basic auth (what a provider that only takes a URL or a login can send).
 * Hashed first so the comparison takes the same time whatever the lengths.
 */
export function hasSecret(header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const [scheme, credential] = header.split(/\s+/, 2);
  if (!credential) return false;
  let presented: string | undefined;
  if (scheme?.toLowerCase() === 'bearer') presented = credential;
  else if (scheme?.toLowerCase() === 'basic') {
    const decoded = Buffer.from(credential, 'base64').toString('utf8');
    presented = decoded.slice(decoded.indexOf(':') + 1);
  }
  if (presented === undefined) return false;
  return timingSafeEqual(digest(presented), digest(secret));
}
