import { describe, expect, it } from 'vitest';
import {
  createEmbedSessionSchema,
  embedEventSchema,
  embedOriginSchema,
  embedParentMessageSchema,
} from './embed';

const sessionId = '123e4567-e89b-42d3-a456-426614174000';
describe('embedded editor boundary contracts', () => {
  it('requires an envelope only for existing mode and refuses extra authority', () => {
    const base = {
      parentOrigin: 'https://healthprohub.example',
      externalActorId: 'staff:123',
      actions: ['edit'],
    };
    expect(createEmbedSessionSchema.safeParse({ ...base, mode: 'existing' }).success).toBe(false);
    expect(
      createEmbedSessionSchema.safeParse({ ...base, mode: 'existing', envelopeId: sessionId })
        .success,
    ).toBe(true);
    expect(
      createEmbedSessionSchema.safeParse({ ...base, mode: 'upload', tenantId: sessionId }).success,
    ).toBe(false);
    expect(
      createEmbedSessionSchema.safeParse({ ...base, mode: 'upload', actions: ['send'] }).success,
    ).toBe(false);
  });
  it('refuses wildcard origins, paths, credentials and opaque origins', () => {
    for (const origin of [
      'null',
      'https://*.example',
      'https://example/a',
      'https://u:p@example',
      'http://example',
      'https://EXAMPLE.com',
      'https://example.com:443',
      'http://localhost:80',
      'https://example.com:0444',
      'https://127.1',
      'https://2130706433',
    ]) {
      expect(embedOriginSchema.safeParse(origin).success).toBe(false);
    }
    expect(embedOriginSchema.safeParse('http://127.0.0.1:5175').success).toBe(true);
  });
  it('bounds and validates messages without permitting credentials in events', () => {
    expect(
      embedParentMessageSchema.safeParse({
        version: 1,
        sessionId,
        type: 'launch',
        launchToken: `eel_${'a'.repeat(64)}`,
      }).success,
    ).toBe(true);
    expect(
      embedEventSchema.safeParse({ version: 1, sessionId, type: 'ready', accessToken: 'secret' })
        .success,
    ).toBe(false);
    expect(embedEventSchema.safeParse({ version: 2, sessionId, type: 'ready' }).success).toBe(
      false,
    );
  });
});
