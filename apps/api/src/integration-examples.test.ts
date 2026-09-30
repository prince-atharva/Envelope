import {
  API_KEY_OPERATIONS,
  curlExample,
  EMBED_BACKEND_EXAMPLE,
  EMBED_IFRAME_EXAMPLE,
  EMBED_SDK_EXAMPLE,
  WORKFLOW_EXAMPLE,
} from '@envelope/shared';
import { describe, expect, it } from 'vitest';

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => unknown;

describe('embedded editor examples', () => {
  it.each([
    ['backend', EMBED_BACKEND_EXAMPLE],
    ['SDK mount', EMBED_SDK_EXAMPLE],
    ['direct iframe', EMBED_IFRAME_EXAMPLE],
  ])('%s example is valid JavaScript', (_name, code) => {
    expect(() => new AsyncFunction(code)).not.toThrow();
  });
});

describe('curl examples', () => {
  it('build a command for every API-key operation with the key in a variable', () => {
    for (const operation of API_KEY_OPERATIONS) {
      const command = curlExample(operation, '$ENVELOPE_URL/api/v1');
      expect(command, operation.id).toContain(`--request ${operation.method}`);
      expect(command, operation.id).toContain('Bearer $ENVELOPE_API_KEY');
      expect(command, operation.id).not.toMatch(/eak_[a-f0-9]/);
    }
  });
});

describe('workflow script', () => {
  it('extracts ids with jq and never hard-codes one', () => {
    expect(WORKFLOW_EXAMPLE).toContain('jq -r .id');
    expect(WORKFLOW_EXAMPLE).toContain('jq -r .recipient.id');
    expect(WORKFLOW_EXAMPLE).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-/);
  });
});
