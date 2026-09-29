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

/**
 * The `X-Signature` header value: `sha256=<hex>` for the current secret and,
 * while a rotation's overlap window is open, a second `sha256=<hex>` for the
 * previous one, comma-separated, current first (docs/18 workstream 9). A
 * receiver accepts the request if any listed signature matches.
 */
export function buildWebhookSignatureHeader(
  secrets: readonly string[],
  timestampSeconds: number,
  rawBody: string,
): string {
  return secrets
    .map((secret) => `sha256=${signWebhookPayload(secret, timestampSeconds, rawBody)}`)
    .join(',');
}
