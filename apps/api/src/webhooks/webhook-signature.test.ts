import { describe, expect, it } from 'vitest';
import { signWebhookPayload } from './webhook-signature';

describe('signWebhookPayload', () => {
  it('matches docs/08’s exact construction: HMAC_SHA256(secret, "{timestamp}.{raw_body}")', () => {
    const secret = 'whsec_test_secret';
    const timestamp = 1757512331;
    const rawBody = '{"id":"evt_1","type":"envelope.sent","data":{}}';

    // Computed independently with `createHmac('sha256', secret).update(`${timestamp}.${rawBody}`)`.
    const expected = '0db7c79a0aa938ff352d7468d1d045e26f10003a3aa65aa04275f57350db36c2';
    expect(signWebhookPayload(secret, timestamp, rawBody)).toBe(expected);
  });

  it('changes if the timestamp changes', () => {
    const secret = 's';
    const body = '{}';
    expect(signWebhookPayload(secret, 1, body)).not.toBe(signWebhookPayload(secret, 2, body));
  });

  it('changes if the body changes by even one character', () => {
    const secret = 's';
    const timestamp = 1;
    expect(signWebhookPayload(secret, timestamp, '{"a":1}')).not.toBe(
      signWebhookPayload(secret, timestamp, '{"a":2}'),
    );
  });

  it('produces a lowercase 64-character hex string', () => {
    const signature = signWebhookPayload('s', 1, '{}');
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
  });
});
