import { createEmbedSessionSchema } from '@envelope/shared';
import { describe, expect, it } from 'vitest';
import {
  EMBED_BACKEND_EXAMPLE,
  EMBED_EXISTING_EXAMPLE,
  EMBED_IFRAME_EXAMPLE,
  EMBED_SDK_EXAMPLE,
  EMBED_UPLOAD_EXAMPLE,
} from './embed-reference';

describe('HealthProHub guide contracts', () => {
  it('uses valid bodies for both session modes without inventing permissions', () => {
    expect(createEmbedSessionSchema.safeParse(EMBED_EXISTING_EXAMPLE).success).toBe(true);
    expect(createEmbedSessionSchema.safeParse(EMBED_UPLOAD_EXAMPLE).success).toBe(true);
    expect(EMBED_UPLOAD_EXAMPLE).not.toHaveProperty('envelopeId');
  });
  it('keeps API credentials on the backend and validates the direct iframe source', () => {
    expect(EMBED_BACKEND_EXAMPLE).toContain('process.env.ENVELOPE_API_KEY');
    expect(EMBED_SDK_EXAMPLE).not.toContain('ENVELOPE_API_KEY');
    expect(EMBED_SDK_EXAMPLE).toContain('/api/v1/embed/sdk/v1/envelope.js');
    expect(EMBED_SDK_EXAMPLE).not.toContain('@envelope/embed');
    expect(EMBED_IFRAME_EXAMPLE).toContain('event.source !== frame.contentWindow');
    // A partner cannot import @envelope/shared, so the example checks the envelope by hand.
    expect(EMBED_IFRAME_EXAMPLE).toContain('message.sessionId !== sessionId');
    expect(EMBED_IFRAME_EXAMPLE).not.toContain('@envelope/shared');
    expect(EMBED_IFRAME_EXAMPLE).not.toContain("}, '*')");
  });
});
