import { embedEventSchema, EMBED_PROTOCOL_VERSION as SHARED_VERSION } from '@envelope/shared';
import { describe, expect, it } from 'vitest';
import { EMBED_PROTOCOL_VERSION, parseEmbedEvent } from './protocol.js';

const id = '123e4567-e89b-42d3-a456-426614174000';
const other = '223e4567-e89b-42d3-a456-426614174000';
const base = { version: 1, sessionId: id };

// Every input goes to both validators; they must never disagree (ADR 0020).
const cases: unknown[] = [
  { ...base, type: 'ready' },
  { ...base, type: 'close' },
  { ...base, type: 'session.expired' },
  { ...base, type: 'draft.created', envelopeId: other },
  { ...base, type: 'envelope.sent', envelopeId: other },
  { ...base, type: 'draft.saved', envelopeId: other, revision: 0 },
  { ...base, type: 'draft.saved', envelopeId: other, revision: 7 },
  { ...base, type: 'error', code: 'EMBED_SESSION_EXPIRED' },
  // Rejected: wrong shape.
  { ...base, type: 'ready', accessToken: 'secret' },
  { ...base, type: 'draft.saved', envelopeId: other },
  { ...base, type: 'draft.saved', envelopeId: other, revision: -1 },
  { ...base, type: 'draft.saved', envelopeId: other, revision: 1.5 },
  { ...base, type: 'draft.saved', envelopeId: other, revision: '1' },
  { ...base, type: 'draft.created', envelopeId: 'not-a-uuid' },
  { ...base, type: 'draft.created' },
  { ...base, type: 'error', code: 'lowercase' },
  { ...base, type: 'error', code: 'A'.repeat(81) },
  { ...base, type: 'error', code: '' },
  { ...base, type: 'error' },
  { ...base, type: 'launch', launchToken: `eel_${'a'.repeat(64)}` },
  { ...base, type: 'unknown' },
  { ...base },
  { version: 2, sessionId: id, type: 'ready' },
  { version: '1', sessionId: id, type: 'ready' },
  { version: 1, sessionId: 'nope', type: 'ready' },
  { version: 1, type: 'ready' },
  { version: 1, sessionId: '123e4567-e89b-12d3-f456-426614174000', type: 'ready' },
  { version: 1, sessionId: '00000000-0000-0000-0000-000000000000', type: 'ready' },
  { version: 1, sessionId: id.toUpperCase(), type: 'ready' },
  null,
  undefined,
  'ready',
  42,
  [],
  [{ ...base, type: 'ready' }],
];

describe('embed protocol validator parity with @envelope/shared', () => {
  it('uses the same protocol version', () => {
    expect(EMBED_PROTOCOL_VERSION).toBe(SHARED_VERSION);
  });
  it.each(cases.map((input, index) => [index, input] as const))(
    'agrees on case %i',
    (_index, input) => {
      const shared = embedEventSchema.safeParse(input);
      const local = parseEmbedEvent(input);
      expect(local !== null).toBe(shared.success);
      if (shared.success) expect(local).toEqual(shared.data);
    },
  );
  it('returns the event untouched when valid', () => {
    const event = { ...base, type: 'draft.created', envelopeId: other };
    expect(parseEmbedEvent(event)).toEqual(event);
  });
});
