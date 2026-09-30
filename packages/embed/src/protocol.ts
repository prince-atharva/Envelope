// Hand-written so the SDK ships with no runtime dependency (ADR 0020). It must accept exactly what
// `embedEventSchema` in @envelope/shared accepts; protocol.test.ts holds the two together.

export const EMBED_PROTOCOL_VERSION = 1;

export type EmbedEvent =
  | { version: 1; sessionId: string; type: 'ready' }
  | { version: 1; sessionId: string; type: 'draft.created'; envelopeId: string }
  | { version: 1; sessionId: string; type: 'draft.saved'; envelopeId: string; revision: number }
  | { version: 1; sessionId: string; type: 'envelope.sent'; envelopeId: string }
  | { version: 1; sessionId: string; type: 'close' }
  | { version: 1; sessionId: string; type: 'error'; code: string }
  | { version: 1; sessionId: string; type: 'session.expired' };

const UUID =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;
const ERROR_CODE = /^[A-Z_]{1,80}$/;

const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const hasOnly = (data: Record<string, unknown>, keys: string[]) => {
  const own = Object.keys(data);
  return own.length === keys.length && keys.every((key) => key in data);
};

/** Returns the event, or null for anything that is not a well-formed protocol-v1 event. */
export function parseEmbedEvent(data: unknown): EmbedEvent | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const message = data as Record<string, unknown>;
  if (message.version !== EMBED_PROTOCOL_VERSION || !isUuid(message.sessionId)) return null;
  const base = ['version', 'sessionId', 'type'];
  switch (message.type) {
    case 'ready':
    case 'close':
    case 'session.expired':
      return hasOnly(message, base) ? (message as EmbedEvent) : null;
    case 'draft.created':
    case 'envelope.sent':
      return hasOnly(message, [...base, 'envelopeId']) && isUuid(message.envelopeId)
        ? (message as EmbedEvent)
        : null;
    case 'draft.saved':
      return hasOnly(message, [...base, 'envelopeId', 'revision']) &&
        isUuid(message.envelopeId) &&
        Number.isInteger(message.revision) &&
        (message.revision as number) >= 0
        ? (message as EmbedEvent)
        : null;
    case 'error':
      return hasOnly(message, [...base, 'code']) &&
        typeof message.code === 'string' &&
        ERROR_CODE.test(message.code)
        ? (message as EmbedEvent)
        : null;
    default:
      return null;
  }
}
