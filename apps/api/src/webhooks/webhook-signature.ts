import { createHmac } from 'node:crypto';

/**
 * `HMAC_SHA256(secret, "{timestamp}.{raw_body}")` (docs/08, "Webhooks:
 * Verification"). `rawBody` must be exactly the bytes sent in the request
 * body, computed before this function is called: signing and sending must
 * use the same string, or a receiver's own recomputation never matches.
 */
export function signWebhookPayload(
  secret: string,
  timestampSeconds: number,
  rawBody: string,
): string {
  return createHmac('sha256', secret).update(`${timestampSeconds}.${rawBody}`).digest('hex');
}
