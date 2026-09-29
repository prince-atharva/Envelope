/// <reference types="node" />
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  addRecipientSchema,
  createEnvelopeSchema,
  FIRED_WEBHOOK_EVENT_TYPES,
  saveFieldsSchema,
  sendEnvelopeSchema,
  updateEnvelopeSchema,
  updateRecipientSchema,
} from '@envelope/shared';
import { describe, expect, it } from 'vitest';
import {
  apiBaseUrl,
  ENDPOINTS,
  requestExample,
  WEBHOOK_EXAMPLES,
  webhookExample,
} from './integration-reference';
import { WEBHOOK_VERIFIER } from './webhook-receiver-example';

describe('published integration examples', () => {
  it('validates mutation inputs against the API schemas', () => {
    const schemas = {
      update: updateEnvelopeSchema,
      'recipient-add': addRecipientSchema,
      'recipient-update': updateRecipientSchema,
      fields: saveFieldsSchema,
      send: sendEnvelopeSchema,
    };
    for (const [id, schema] of Object.entries(schemas)) {
      expect(schema.safeParse(ENDPOINTS.find((entry) => entry.id === id)?.body).success, id).toBe(
        true,
      );
    }
    expect(
      createEnvelopeSchema.safeParse({ title: 'Consulting agreement', documentCategory: 'OTHER' })
        .success,
    ).toBe(true);
  });
  it('covers every emitted event without claiming delivery confirmation', () => {
    expect(Object.keys(WEBHOOK_EXAMPLES).sort()).toEqual([...FIRED_WEBHOOK_EVENT_TYPES].sort());
    for (const type of FIRED_WEBHOOK_EVENT_TYPES) {
      expect(JSON.parse(webhookExample(type))).toMatchObject({
        type,
        id: expect.stringMatching(/^evt_/),
        data: { envelopeId: expect.any(String) },
      });
    }
  });
  it('uses an absolute current-origin base and safely quotes shell inputs', () => {
    expect(apiBaseUrl('https://envelope.example/settings/integrations')).toBe(
      'https://envelope.example/api/v1',
    );
    const endpoint = ENDPOINTS.find((item) => item.id === 'update');
    if (!endpoint) throw new Error('Missing update example');
    const command = requestExample(
      { ...endpoint, body: { title: "Client's $(id) agreement" } },
      'https://envelope.example/api/v1',
    );
    expect(command).toContain("Client'\\''s $(id) agreement");
    expect(command).toContain('Authorization: Bearer $ENVELOPE_API_KEY');
    expect(command).toContain('If-Match: \\"$DRAFT_REVISION\\"');
  });
});

describe('published webhook verifier', () => {
  const verify = new Function(
    'createHmac',
    'timingSafeEqual',
    'Buffer',
    `${WEBHOOK_VERIFIER}; return verifyWebhook;`,
  )(createHmac, timingSafeEqual, Buffer) as (
    body: Buffer,
    timestamp: unknown,
    signature: unknown,
    secret: string,
  ) => boolean;
  const secret = 'example-only-secret';
  const body = Buffer.from('{"id":"evt_example","data":{"name":"Alex"}}');
  function signature(timestamp: string) {
    return `sha256=${createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex')}`;
  }
  it('accepts the original bytes and rejects tampering or a different secret', () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    expect(verify(body, timestamp, signature(timestamp), secret)).toBe(true);
    expect(verify(Buffer.from(`${body} `), timestamp, signature(timestamp), secret)).toBe(false);
    expect(verify(body, timestamp, signature(timestamp), 'wrong-secret')).toBe(false);
  });
  it('accepts a rotation header listing several signatures if any one matches', () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const stale = `sha256=${'0'.repeat(64)}`;
    expect(verify(body, timestamp, `${stale},${signature(timestamp)}`, secret)).toBe(true);
    expect(verify(body, timestamp, `${signature(timestamp)}, ${stale}`, secret)).toBe(true);
    expect(verify(body, timestamp, `${stale},${stale}`, secret)).toBe(false);
    expect(verify(body, timestamp, `${signature(timestamp)},garbage`, secret)).toBe(true);
    expect(verify(body, timestamp, `garbage,${stale}`, secret)).toBe(false);
  });
  it('rejects old and future replays and malformed headers without throwing', () => {
    for (const offset of [-301, 301]) {
      const timestamp = String(Math.floor(Date.now() / 1000) + offset);
      expect(verify(body, timestamp, signature(timestamp), secret)).toBe(false);
    }
    for (const timestamp of [undefined, ['123'], 'NaN', '', '123.2']) {
      expect(verify(body, timestamp, 'sha256=bad', secret)).toBe(false);
    }
    const timestamp = String(Math.floor(Date.now() / 1000));
    for (const value of [undefined, [], 'sha256=00', 'bad', `sha256=${'z'.repeat(64)}`]) {
      expect(verify(body, timestamp, value, secret)).toBe(false);
    }
  });
});
