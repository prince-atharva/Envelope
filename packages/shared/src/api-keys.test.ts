import { describe, expect, it } from 'vitest';
import { createApiKeySchema, setApiKeyEmbedOriginsSchema } from './api-keys';

const origin = 'https://healthprohub.example';

/**
 * Per-key embedded origins (docs/18 workstream 7, ADR 0017): a read-only key
 * can never launch a writable editor, so its origin list must be empty.
 */
describe('createApiKeySchema embedOrigins', () => {
  it('defaults to an empty list, so an existing caller that omits it keeps working', () => {
    const result = createApiKeySchema.parse({ label: 'Backend integration' });
    expect(result.embedOrigins).toEqual([]);
    expect(result.readOnly).toBe(false);
  });

  it('accepts up to ten unique origins on a full key', () => {
    const result = createApiKeySchema.safeParse({
      label: 'HealthProHub',
      readOnly: false,
      embedOrigins: [origin, 'https://staging.healthprohub.example'],
    });
    expect(result.success).toBe(true);
  });

  it('refuses a duplicate origin', () => {
    const result = createApiKeySchema.safeParse({
      label: 'HealthProHub',
      embedOrigins: [origin, origin],
    });
    expect(result.success).toBe(false);
  });

  it('refuses more than ten origins', () => {
    const many = Array.from({ length: 11 }, (_, i) => `https://app${i}.example`);
    const result = createApiKeySchema.safeParse({ label: 'HealthProHub', embedOrigins: many });
    expect(result.success).toBe(false);
  });

  it('refuses a read-only key with any origin', () => {
    const result = createApiKeySchema.safeParse({
      label: 'Reporting',
      readOnly: true,
      embedOrigins: [origin],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a read-only key with an empty list', () => {
    const result = createApiKeySchema.safeParse({
      label: 'Reporting',
      readOnly: true,
      embedOrigins: [],
    });
    expect(result.success).toBe(true);
  });
});

describe('setApiKeyEmbedOriginsSchema', () => {
  it('accepts a strict {origins} body', () => {
    expect(setApiKeyEmbedOriginsSchema.safeParse({ origins: [origin] }).success).toBe(true);
  });

  it('refuses an unknown field, matching every other strict body in this API', () => {
    expect(
      setApiKeyEmbedOriginsSchema.safeParse({ origins: [origin], tenantId: 'x' }).success,
    ).toBe(false);
  });

  it('accepts clearing every origin', () => {
    expect(setApiKeyEmbedOriginsSchema.safeParse({ origins: [] }).success).toBe(true);
  });
});
